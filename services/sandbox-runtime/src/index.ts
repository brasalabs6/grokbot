export { WorkersAIGateway } from "./ai-gateway";
import { DurableObject } from "cloudflare:workers";
import { isUuid, type TerminalTicket, verifyTerminalTicket } from "./ticket";
import {verifyAcpTicket,type AcpTicket} from "./acp-ticket";

interface Env {
  APP_ORIGIN?: string;
  CONTROL_PLANE_SERVICE_SECRET: string;
  RUNTIME_TICKET_SECRET: string;
  SANDBOXES: DurableObjectNamespace<SessionSandbox>;
}
const TIMEOUT_MS = 30 * 60 * 1000;
const terminalName = /^[a-z0-9][a-z0-9-]{0,62}$/;
const error = (code: string, status: number) =>
  Response.json({ error: { code } }, { status });
const restrictedHeader = (request: Request, secret: string) => {
  const a = request.headers.get("Authorization");
  return Boolean(secret) && a === `Bearer ${secret}`;
};
function resizeNumber(x: string | null, fallback: number) {
  const n = Number(x);
  return Number.isInteger(n) && n >= 5 && n <= 400 ? n : fallback;
}

export class SessionSandbox extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    if (ctx.container?.running) {
      void ctx.blockConcurrencyWhile(() =>
        ctx.container!.setInactivityTimeout(TIMEOUT_MS)
      );
    }
  }
  /**
   * WebSocket responses cannot traverse Durable Object RPC method serialization.
   * The fetch() path preserves upgrade semantics end-to-end.
   */
  async fetch(request:Request):Promise<Response> {
    const url=new URL(request.url);
    const parts=url.pathname.split("/").filter(Boolean);
    if(request.method!=="GET"||request.headers.get("Upgrade")?.toLowerCase()!=="websocket")
      return error("WEBSOCKET_REQUIRED",426);
    if(parts.length!==3||parts[0]!=="ws"||!isUuid(parts[2]))
      return error("NOT_FOUND",404);
    if(this.env.APP_ORIGIN&&request.headers.get("Origin")!==this.env.APP_ORIGIN)
      return error("INVALID_ORIGIN",403);
    const protocols=request.headers.get("Sec-WebSocket-Protocol")
      ?.split(",").map(x=>x.trim())??[];
    if(parts[1]==="acp") {
      const encoded=protocols.find(x=>x.startsWith("grokbot-acp."))
        ?.slice("grokbot-acp.".length);
      const ticket=encoded?await verifyAcpTicket(encoded,this.env.RUNTIME_TICKET_SECRET):null;
      if(!ticket||ticket.sessionId!==parts[2])
        return error("INVALID_ACP_TICKET",401);
      return this.attachAcp(request,ticket);
    }
    if(parts[1]==="terminal") {
      const encoded=protocols.find(x=>x.startsWith("grokbot-ticket."))
        ?.slice("grokbot-ticket.".length);
      const ticket=encoded?await verifyTerminalTicket(encoded,this.env.RUNTIME_TICKET_SECRET):null;
      if(!ticket||ticket.sessionId!==parts[2])
        return error("INVALID_TERMINAL_TICKET",401);
      return this.attachTerminal(request,ticket);
    }
    return error("NOT_FOUND",404);
  }
  private container() {
    if (!this.ctx.container) {
      throw new Error("CONTAINER_BINDING_MISSING");
    }
    return this.ctx.container;
  }
  async status() {
    const container = this.container();
    return {
      generation: (await this.ctx.storage.get<number>("generation")) ?? 0,
      running: container.running,
      acpSessionId: (await this.ctx.storage.get<string>("acpSessionId")) ?? null,
      acpHealthyGeneration: (await this.ctx.storage.get<number>("acpHealthyGeneration")) ?? 0,
      snapshotId: (await this.ctx.storage.get<string>("snapshotId")) ?? null,
    };
  }
  async start(operationId: string) {
    return this.ctx.blockConcurrencyWhile(async () => {
      const previous = await this.ctx.storage.get<{
        generation: number;
        operationId: string;
      }>("lastStart");
      if (previous?.operationId === operationId) {
        return {
          generation: previous.generation,
          idempotent: true,
          running: this.container().running,
        };
      }
      const container = this.container();
      if (container.running) {
        return { ...(await this.status()), idempotent: true };
      }
      // Inference credentials stay in trusted Worker code, outside the sandbox.
      // All other outbound connections are blocked by enableInternet:false.
      await container.interceptOutboundHttps(
        "api.cloudflare.com",
        this.ctx.exports.WorkersAIGateway({ props: {} })
      );
      let agentSecret=await this.ctx.storage.get<string>("grokAgentSecret");
      if(!agentSecret) {
        agentSecret=crypto.randomUUID()+crypto.randomUUID();
        await this.ctx.storage.put("grokAgentSecret",agentSecret);
      }
      const snapshotId = await this.ctx.storage.get<string>("snapshotId");
      container.start(
        snapshotId
          ? { containerSnapshot: { id: snapshotId }, instance:"standard-1", enableInternet: false,
              env: {GROK_AGENT_SECRET: agentSecret}
            }
          : {
              enableInternet: false,
              image: container.images.grok,
              instance: "standard-1",
              env: {
                NODE_EXTRA_CA_CERTS: "/etc/cloudflare/certs/cloudflare-containers-ca.crt",
                GROK_AGENT_SECRET:agentSecret
              }
            }
      );
      await container.setInactivityTimeout(TIMEOUT_MS);
      const generation =
        ((await this.ctx.storage.get<number>("generation")) ?? 0) + 1;
      await this.ctx.storage.put("generation", generation);
      await this.ctx.storage.put("lastStart", { generation, operationId });
      return { generation, idempotent: false, running: true };
    });
  }
  async exec(argv: string[]) {
    if (!this.container().running) {
      throw new Error("CONTAINER_NOT_RUNNING");
    }
    if (
      argv.length === 0 ||
      argv.length > 12 ||
      argv.some((x) => typeof x !== "string" || x.length > 1024)
    ) {
      throw new Error("INVALID_ARGV");
    }
    const proc = await this.container().exec(argv, { cwd: "/workspace" });
    const result = await proc.output();
    return {
      exitCode: result.exitCode,
      stderr: new TextDecoder().decode(result.stderr).slice(0, 32_000),
      stdout: new TextDecoder().decode(result.stdout).slice(0, 128_000),
    };
  }
  /** Privileged one-off proof of real Grok + ACP + Workers AI tool execution. */
  async acpSmoke(): Promise<{ok:boolean; error?:string; updateTypes?:string[]}> {
    const result = await this.exec(["node", "/opt/grokbot/acp-smoke.mjs"]);
    if (result.exitCode !== 0) {
      return {
        ok: false,
        error: "ACP_PROBE_FAILED",
      };
    }
    try {
      const parsed = JSON.parse(result.stdout.trim()) as {ok?:boolean;updateTypes?:unknown};
      return {
        ok: parsed.ok === true,
        updateTypes: Array.isArray(parsed.updateTypes) ?
          parsed.updateTypes.filter((item):item is string=>typeof item==="string") : []
      };
    } catch {
      return { ok: false, error: "ACP_PROBE_INVALID_OUTPUT" };
    }
  }

  async stop(operationId: string, checkpoint: boolean) {
    return this.ctx.blockConcurrencyWhile(async () => {
      const container = this.container();
      const previous = await this.ctx.storage.get<string>("lastStop");
      if (!container.running) {
        return { idempotent: previous === operationId, running: false };
      }
      let snapshotId: null | string = null;
      if (checkpoint) {
        const snapshot = await container.snapshotContainer({
          name: `grokbot-${Date.now()}`,
        });
        snapshotId = snapshot.id;
        await this.ctx.storage.put("snapshotId", snapshotId);
      }
      await container.destroy("Operator stopped sandbox");
      await this.ctx.storage.put("lastStop", operationId);
      return { running: false, snapshotId };
    });
  }
  /** Prune consumed one-time tickets without retaining unbounded storage keys. */
  async alarm() {
    const tickets = await this.ctx.storage.list<number>({ prefix: "ticket:" });
    const now = Date.now();
    for (const [key, expires] of tickets) {
      if (expires < now) await this.ctx.storage.delete(key);
    }
    if ([...tickets.values()].some(value => value >= now)) {
      await this.ctx.storage.setAlarm(now + 180_000);
    }
  }

  /** Capture ACP notifications before forwarding them to the browser. */
  private async recordAcpOutput(text: string) {
    if (text.length > 128_000) return;
    let message: Record<string, unknown>;
    try { message = JSON.parse(text); } catch { return; }
    if (!message || typeof message !== "object") return;
    if (message.method === "session/update") {
      await this.ctx.storage.transaction(async tx => {
        const seq = (await tx.get<number>("acp:seq") ?? 0) + 1;
        await tx.put("acp:seq", seq);
        await tx.put("acp:event:" + seq.toString().padStart(12,"0"),{
          seq,
          at:new Date().toISOString(),
          message
        });
      });
    } else if (message.result && typeof message.result === "object" &&
      !Array.isArray(message.result) &&
      typeof (message.result as Record<string,unknown>).sessionId === "string") {
      const sessionId=(message.result as Record<string,unknown>).sessionId as string;
      if(sessionId.length < 256) {
        await this.ctx.storage.put("acpSessionId",sessionId);
        await this.ctx.storage.put("acpHealthyGeneration",
          await this.ctx.storage.get<number>("generation")??0);
      }
    }
  }
  async acpEvents(after: number) {
    if(!Number.isSafeInteger(after)||after<0)return {events:[],cursor:0};
    const items=await this.ctx.storage.list<{
      seq:number;at:string;message:Record<string,unknown>;
    }>({prefix:"acp:event:"});
    const events=[...items.values()].filter(x=>x.seq>after).sort((a,b)=>a.seq-b.seq).slice(0,300);
    return {events,cursor:events.at(-1)?.seq??after};
  }
  async attachAcp(request: Request,ticket:AcpTicket):Promise<Response> {
    const container=this.container();
    const generation=await this.ctx.storage.get<number>("generation");
    if (!container.running||generation!==ticket.generation) {
      return error("GENERATION_CONFLICT",409);
    }
    const consumed=await this.ctx.storage.transaction(async tx=>{
      const key="ticket:"+ticket.jti;
      if((await tx.get<number>(key))!==undefined)return false;
      await tx.put(key,ticket.exp);
      return true;
    });
    if(!consumed)return error("TICKET_REPLAY",401);
    if((await this.ctx.storage.getAlarm())===null){
      await this.ctx.storage.setAlarm(Date.now()+180_000);
    }
    const secret=await this.ctx.storage.get<string>("grokAgentSecret");
    if(!secret)return error("ACP_SERVER_NOT_CONFIGURED",503);
    let upstream:Response;
    try {
      upstream=await container.getTcpPort(2419).fetch(
        new Request("http://container/ws?server-key="+encodeURIComponent(secret),{
          headers:{"Upgrade":"websocket"},
        })
      );
    }catch{return error("ACP_SERVER_UNREACHABLE",503);}
    if(upstream.status!==101||!upstream.webSocket) {
      return error("ACP_SERVER_NOT_READY",503);
    }
    const backend=upstream.webSocket;
    backend.accept();
    const pair=new WebSocketPair();
    const browser=pair[0];
    const bridge=pair[1];
    bridge.accept();
    // Maintain socket-local processing order for durable event ordering.
    let delivery=Promise.resolve();
    backend.addEventListener("message",event=>{
      delivery=delivery.then(async()=>{
        if(typeof event.data==="string")await this.recordAcpOutput(event.data);
        if(bridge.readyState===WebSocket.OPEN)bridge.send(event.data);
      }).catch(()=>{
        try{bridge.close(1011,"ACP event recording failed");}catch{}
      });
    });
    bridge.addEventListener("message",event=>{
      if(typeof event.data!=="string"||event.data.length>1_000_000) {
        bridge.close(1009,"Message too large or invalid");return;
      }
      if(backend.readyState===WebSocket.OPEN)backend.send(event.data);
    });
    const close=(code:number)=>()=>{
      try{backend.close(code,"Peer disconnected");}catch{}
      try{bridge.close(code,"Peer disconnected");}catch{}
    };
    backend.addEventListener("close",close(1000));
    bridge.addEventListener("close",close(1000));
    return new Response(null,{status:101,webSocket:browser});
  }

  async attachTerminal(request: Request, ticket: TerminalTicket) {
    const container = this.container();
    const generation = await this.ctx.storage.get<number>("generation");
    if (!container.running || generation !== ticket.generation) {
      return error("GENERATION_CONFLICT", 409);
    }
    const url = new URL(request.url);
    // The terminal identity is bound to the signed ticket, not client input.
    const terminal = ticket.terminalId;
    if ((url.searchParams.has("session") &&
         url.searchParams.get("session") !== terminal) ||
         !terminalName.test(terminal)) {
      return error("INVALID_TERMINAL", 400);
    }
    // Atomic compare-and-consume prevents concurrent use of a one-time ticket.
    const firstUse = await this.ctx.storage.transaction(async (tx) => {
      const used = await tx.get<number>("ticket:" + ticket.jti);
      if (used !== undefined) return false;
      await tx.put("ticket:" + ticket.jti, ticket.exp);
      return true;
    });
    if (!firstUse) return error("TICKET_REPLAY", 401);
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + 180_000);
    }
    const abort = new AbortController();
    const proc = await container.exec(
      ["tmux", "new-session", "-A", "-s", terminal],
      {
        cwd: "/workspace",
        env: { TERM: "xterm-256color" },
        pty: {
          cols: resizeNumber(url.searchParams.get("cols"), 80),
          rows: resizeNumber(url.searchParams.get("rows"), 24),
        },
        signal: abort.signal,
      }
    );
    const [client, server] = Object.values(new WebSocketPair());
    server.binaryType = "arraybuffer";
    server.accept();
    const writer = proc.stdin!.getWriter();
    let exited = false;
    void proc.exitCode.then(
      () => {
        exited = true;
      },
      () => {
        exited = true;
      }
    );
    server.addEventListener("message", (event) => {
      if (typeof event.data === "string") {
        try {
          const resize = JSON.parse(event.data);
          if (
            resizeNumber(String(resize.cols), 0) &&
            resizeNumber(String(resize.rows), 0)
          ) {
            proc.resize(
              resizeNumber(String(resize.cols), 80),
              resizeNumber(String(resize.rows), 24)
            );
          }
        } catch {}
      } else if (
        event.data instanceof ArrayBuffer &&
        event.data.byteLength <= 65_536
      ) {
        void writer.write(new Uint8Array(event.data)).catch(() => {});
      }
    });
    server.addEventListener("close", () => {
      if (!exited) {
        abort.abort();
      }
    });
    const forward = async () => {
      const reader = proc.stdout!.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        server.send(value);
      }
      server.close(1000, "Terminal closed");
    };
    void forward().catch(() => {
      try {
        server.close(1011, "Terminal failed");
      } catch {}
    });
    return new Response(null, { status: 101, webSocket: client });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      return Response.json({ ok: true, service: "grokbot-sandbox-runtime" });
    }
    const parts = url.pathname.split("/").filter(Boolean);
    if(parts[0]==="ws"&&parts[1]==="acp"&&parts.length===3){
      if(request.headers.get("Upgrade")?.toLowerCase()!=="websocket")
        return error("WEBSOCKET_REQUIRED",426);
      if(env.APP_ORIGIN&&request.headers.get("Origin")!==env.APP_ORIGIN)
        return error("INVALID_ORIGIN",403);
      const protocols=request.headers.get("Sec-WebSocket-Protocol")
        ?.split(",").map(value=>value.trim())??[];
      const token=protocols.find(value=>value.startsWith("grokbot-acp."))
        ?.slice("grokbot-acp.".length);
      const ticket=token?await verifyAcpTicket(token,env.RUNTIME_TICKET_SECRET):null;
      if(!ticket||ticket.sessionId!==parts[2])
        return error("INVALID_ACP_TICKET",401);
      return env.SANDBOXES.getByName("grokbot-"+ticket.sessionId).fetch(request);
    }
    if (parts[0] === "ws" && parts[1] === "terminal" && parts.length === 3) {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return error("WEBSOCKET_REQUIRED", 426);
      }
      if (env.APP_ORIGIN && request.headers.get("Origin") !== env.APP_ORIGIN) {
        return error("INVALID_ORIGIN", 403);
      }
      const protocols =
        request.headers
          .get("Sec-WebSocket-Protocol")
          ?.split(",")
          .map((x) => x.trim()) ?? [];
      const encoded = protocols
        .find((x) => x.startsWith("grokbot-ticket."))
        ?.slice("grokbot-ticket.".length);
      const ticket = encoded
        ? await verifyTerminalTicket(encoded, env.RUNTIME_TICKET_SECRET)
        : null;
      if (!ticket || ticket.sessionId !== parts[2]) {
        return error("INVALID_TICKET", 401);
      }
      return env.SANDBOXES.getByName(
        `grokbot-${ticket.sessionId}`
      ).fetch(request);
    }
    if (parts[0] !== "internal" || parts.length !== 3 || !isUuid(parts[1])) {
      return error("NOT_FOUND", 404);
    }
    if (!restrictedHeader(request, env.CONTROL_PLANE_SERVICE_SECRET)) {
      return error("FORBIDDEN", 403);
    }
    const sandbox = env.SANDBOXES.getByName(`grokbot-${parts[1]}`);
    try {
      if(parts[2]==="acp-events"&&request.method==="GET"){
        const raw=url.searchParams.get("after")??"0";
        if(!/^(0|[1-9]\d{0,9})$/.test(raw))return error("INVALID_CURSOR",400);
        return Response.json(await sandbox.acpEvents(Number(raw)));
      }
      if (parts[2] === "status" && request.method === "GET") {
        return Response.json(await sandbox.status());
      }
      if (request.method !== "POST") {
        return error("METHOD_NOT_ALLOWED", 405);
      }
      const body = (await request.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      if (!body) {
        return error("INVALID_JSON", 400);
      }
      if (parts[2] === "acp-smoke" && body.confirm === true) {
        return Response.json(await sandbox.acpSmoke());
      }
      if (parts[2] === "start" && isUuid(body.operationId)) {
        return Response.json(await sandbox.start(body.operationId));
      }
      if (
        parts[2] === "stop" &&
        isUuid(body.operationId) &&
        typeof body.checkpoint === "boolean"
      ) {
        return Response.json(
          await sandbox.stop(body.operationId, body.checkpoint)
        );
      }
      if (
        parts[2] === "exec" &&
        Array.isArray(body.argv) &&
        body.argv.every((x) => typeof x === "string")
      ) {
        return Response.json(await sandbox.exec(body.argv));
      }
      return error("INVALID_OPERATION", 400);
    } catch (e) {
      const message = e instanceof Error ? e.message : "RUNTIME_ERROR";
      return Response.json(
        { error: { code: "RUNTIME_ERROR", message: message.slice(0, 200) } },
        { status: 502 }
      );
    }
  },
} satisfies ExportedHandler<Env>;

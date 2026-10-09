export { WorkersAIGateway } from "./ai-gateway";
import { DurableObject } from "cloudflare:workers";
import { isUuid, type TerminalTicket, verifyTerminalTicket } from "./ticket";

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
      const snapshotId = await this.ctx.storage.get<string>("snapshotId");
      container.start(
        snapshotId
          ? { containerSnapshot: { id: snapshotId }, enableInternet: false }
          : {
              enableInternet: false,
              image: container.images.grok,
              env: {
                NODE_EXTRA_CA_CERTS: "/etc/cloudflare/certs/cloudflare-containers-ca.crt"
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
  async attachTerminal(request: Request, ticket: TerminalTicket) {
    const container = this.container();
    const generation = await this.ctx.storage.get<number>("generation");
    if (!container.running || generation !== ticket.generation) {
      return error("GENERATION_CONFLICT", 409);
    }
    // The ticket is consumed before spawning any process, so a replay cannot open a second shell.
    const used = await this.ctx.storage.get<boolean>(`ticket:${ticket.jti}`);
    if (used) {
      return error("TICKET_REPLAY", 401);
    }
    await this.ctx.storage.put(`ticket:${ticket.jti}`, true);
    const url = new URL(request.url);
    const terminal = url.searchParams.get("session") || "main";
    if (!terminalName.test(terminal)) {
      return error("INVALID_TERMINAL", 400);
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
      ).attachTerminal(request, ticket);
    }
    if (parts[0] !== "internal" || parts.length !== 3 || !isUuid(parts[1])) {
      return error("NOT_FOUND", 404);
    }
    if (!restrictedHeader(request, env.CONTROL_PLANE_SERVICE_SECRET)) {
      return error("FORBIDDEN", 403);
    }
    const sandbox = env.SANDBOXES.getByName(`grokbot-${parts[1]}`);
    try {
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

#!/usr/bin/env node
/**
 * Gated, disposable Cloudflare staging integration smoke.
 *
 * Reads secrets from GitHub's protected staging environment only.
 * Creates a fresh Cloudflare sandbox, runs a real Grok ACP prompt through
 * Workers AI, verifies a tool-created file, then destroys that sandbox.
 * This is not a substitute for browser/DB E2E and never runs on production.
 */
import { randomUUID, createHmac, createHash } from "node:crypto";

const base = process.env.CLOUDFLARE_RUNTIME_URL;
const controlSecret = process.env.CONTROL_PLANE_SERVICE_SECRET;
const ticketSecret = process.env.RUNTIME_TICKET_SECRET;
if (!base || !base.startsWith("https://") || !controlSecret || controlSecret.length < 32 ||
    !ticketSecret || ticketSecret.length < 32) {
  throw new Error("STAGING_E2E_MISSING_CONFIG");
}
const url = new URL(base);
if (url.pathname !== "/" || url.search || url.hash || url.username || url.password ||
    !url.hostname.endsWith(".workers.dev")) {
  throw new Error("STAGING_E2E_INVALID_TARGET");
}
const sessionId = randomUUID();
const userId = randomUUID();
const root = new URL("/internal/" + sessionId + "/", url);
const mark = "STAGE_OK_" + randomUUID().slice(0, 8).replaceAll("-", "");
const MAX_MS = 180_000;
const starts = Date.now();

function sign(body) {
  const serialized = Buffer.from(JSON.stringify(body)).toString("base64url");
  const mac = createHmac("sha256", ticketSecret).update(serialized).digest("base64url");
  return serialized + "." + mac;
}

async function internal(method, route, body, timeout = 90_000) {
  const endpoint = new URL(route, root);
  const response = await fetch(endpoint, {
    method,
    headers: {
      Authorization: "Bearer " + controlSecret,
      ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
    },
    ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
    signal: AbortSignal.timeout(timeout),
  });
  let result;
  try { result = await response.json(); } catch { result = null; }
  if (!response.ok) {
    const code = typeof result?.error?.code === "string" ? result.error.code : "HTTP_FAILURE";
    throw new Error(route + ": " + response.status + " " + code);
  }
  return result;
}

async function connectAcp(generation) {
  const token = sign({
    purpose:"acp",sessionId,userId,generation,
    exp:Date.now()+55_000,jti:randomUUID()
  });
  const wsURL = new URL("/ws/acp/" + sessionId, url);
  wsURL.protocol = "wss:";
  const ws = new WebSocket(wsURL.toString(), ["grokbot-acp." + token]);
  const pending = new Map();
  const seen = new Set();
  let next = 0;
  let protocolReady = false;
  let closed = false;

  const open = new Promise((resolve, reject) => {
    const timeout = setTimeout(()=>reject(new Error("ACP_SOCKET_OPEN_TIMEOUT")),25_000);
    ws.addEventListener("open",()=>{clearTimeout(timeout);resolve();},{once:true});
    ws.addEventListener("error",()=>{clearTimeout(timeout);reject(new Error("ACP_SOCKET_FAILED"));},{once:true});
  });

  ws.addEventListener("message",event=>{
    if (typeof event.data !== "string") return;
    let value;
    try { value = JSON.parse(event.data); } catch { return; }
    if(value.method === "session/update" || value.method === "x.ai/session/update") {
      const name = value.params?.update?.sessionUpdate;
      if(typeof name === "string") seen.add(name);
    }
    if(value.method==="session/request_permission" && value.id !== undefined) {
      // Defensive fail-closed: the disposable test should be configured with
      // yoloMode. Unexpected permissions are denied, never blindly granted.
      ws.send(JSON.stringify({
        jsonrpc:"2.0",id:value.id,result:{outcome:{outcome:"cancelled"}}
      }));
      return;
    }
    if(value.id !== undefined && pending.has(value.id)){
      const entry=pending.get(value.id);
      pending.delete(value.id);
      clearTimeout(entry.timer);
      value.error?entry.reject(new Error("ACP_RPC_ERROR_"+value.error.code)):
        entry.resolve(value.result);
    }
  });
  ws.addEventListener("close",()=>{
    closed=true;
    for(const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error("ACP_SOCKET_LOST"));
    }
    pending.clear();
  });

  async function rpc(method,params,deadline=90_000){
    if(closed||ws.readyState!==WebSocket.OPEN)
      throw new Error("ACP_NOT_CONNECTED");
    const id=++next;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{
        pending.delete(id);reject(new Error("ACP_RPC_TIMEOUT_"+method));
      },deadline);
      pending.set(id,{timer,resolve,reject});
      ws.send(JSON.stringify({jsonrpc:"2.0",id,method,params}));
    });
  }
  await open;
  const init=await rpc("initialize",{
    protocolVersion:1,
    clientInfo:{name:"grokbot-ci-staging",version:"1.0.0"},
    clientCapabilities:{fs:{readTextFile:false,writeTextFile:false},terminal:false}
  },35_000);
  if(init?.protocolVersion !== 1)
    throw new Error("ACP_PROTOCOL_VERSION_MISMATCH");
  protocolReady=true;
  return {ws,rpc,seen,protocolReady};
}

/** Validate the remote PTY's actual execution and tmux state across reconnects. */
async function checkTerminal(generation) {
  const terminalId = randomUUID();
  const marker = "TERM_" + randomUUID().replaceAll("-", "").slice(0, 12);
  const file = "grokbot-terminal-proof.txt";
  async function connect() {
    const token = sign({
      purpose:"terminal",sessionId,userId,terminalId,generation,
      exp:Date.now()+45_000,jti:randomUUID()
    });
    const endpoint = new URL("/ws/terminal/"+sessionId, url);
    endpoint.protocol="wss:";
    endpoint.searchParams.set("session",terminalId);
    endpoint.searchParams.set("cols","80");
    endpoint.searchParams.set("rows","25");
    const ws = new WebSocket(endpoint.toString(),["grokbot-ticket."+token]);
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error("PTY_SOCKET_TIMEOUT")),20_000);
      ws.addEventListener("open",()=>{clearTimeout(timer);resolve();},{once:true});
      ws.addEventListener("error",()=>{clearTimeout(timer);reject(new Error("PTY_SOCKET_ERROR"));},{once:true});
    });
    return ws;
  }
  async function fileMatches(path,value){
    for(let attempt=0;attempt<24;attempt++){
      try {
        const result=await internal("POST","files",{op:"read",path},10_000);
        if(result.ok&&result.content?.trim()===value)return;
      }catch{}
      await new Promise(resolve=>setTimeout(resolve,600));
    }
    throw new Error("PTY_EXECUTION_PROOF_MISSING");
  }
  const first=await connect();
  try {
    // The marker is verified by reading a newly-written real workspace file,
    // not by matching the echoed text in the terminal transcript.
    await new Promise(resolve=>setTimeout(resolve,700));
    first.send(new TextEncoder().encode(
      "export GROKBOT_TERM_PROOF="+marker+"; printf '%s\\n' \"$GROKBOT_TERM_PROOF\" > "+
      "/workspace/"+file+"\n"
    ));
    await fileMatches(file,marker);
  } finally {first.close();}
  await new Promise(resolve=>setTimeout(resolve,800));
  const second=await connect();
  try {
    second.send(new TextEncoder().encode(
      "printf '%s\\n' \"$GROKBOT_TERM_PROOF\" > /workspace/grokbot-terminal-reconnect.txt\n"
    ));
    await fileMatches("grokbot-terminal-reconnect.txt",marker);
  } finally {second.close();}
  console.log("STAGING_PTY_TMUX_RECONNECT_E2E_PASSED");
}

let startAttempted = false;
let cleanupError = false;
try {
  const before=await internal("GET","status");
  if(before.running)throw new Error("FRESH_SANDBOX_UNEXPECTEDLY_RUNNING");
  startAttempted = true;
  const startedResult=await internal("POST","start",{operationId:randomUUID()},100_000);
  if(!startedResult.running || !Number.isSafeInteger(startedResult.generation))
    throw new Error("SANDBOX_START_NOT_CONFIRMED");
  const generation=startedResult.generation;
  const status=await internal("GET","status");
  if(!status.running || status.generation!==generation)
    throw new Error("SANDBOX_GENERATION_MISMATCH");
  const exec=await internal("POST","exec",{argv:["grok","--version"]});
  if(exec.exitCode!==0 || !exec.stdout?.includes("1.0.50"))
    throw new Error("GROK_CLI_NOT_READY");
  console.log("STAGING_CONTAINER_STARTED generation="+generation);

  await checkTerminal(generation);
  // Probe the loopback TCP port from inside the container independently of
  // the Cloudflare port-forwarding API. Never print secret values.
  const probe=await internal("POST","exec",{argv:["node","-e",
    "const n=require('node:net');const c=n.connect({port:2419,host:'127.0.0.1'});c.setTimeout(2500);c.on('connect',()=>{console.log('LISTENING');c.end()});c.on('error',e=>{console.log('TCP_ERROR',e.code);process.exitCode=1});c.on('timeout',()=>{console.log('TCP_TIMEOUT');c.destroy();process.exitCode=1})"
  ]});
  console.log("STAGING_LOOPBACK_ACP",JSON.stringify({
    code:probe.exitCode,detail:String(probe.stdout||"").trim().slice(0,120)
  }));
  const secretProbe=await internal("POST","exec",{argv:["node","-e",
    "console.log(process.env.GROK_AGENT_SECRET?'GROK_TOKEN_PRESENT':'GROK_TOKEN_MISSING')"
  ]});
  console.log("STAGING_AGENT_CONFIG",String(secretProbe.stdout||"").trim());
  const daemonProbe=await internal("POST","exec",{argv:["node","-e",
    "const f=require('node:fs');const p=f.readFileSync('/proc/1/cmdline','utf8');const e=f.readFileSync('/proc/1/environ','utf8');console.log('PID1_GROK='+p.includes('grok'));console.log('PID1_TOKEN='+e.includes('GROK_AGENT_SECRET='));console.log('PID1_SLEEP='+p.includes('sleep'));let c=[];for(const n of f.readdirSync('/proc').filter(x=>/^\\d+$/.test(x))){try{const v=f.readFileSync('/proc/'+n+'/comm','utf8').trim();if(v==='grok')c.push(n)}catch{}}console.log('GROK_PROCESS_COUNT='+c.length)"
  ]});
  console.log("STAGING_DAEMON_PROCESS",String(daemonProbe.stdout||"").trim().slice(0,240));
  // Separate a dead daemon/port from a WebSocket handshake/proxy failure.
  // The container's "running" state precedes the Grok daemon's socket
  // readiness. Poll a bounded window instead of falsely failing at ~3 s.
  let port=null;
  for(let attempt=0;attempt<45;attempt++){
    port=await internal("GET","acp-port-health",undefined,15_000);
    if(port.ready)break;
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  console.log("STAGING_ACP_PORT_HEALTH",JSON.stringify(port));
  if(!port?.ready) {
    const diagnostic = await internal("POST","exec",{argv:["node","-e",
      "const f=require('node:fs');let log='';try{log=f.readFileSync('/tmp/grokbot-boot-diagnostics.log','utf8')}catch{}let secret='';try{secret=f.readFileSync('/proc/1/environ','utf8').split('\\0').find(x=>x.startsWith('GROK_AGENT_SECRET='))?.slice(18)||''}catch{}for(const line of log.split('\\n').filter(x=>/error|warn|fail|network|tls|auth|connect|listen|model|startup/i.test(x)).slice(-12)){let safe=secret?line.replaceAll(secret,'[REDACTED]'):line;safe=safe.replace(/server-key[^\\s]*/ig,'server-key=[REDACTED]');console.log(safe.slice(0,220))}if(!log)console.log('NO_BOOT_LOG')"
    ]});
    console.log("STAGING_DAEMON_DIAGNOSTICS",JSON.stringify({
      exitCode:diagnostic.exitCode,
      stdout:String(diagnostic.stdout||"").slice(0,1500),
      stderr:String(diagnostic.stderr||"").replace(/server-key[^\\s]*/ig,"server-key=[REDACTED]").slice(0,350)
    }));
    const categories = await internal("POST","exec",{argv:["node","-e",
      "const f=require('fs');let s='';try{s=f.readFileSync('/tmp/grokbot-boot-diagnostics.log','utf8')}catch(e){console.log('BOOT_LOG_ERROR='+e.code);process.exit(0)}console.log('BOOT_BYTES='+s.length);for(const p of ['error','failed','network','auth','connect','listen','model','https','certificate','timeout','offline'])console.log('BOOT_'+p.toUpperCase()+'='+s.toLowerCase().includes(p))"
    ]});
    console.log("STAGING_BOOT_CLASSIFICATION",JSON.stringify({
      code:categories.exitCode,details:String(categories.stdout||"").slice(0,950),
      stderr:String(categories.stderr||"").slice(0,120)
    }));
    throw new Error("ACP_DAEMON_PORT_UNREACHABLE_AFTER_45S");
  }
  const {ws,rpc,seen}=await connectAcp(generation);
  try {
    const created=await rpc("session/new",{
      cwd:"/workspace",mcpServers:[],_meta:{yoloMode:true}
    },60_000);
    const acpSessionId=created?.sessionId;
    if(!acpSessionId || typeof acpSessionId !== "string")
      throw new Error("ACP_SESSION_CREATE_FAILED");
    console.log("STAGING_ACP_HANDSHAKE_AND_SESSION_PASSED");

    const parts=[{type:"text",text:
      "Create /workspace/grokbot-stage-proof.txt containing exactly " + mark +
      " (one line) using your filesystem or terminal tool. Then read that file. " +
      "Do not merely describe an action: perform the tool operations."}];
    const permit=sign({
      purpose:"run-dispatch",sessionId,userId,runId:randomUUID(),generation,
      promptHash:createHash("sha256").update(JSON.stringify(parts)).digest("hex"),
      jti:randomUUID(),exp:Date.now()+55_000
    });
    const result=await rpc("grokbot/dispatch",{
      sessionId:acpSessionId,prompt:parts,permit
    },MAX_MS);
    if(result?.stopReason !== "end_turn" && result?.stopReason !== "stop_sequence")
      console.log("STAGING_ACP_STOP_REASON="+String(result?.stopReason??"unknown"));
    const proof=await internal("POST","files",{
      op:"read",path:"grokbot-stage-proof.txt"
    });
    if(!proof.ok || String(proof.content).trim()!==mark)
      throw new Error("GROK_TOOL_FILE_PROOF_MISSING");
    if(!seen.has("tool_call") && !seen.has("tool_call_update"))
      throw new Error("NO_ACP_TOOL_EVENTS");
    console.log("STAGING_GROK_WORKERS_AI_TOOL_E2E_PASSED");
  } finally {
    ws.close();
  }
} finally {
  if(startAttempted) {
    try {
      const stopped=await internal("POST","stop",{
        operationId:randomUUID(),checkpoint:false
      },90_000);
      if(stopped.running)throw new Error("CONTAINER_STILL_RUNNING");
      console.log("STAGING_DISPOSABLE_SANDBOX_STOPPED");
    }catch(error) {
      cleanupError=true;
      console.error("STAGING_CLEANUP_ERROR_CODE="+String(error?.message??"UNKNOWN").slice(0,140));
    }
  }
  console.log("STAGING_ELAPSED_SECONDS="+Math.floor((Date.now()-starts)/1000));
  if(cleanupError)process.exitCode=1;
}

#!/usr/bin/env node
/**
 * INTERNAL ONLY: real ACP/Workers AI probe inside the Cloudflare container.
 * This probe is opt-in; always-approve applies only to a disposable smoke task.
 * The production session runtime must use the user's approval policy.
 */
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const timeoutMs = 140_000;
const work = await mkdtemp(join(tmpdir(), "grokbot-acp-"));
const agent = spawn(
  "grok",
  [
    "--no-auto-update",
    "agent",
    "--no-leader",
    "--model",
    "cf-qwen3.8-27b",
    "--always-approve",
    "stdio",
  ],
  { cwd: work, stdio: ["pipe", "pipe", "pipe"] }
);

let seq = 0;
const pending = new Map();
const eventTypes = [];
let stderr = "";
agent.stderr.setEncoding("utf8");
agent.stderr.on("data", (x) => {
  stderr = (stderr + x).slice(-1000);
});
agent.on("error", (e) => {
  for (const p of pending.values()) {
    p.reject(e);
  }
  pending.clear();
});
agent.on("exit", (code) => {
  for (const p of pending.values()) {
    p.reject(new Error("agent exit " + code));
  }
  pending.clear();
});
createInterface({ input: agent.stdout }).on("line", (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.method === "session/update") {
    const type = msg.params?.update?.sessionUpdate;
    if (typeof type === "string") {
      eventTypes.push(type);
    }
    return;
  }
  if (msg.method && msg.id !== undefined) {
    // This protocol probe explicitly refuses unexpected client callbacks.
    agent.stdin.write(
      JSON.stringify({
        error: { code: -32_601, message: "Unsupported" },
        id: msg.id,
        jsonrpc: "2.0",
      }) + "\n"
    );
    return;
  }
  const req = pending.get(msg.id);
  if (!req) {
    return;
  }
  pending.delete(msg.id);
  clearTimeout(req.timer);
  msg.error
    ? req.reject(new Error(JSON.stringify(msg.error)))
    : req.resolve(msg.result);
});
function request(method, params) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("timeout " + method));
    }, timeoutMs);
    pending.set(id, { reject, resolve, timer });
    agent.stdin.write(
      JSON.stringify({ id, jsonrpc: "2.0", method, params }) + "\n"
    );
  });
}
try {
  const initialized = await request("initialize", {
    clientCapabilities: {
      fs: { readTextFile: false, writeTextFile: false },
      terminal: false,
    },
    clientInfo: { name: "grokbot-cloudflare-probe", version: "1.0" },
    protocolVersion: 1,
  });
  const session = await request("session/new", {
    _meta: { yoloMode: true },
    cwd: work,
    mcpServers: [],
  });
  if (!session?.sessionId) {
    throw new Error("ACP session missing id");
  }
  const result = await request("session/prompt", {
    prompt: [
      {
        text: "Write a file hello.js in the current folder that prints CLOUD_READY, run it with Node.js and report the output.",
        type: "text",
      },
    ],
    sessionId: session.sessionId,
  });
  const didCallTool = eventTypes.some(
    (t) => t === "tool_call" || t === "tool_call_update"
  );
  if (!didCallTool) {
    throw new Error("No ACP tool calls were received");
  }
  console.log(
    JSON.stringify({
      ok: true,
      protocolVersion: initialized.protocolVersion,
      sessionCreated: true,
      stopReason: result?.stopReason ?? null,
      toolCallsObserved: didCallTool,
      updateTypes: [...new Set(eventTypes)],
    })
  );
} catch (error) {
  console.error(
    JSON.stringify({
      code: "ACP_PROBE_FAILED",
      message: error.message?.slice(0, 300),
      ok: false,
    })
  );
  process.exitCode = 1;
} finally {
  agent.kill("SIGTERM");
  setTimeout(() => agent.kill("SIGKILL"), 2000).unref();
}

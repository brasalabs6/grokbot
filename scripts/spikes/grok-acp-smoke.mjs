#!/usr/bin/env node
/** Grok Build ACP stdio protocol smoke test. Does not use paid inference unless --prompt is provided. */
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

const timeoutMs = Number(process.env.ACP_TIMEOUT_MS || 20_000);
const promptEnabled = process.argv.includes("--prompt");
const cwd = resolve(process.env.ACP_WORKSPACE || process.cwd());
const binary = process.env.GROK_BINARY || "grok";
const model = process.env.GROK_MODEL;
const argv = [
  "agent",
  "--no-leader",
  ...(model ? ["--model", model] : []),
  "stdio",
];
const child = spawn(binary, argv, { cwd, stdio: ["pipe", "pipe", "pipe"] });
let requestNumber = 0;
const pending = new Map();
const updates = [];
let stderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (text) => {
  stderr = (stderr + text).slice(-4096);
});
child.on("error", (error) => {
  for (const item of pending.values()) {
    item.reject(error);
  }
  pending.clear();
});
child.on("exit", (code, signal) => {
  for (const item of pending.values()) {
    item.reject(new Error(`ACP closed (${code || signal}): ${stderr}`));
  }
  pending.clear();
});
createInterface({ input: child.stdout }).on("line", (line) => {
  let payload;
  try {
    payload = JSON.parse(line);
  } catch {
    console.error("Invalid JSON-RPC output:", line);
    return;
  }
  if (payload.method === "session/update") {
    updates.push(payload.params?.update?.sessionUpdate ?? "unknown");
    return;
  }
  if (payload.method && payload.id !== undefined) {
    // A real client must implement permission and filesystem callbacks.
    child.stdin.write(
      JSON.stringify({
        error: {
          code: -32_601,
          message: "Callback not supported by smoke test",
        },
        id: payload.id,
        jsonrpc: "2.0",
      }) + "\n"
    );
    return;
  }
  const waiter = pending.get(payload.id);
  if (!waiter) {
    return;
  }
  pending.delete(payload.id);
  clearTimeout(waiter.timer);
  payload.error
    ? waiter.reject(new Error(JSON.stringify(payload.error)))
    : waiter.resolve(payload.result);
});
function request(method, params) {
  const id = ++requestNumber;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`ACP timeout: ${method}`));
    }, timeoutMs);
    pending.set(id, { reject, resolve, timer });
    child.stdin.write(
      JSON.stringify({ id, jsonrpc: "2.0", method, params }) + "\n"
    );
  });
}
try {
  const init = await request("initialize", {
    clientCapabilities: {
      fs: { readTextFile: false, writeTextFile: false },
      terminal: false,
    },
    clientInfo: { name: "grokbot-acp-smoke", version: "0.1.0" },
    protocolVersion: 1,
  });
  console.log(
    "INIT_OK",
    JSON.stringify({
      agentInfo: init?.agentInfo,
      capabilities: init?.agentCapabilities,
      protocolVersion: init?.protocolVersion,
    })
  );
  const session = await request("session/new", { cwd, mcpServers: [] });
  if (!session?.sessionId) {
    throw new Error("ACP session/new did not return sessionId");
  }
  console.log(
    "SESSION_OK",
    JSON.stringify({
      configOptions: session?.configOptions,
      models: session?.models,
      sessionId: session.sessionId,
    })
  );
  if (promptEnabled) {
    const text =
      process.env.ACP_SMOKE_PROMPT ||
      "Create hello.ts which prints hello, then run it and tell me the output.";
    const result = await request("session/prompt", {
      prompt: [{ text, type: "text" }],
      sessionId: session.sessionId,
    });
    console.log(
      "PROMPT_END",
      JSON.stringify({ result, updateTypes: [...new Set(updates)] })
    );
    if (
      !updates.includes("agent_message_chunk") &&
      !updates.includes("tool_call")
    ) {
      throw new Error("Prompt had no text or tool ACP updates");
    }
  }
} catch (error) {
  console.error("SPIKE_FAILED", error.message);
  process.exitCode = 1;
} finally {
  child.kill("SIGTERM");
  setTimeout(() => child.kill("SIGKILL"), 3000).unref();
}

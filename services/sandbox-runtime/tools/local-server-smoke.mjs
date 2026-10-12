#!/usr/bin/env node
/**
 * CI-only: validates the ACTUAL Grok daemon listening in the built Docker image.
 * No model prompts, billing, inference credentials or external sandbox required.
 */
const token = process.env.GROK_AGENT_SECRET;
if (!token || token.length < 12) {
  throw new Error("GROK_AGENT_SECRET must be set for smoke");
}
const url = new URL("ws://127.0.0.1:2419/ws");
url.searchParams.set("server-key", token);
const ws = new WebSocket(url);
let gotInitialize = false;
const finished = new Promise((resolve, reject) => {
  const timer = setTimeout(
    () => reject(new Error("Timed out awaiting ACP response")),
    24_000
  );
  function finish(error) {
    clearTimeout(timer);
    error ? reject(error) : resolve();
    try {
      ws.close();
    } catch {}
  }
  ws.addEventListener("open", () => {
    ws.send(
      JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          clientCapabilities: {
            fs: { readTextFile: false, writeTextFile: false },
            terminal: false,
          },
          clientInfo: { name: "grokbot-container-smoke", version: "0.1.0" },
          protocolVersion: 1,
        },
      })
    );
  });
  ws.addEventListener("message", (event) => {
    if (typeof event.data !== "string") {
      return;
    }
    let value;
    try {
      value = JSON.parse(event.data);
    } catch {
      return;
    }
    if (value.id !== 1) {
      return;
    }
    if (value.error) {
      return finish(
        new Error("ACP initialize returned error " + value.error.code)
      );
    }
    if (value.result?.protocolVersion !== 1) {
      return finish(new Error("Unexpected protocolVersion"));
    }
    // agentInfo is optional: capability negotiation + a valid protocol version
    // are the interoperability gates for an ACP WebSocket handshake.
    gotInitialize = true;
    finish(null);
  });
  ws.addEventListener("error", () =>
    finish(new Error("WebSocket connection failed"))
  );
  ws.addEventListener("close", () => {
    if (!gotInitialize) {
      finish(new Error("WebSocket closed before initialize"));
    }
  });
});
await finished;
console.log("GROK_ACP_WEBSOCKET_INITIALIZE_OK");

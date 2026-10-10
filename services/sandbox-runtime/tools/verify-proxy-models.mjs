#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const models = readFileSync("services/sandbox-runtime/config/grok-models.toml", "utf8");
const docker = readFileSync("services/sandbox-runtime/Dockerfile", "utf8");
const runner = readFileSync("services/sandbox-runtime/tools/run-grok.sh", "utf8");
const gateway = readFileSync("services/sandbox-runtime/src/ai-gateway.ts", "utf8");
const runtime = readFileSync("services/sandbox-runtime/src/index.ts", "utf8");

assert.match(models, /^default = "cf-qwen3\.8-27b"$/m);
assert.match(models, /^session_summary = "cf-glm-5\.3-flash"$/m);
assert.equal((models.match(/^\[model\./gm)||[]).length,8);
assert.equal((models.match(/^api_key = "grokbot-internal-placeholder"$/gm)||[]).length,8);
assert.equal((models.match(/^base_url = "https:\/\/cf-ai-rate-proxy\.brasaimainstream\.workers\.dev\/v1"$/gm)||[]).length,8);

for(const model of [
  "@cf/qwen/qwen3.8-27b",
  "@cf/zai-org/glm-5.2",
  "@cf/zai-org/glm-5.3",
  "@cf/zai-org/glm-5.3-flash",
  "@cf/deepseek-ai/deepseek-v4-flash-0731",
  "glm-5.3-cyber", "glm-5.2-cyber", "glm-5.3-flash-cyber"
]) {
  assert.ok(models.includes(`model = "${model}"`), `Missing local profile for ${model}`);
  assert.ok(gateway.includes(`"${model}"`), `Proxy gateway disallows ${model}`);
}
assert.match(runner,/--model cf-qwen3\.8-27b/);
assert.ok(!docker.includes("api_key ="), "Never bake credential strings into Dockerfile");
assert.ok(gateway.includes('this.env.GROKBOT_PROXY_API_KEY'));
assert.ok(gateway.includes('redirect: "manual"'));
assert.ok(runtime.includes('"cf-ai-rate-proxy.brasaimainstream.workers.dev"'));
assert.ok(!runtime.includes('"api.cloudflare.com"'));
assert.ok(!gateway.includes("this.env.AI.run"), "Direct Workers AI is not the user-selected inference path");

console.log("GROKBOT_PROXY_MODEL_AND_CREDENTIAL_BOUNDARY_OK");

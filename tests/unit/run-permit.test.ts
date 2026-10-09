import assert from "node:assert/strict";
import { createHmac, createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { verifyRunPermit, promptHash } from "../../services/sandbox-runtime/src/run-permit";
const key = "unit-test-secret-that-is-not-a-real-credential-12345";
const parts = [{ type: "text", text: "Write hello world" }];
function fixture(changes: Record<string,unknown> = {}) {
  const value = { purpose:"run-dispatch",sessionId:randomUUID(),userId:randomUUID(),
    runId:randomUUID(),generation:1,jti:randomUUID(),exp:Date.now()+30000,
    promptHash:createHash("sha256").update(JSON.stringify(parts)).digest("hex"),
    ...changes };
  const raw=Buffer.from(JSON.stringify(value)).toString("base64url");
  return raw+"."+createHmac("sha256",key).update(raw).digest("base64url");
}
test("prompt hash matches Node SHA256",async()=>{
  assert.equal(await promptHash(parts),createHash("sha256").update(JSON.stringify(parts)).digest("hex"));
});
test("valid exact-prompt run permit verifies",async()=>{
  const token=await verifyRunPermit(fixture(),key);
  assert.equal(token?.purpose,"run-dispatch");
  assert.equal(token?.generation,1);
});
test("invalid run permit scopes are rejected",async()=>{
  assert.equal(await verifyRunPermit(fixture({generation:0}),key),null);
  assert.equal(await verifyRunPermit(fixture({exp:Date.now()-5}),key),null);
  assert.equal(await verifyRunPermit(fixture({purpose:"terminal"}),key),null);
  assert.equal(await verifyRunPermit(fixture({extra:"unexpected"}),key),null);
});

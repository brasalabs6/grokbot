import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { test } from "node:test";
import { verifyAcpTicket } from "../../services/sandbox-runtime/src/acp-ticket";

const secret = "a".repeat(64);
const make = (overrides:Record<string,unknown>={}) => {
  const body = {
    purpose:"acp",sessionId:randomUUID(),userId:randomUUID(),
    jti:randomUUID(),generation:1,exp:Date.now()+30_000,...overrides
  };
  const payload=Buffer.from(JSON.stringify(body)).toString("base64url");
  const mac=createHmac("sha256",secret).update(payload).digest("base64url");
  return payload+"."+mac;
};

test("ACP ticket accepts a valid short-lived generation-scoped capability",async()=>{
  const token=make();
  const parsed=await verifyAcpTicket(token,secret);
  assert.equal(parsed?.purpose,"acp");
  assert.equal(parsed?.generation,1);
});

test("ACP ticket rejects missing signing key and modified payload",async()=>{
  const token=make();
  assert.equal(await verifyAcpTicket(token,""),null);
  assert.equal(await verifyAcpTicket(token,"weak"),null);
  const [body,mac]=token.split(".");
  assert.equal(await verifyAcpTicket(body+"X."+mac,secret),null);
});

test("ACP ticket rejects wrong-purpose, expired and excessive-lifetime capabilities",async()=>{
  assert.equal(await verifyAcpTicket(make({purpose:"terminal"}),secret),null);
  assert.equal(await verifyAcpTicket(make({exp:Date.now()-1}),secret),null);
  assert.equal(await verifyAcpTicket(make({exp:Date.now()+130_000}),secret),null);
});

test("ACP ticket rejects wrong generation, malformed UUID and unexpected fields",async()=>{
  assert.equal(await verifyAcpTicket(make({generation:0}),secret),null);
  assert.equal(await verifyAcpTicket(make({sessionId:"../other"}),secret),null);
  assert.equal(await verifyAcpTicket(make({admin:true}),secret),null);
});

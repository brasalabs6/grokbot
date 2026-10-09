import assert from "node:assert/strict";
import { test } from "node:test";
import { mapAcpUpdate } from "../../lib/agent/acp-events";
import {
  createSessionSchema,
  runStates,
  sessionEventSchema,
  sessionStates,
} from "../../lib/agent/contracts";
import {
  acceptsGeneration,
  canAcceptRun,
  IllegalTransitionError,
  isRunTerminal,
  transitionRun,
  transitionSession,
} from "../../lib/agent/lifecycle";

test("session state graph accepts intended edges and rejects unsafe edges", () => {
  assert.equal(transitionSession("CREATED", "PROVISIONING"), "PROVISIONING");
  assert.equal(transitionSession("PROVISIONING", "READY"), "READY");
  assert.throws(
    () => transitionSession("DELETED", "READY"),
    IllegalTransitionError
  );
  assert.throws(
    () => transitionSession("RUNNING", "DELETED"),
    IllegalTransitionError
  );
  for (const state of sessionStates) {
    assert.throws(() => transitionSession(state, state));
  }
});
test("run states cannot transition after terminal", () => {
  assert.equal(transitionRun("DISPATCHING", "RUNNING"), "RUNNING");
  for (const state of runStates.filter(isRunTerminal)) {
    assert.throws(
      () => transitionRun(state, "RUNNING"),
      IllegalTransitionError
    );
  }
});
test("run admission limited to idle and ready with no active work", () => {
  assert.equal(canAcceptRun("READY", false), true);
  assert.equal(canAcceptRun("IDLE", false), true);
  assert.equal(canAcceptRun("READY", true), false);
  assert.equal(canAcceptRun("WAITING_APPROVAL", false), false);
});
test("generation fencing rejects stale and malformed generations", () => {
  assert.equal(acceptsGeneration(2, 2), true);
  assert.equal(acceptsGeneration(1, 2), false);
  assert.equal(acceptsGeneration(0, 0), false);
  assert.equal(acceptsGeneration(Number.NaN, 2), false);
});
test("create contract defaults permission to ask and prevents extra keys", () => {
  assert.equal(
    createSessionSchema.parse({ modelId: "@cf/openai/gpt-oss-120b" })
      .permissionMode,
    "ask"
  );
  assert.equal(
    createSessionSchema.safeParse({ modelId: "a", ownerId: "other" }).success,
    false
  );
  assert.equal(
    createSessionSchema.safeParse({
      modelId: "a",
      workspace: { kind: "git", url: "file:///etc/passwd" },
    }).success,
    false
  );
});
test("event envelope is versioned and sequence must be positive", () => {
  assert.equal(
    sessionEventSchema.safeParse({
      eventId: crypto.randomUUID(),
      generation: 1,
      occurredAt: new Date().toISOString(),
      payload: {},
      runId: null,
      seq: 0,
      sessionId: crypto.randomUUID(),
      type: "run.accepted",
      v: 1,
    }).success,
    false
  );
});
test("ACP translator recognizes core events and preserves unknown extensions", () => {
  assert.equal(
    mapAcpUpdate({ sessionUpdate: "tool_call", title: "test" }).type,
    "tool.started"
  );
  const unknown = mapAcpUpdate({
    extra: { hello: 1 },
    sessionUpdate: "x.ai/future_event",
  });
  assert.equal(unknown.type, "agent.raw_event");
  assert.deepEqual((unknown.payload.raw as Record<string, unknown>).extra, {
    hello: 1,
  });
});

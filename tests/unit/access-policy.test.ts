import assert from "node:assert/strict";
import { test } from "node:test";
import { isInternalEmailAllowed } from "../../lib/auth/access-policy";

test("denies every email when the internal allowlist is absent", () => {
  assert.equal(isInternalEmailAllowed("member@example.com", undefined), false);
  assert.equal(isInternalEmailAllowed("member@example.com", ""), false);
  assert.equal(isInternalEmailAllowed("member@example.com", "  "), false);
});

test("allows only exact case-insensitive email entries", () => {
  const list = "First@Example.COM, second@example.com ";
  assert.equal(isInternalEmailAllowed("first@example.com", list), true);
  assert.equal(isInternalEmailAllowed(" SECOND@example.com ", list), true);
  assert.equal(isInternalEmailAllowed("evilfirst@example.com", list), false);
  assert.equal(isInternalEmailAllowed("second@example.com.evil", list), false);
  assert.equal(isInternalEmailAllowed("", list), false);
});

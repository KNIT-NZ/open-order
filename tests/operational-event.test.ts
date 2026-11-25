import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseOperationalEvent, operationalStage, operationalRelease, boundedElapsed } from "../lib/open-order/operational-event";
const valid = { schemaVersion: 1, requestId: "72bff9d2-3032-4235-8313-9a1a525fc3fe", route: "search", outcome: "completed", elapsedMs: 123, resultCount: 3, stageCount: 0, lastStage: "none", releaseSha: "a".repeat(40) };
test("closed event schema rejects content and unknown keys, not just obvious raw queries", () => {
  assert.deepEqual(parseOperationalEvent(valid), valid);
  const canary = "PRIVATE_SYNTHETIC_\r\nQUESTION";
  for (const field of ["q", "debug", "prompt", "answer", "sourceIds", "headers", "queryHash", "metadata"]) {
    assert.equal(parseOperationalEvent({ ...valid, [field]: { content: canary } }), null);
  }
  for (const patch of [{ requestId: canary }, { outcome: canary }, { route: canary }, { elapsedMs: Infinity }, { resultCount: -1 }, { stageCount: 1 }, { lastStage: canary }, { releaseSha: canary }, { resultCount: {} }, { schemaVersion: 2 }]) {
    assert.equal(parseOperationalEvent({ ...valid, ...patch }), null);
  }
  assert.equal(parseOperationalEvent({ ...valid, route: "ai_answer" }), null);
  assert.ok(parseOperationalEvent({ ...valid, route: "ai_answer", resultCount: null, stageCount: 4, lastStage: "validating" }));
  assert.equal(operationalStage(canary), "other");
  assert.equal(operationalRelease(canary), null);
  assert.equal(boundedElapsed(100, 0), 0);
  assert.equal(boundedElapsed(0, 900001), 900000);
});
test("writer has separate credential and explicit disabled-by-default boundary", () => {
  const src = readFileSync(new URL("../lib/open-order/operational-writer.ts", import.meta.url), "utf8");
  assert.match(src, /OPEN_ORDER_OPS_ENABLED === "1"/);
  assert.match(src, /OPEN_ORDER_OPERATIONAL_DATABASE_URL/);
  assert.doesNotMatch(src, /process\.env\.DATABASE_URL|console\./);
  assert.match(src, /parseOperationalEvent\(input\)/);
  const sql = readFileSync(new URL("../docs/operational-schema-review.sql", import.meta.url), "utf8");
  assert.match(sql, /REVOKE ALL ON ALL FUNCTIONS IN SCHEMA open_order_ops FROM PUBLIC/);
  assert.match(sql, /interval '14 days'/);
  assert.match(sql, /interval '2 hours'/);
  assert.doesNotMatch(sql, /\bjsonb?\b/i);
});

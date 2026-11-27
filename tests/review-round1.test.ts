import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { openGovernedAnswerStream } from "../lib/open-order/answer-stream";
import { deriveObligations } from "../lib/v5-17-semantic-selector.js";
import { adjudicateOverlooked } from "../lib/ai/scenario-adjudication";
import {
  collectRejectionKeys,
  filterDraftNamedAuthorities,
  recoverySuppressed,
  selectOverlookedCandidates,
} from "../lib/procedural-mechanisms";

async function readEvents(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: string[] = [];
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) return { closed: true, events, buffer };
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    events.push(...parts);
  }
  return { closed: false, events, buffer };
}

function eventName(raw: string) {
  return raw.split("\n").find((line) => line.startsWith("event:"))?.slice(6).trim();
}

test("answer route stream ends after done, error, and deadline", async () => {
  const route = readFileSync(new URL("../app/api/ai/answer/route.ts", import.meta.url), "utf8");
  const lifecycle = readFileSync(new URL("../lib/open-order/answer-stream.js", import.meta.url), "utf8");
  assert.match(route, /openGovernedAnswerStream/);
  assert.doesNotMatch(route, /closeStream\s*\(\s*\)\s*\{[^}]*closeStream\(\)/);
  assert.match(lifecycle, /controller\.close\(\)/);

  const done = openGovernedAnswerStream({
    deadlineMs: 1000, heartbeatMs: 400,
    bindSend: (raw) => (event, data) => raw(event, { ...(data as object), trace: { requestId: "req-done" } }),
    work: async (send) => { send("done", { ok: true }); },
  });
  const doneRead = await readEvents(done);
  assert.equal(doneRead.closed, true);
  assert.equal(eventName(doneRead.events.find((item) => item.includes("event: done")) ?? ""), "done");

  const failed = openGovernedAnswerStream({
    deadlineMs: 1000, heartbeatMs: 400,
    bindSend: (raw) => raw,
    work: async (send) => { send("error", { reason: "internal", message: "stopped", retryable: false, kind: "unknown" }); },
  });
  const failedRead = await readEvents(failed);
  assert.equal(failedRead.closed, true);
  assert.ok(failedRead.events.some((item) => item.includes("event: error")));

  const hung = openGovernedAnswerStream({
    deadlineMs: 30, heartbeatMs: 10,
    bindSend: (raw) => (event, data) => raw(event, { ...(typeof data === "object" && data ? data : {}), trace: { requestId: "req-deadline" } }),
    work: () => new Promise(() => undefined),
  });
  const hungRead = await readEvents(hung);
  assert.equal(hungRead.closed, true);
  const terminal = hungRead.events.find((item) => item.includes("event: error")) ?? "";
  assert.match(terminal, /deadline_exceeded/);
  assert.match(terminal, /req-deadline/);
});

test("planner relations are required", () => {
  assert.throws(() => deriveObligations("synthetic question", []), /Planner relations are required/);
  assert.throws(() => deriveObligations("synthetic question", undefined), /Planner relations are required/);
  const obligations = deriveObligations("whole", ["permission"], ["part one", "part two"]);
  assert.equal(obligations.length, 2);
  assert.deepEqual(obligations[0].relations, ["permission"]);
});

test("rejected authority is not recovered and abstention blocks recovery", () => {
  const rejected = collectRejectionKeys({
    dispositions: [
      { status: "rejected", reason: "unverified-verbatim-witness", sectionId: "s-rejected", citationLabel: "QX 1", corpus: "standing_orders" },
      { status: "withheld_no_primary", reason: "missing-primary", sectionId: "s-withheld", citationLabel: "QX 2", corpus: "standing_orders" },
    ],
    recoveryDispositions: [
      { status: "rejected", reason: "ambiguous-source-identity", citationLabel: "QX 3", corpus: "speakers_rulings" },
    ],
    selectorRejections: [
      { sectionId: "s-selector", citationLabel: "QX 4", documentCorpus: "standing_orders" },
    ],
  });
  const pool = [
    { sectionId: "s-rejected", citationLabel: "QX 1", documentCorpus: "standing_orders", path: ["Forum"], sectionContent: "The actor may emit a beacon when the forum allows it expressly." },
    { sectionId: "s-withheld", citationLabel: "QX 2", documentCorpus: "standing_orders", path: ["Forum"], sectionContent: "The actor may emit a beacon when the forum allows it expressly." },
    { sectionId: "s-label", citationLabel: "QX 3", documentCorpus: "speakers_rulings", path: ["Forum"], sectionContent: "The actor may emit a beacon when the forum allows it expressly." },
    { sectionId: "s-selector", citationLabel: "QX 4", documentCorpus: "standing_orders", path: ["Forum"], sectionContent: "The actor may emit a beacon when the forum allows it expressly." },
    { sectionId: "s-open", citationLabel: "QX 5", documentCorpus: "standing_orders", path: ["Forum"], sectionContent: "The actor may emit a beacon when the forum allows it expressly." },
  ];
  const overlooked = selectOverlookedCandidates({
    pool, admittedIds: [], rejectedKeys: rejected, action: "emit a beacon",
  });
  assert.deepEqual(overlooked.map((item) => item.sectionId), ["s-open"]);
  assert.equal(recoverySuppressed({ status: "v40_no_governing_witness" }), true);
  assert.equal(recoverySuppressed({ status: "adjudication_unavailable:provider_transient" }), true);
  assert.equal(recoverySuppressed({ status: "v40_quoted_source_adjudication" }), false);
  const admitted = adjudicateOverlooked({
    question: "May the actor emit a beacon?",
    action: "emit a beacon",
    candidates: overlooked,
  });
  assert.equal(admitted.length, 1);
  assert.equal(admitted[0]?.citationLabel, "QX 5");
});

test("a draft cannot admit an authority that was not already admitted", () => {
  const admitted = [{ citationLabel: "QX 5" }];
  const namedByDraft = [{ citationLabel: "QX 5" }, { citationLabel: "QX 9" }];
  assert.deepEqual(filterDraftNamedAuthorities(namedByDraft, admitted), [{ citationLabel: "QX 5" }]);
});

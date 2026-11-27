import assert from "node:assert/strict";
import test from "node:test";
import { clientCheckNote } from "../lib/open-order/client-check-note";
import { formatAiDebugSnapshot } from "../lib/open-order/format";
import { EMPTY_AI_DIAGNOSTICS } from "../lib/open-order/types";

const rejectedLabel = "SO 404";
const claimText = "The Speaker must expel the member at once.";
const validatorReason = "The cited text does not let the Speaker expel anyone.";
const responsivenessReason = "The draft never answers whether expulsion is allowed.";

test("done, error and debug output omit rejected labels and check prose", () => {
  const done = {
    ok: true,
    answerText: "Bottom line: a narrower rule remains. [SO 1]",
    fallbackReason: "The cited draft did not demonstrably answer the question asked.",
    rewriteNote: clientCheckNote([
      "rewritten_mentions=1",
      `Rewrote unsupported authority mentions: ${rejectedLabel}`,
    ]),
    claimValidationNote: clientCheckNote([
      "responsiveness=withheld",
      "pruned_unsupported_claims=1",
      "claim_ids=claim-1",
      `${claimText}: ${validatorReason}`,
      responsivenessReason,
    ]),
    invalidCitations: [] as string[],
    trace: { incidentRepair: "repair=accepted" },
  };
  const error = {
    message: "The parliamentary answer request could not complete. Please try again.",
    reason: "internal",
    kind: "unknown",
    retryable: false,
  };
  const snapshot = formatAiDebugSnapshot({
    ...EMPTY_AI_DIAGNOSTICS,
    terminalValidation: {
      degraded: true,
      fallbackReason: done.fallbackReason,
      rewriteNote: `Rewrote unsupported authority mentions: ${rejectedLabel}, 12/3`,
      pruneNote: `Pruned line: ${claimText}`,
      claimValidationNote: `${validatorReason}; ${responsivenessReason}`,
      invalidCitations: [rejectedLabel],
    },
    pipelineTrace: {
      schemaVersion: 2,
      requestId: "00000000-0000-4000-8000-000000000001",
      buildCommit: null,
      incidentRepair: `repair failed because ${responsivenessReason}`,
      stageTimeline: [],
    },
  });
  for (const blob of [JSON.stringify(done), JSON.stringify(error), snapshot]) {
    assert.equal(blob.includes(rejectedLabel), false);
    assert.equal(blob.includes("12/3"), false);
    assert.equal(blob.includes(claimText), false);
    assert.equal(blob.includes(validatorReason), false);
    assert.equal(blob.includes(responsivenessReason), false);
  }
  assert.match(done.claimValidationNote ?? "", /responsiveness=withheld/);
  assert.match(done.claimValidationNote ?? "", /claim_ids=claim-1/);
  assert.match(snapshot, /Invalid citations: 1/);
  assert.match(snapshot, /rewritten_mentions=1|None reported/);
});

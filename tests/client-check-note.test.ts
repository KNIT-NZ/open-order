import assert from "node:assert/strict";
import test from "node:test";
import { clientCheckNote, publicScenarioAdjudication } from "../lib/open-order/client-check-note";
import { formatAiDebugSnapshot } from "../lib/open-order/format";
import { EMPTY_AI_DIAGNOSTICS } from "../lib/open-order/types";

const rejectedLabel = "SO 404";
const claimText = "The Speaker must expel the member at once.";
const validatorReason = "The cited text does not let the Speaker expel anyone.";
const responsivenessReason = "The draft never answers whether expulsion is allowed.";
const gapMarker = "MARKER about the draft";

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
  const leakedAdjudication = {
    status: "v40_quoted_source_adjudication",
    candidateCount: 2,
    selected: ["SO 1"],
    rejected: [`${rejectedLabel}:${validatorReason}`],
    gaps: [gapMarker],
    providerAttempts: 1,
    dossier: [`standing_orders:${rejectedLabel}`],
    retrievedOutsideDossier: [],
    dispositions: [{
      citationLabel: rejectedLabel,
      corpus: "standing_orders",
      status: "rejected",
      reason: validatorReason,
      role: null,
    }],
    unavailableNominations: 0,
    recovery: {
      status: "v40_no_governing_witness",
      candidates: [`standing_orders:${rejectedLabel}`],
      dispositions: [{
        citationLabel: rejectedLabel,
        corpus: "standing_orders",
        status: "rejected",
        reason: gapMarker,
        role: null,
      }],
      unavailableNominations: 0,
      selected: [],
      rejected: [`${rejectedLabel}:scope-not-established:actor`],
    },
  };
  const diagnostics = { scenarioAdjudication: publicScenarioAdjudication(leakedAdjudication) };
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
    selectorSummary: {
      candidateCount: 2,
      minObligationCoverage: 1,
      allObligationsComplete: true,
      obligationDetails: [],
      prePruneLabels: [],
      selectedLabels: ["SO 1"],
      scenarioAdjudication: leakedAdjudication,
    },
    pipelineTrace: {
      schemaVersion: 2,
      requestId: "00000000-0000-4000-8000-000000000001",
      buildCommit: null,
      incidentRepair: `repair failed because ${responsivenessReason}`,
      stageTimeline: [],
    },
  });
  for (const blob of [JSON.stringify(done), JSON.stringify(error), JSON.stringify(diagnostics), snapshot]) {
    assert.equal(blob.includes(rejectedLabel), false);
    assert.equal(blob.includes("12/3"), false);
    assert.equal(blob.includes(claimText), false);
    assert.equal(blob.includes(validatorReason), false);
    assert.equal(blob.includes(responsivenessReason), false);
    assert.equal(blob.includes(gapMarker), false);
  }
  assert.match(JSON.stringify(diagnostics), /unresolved_facets=1/);
  assert.match(JSON.stringify(diagnostics), /primary_refusal=other:1/);
  assert.match(snapshot, /unresolved_facets=1/);
  assert.match(done.claimValidationNote ?? "", /responsiveness=withheld/);
  assert.match(done.claimValidationNote ?? "", /claim_ids=claim-1/);
  assert.match(snapshot, /Invalid citations: 1/);
  assert.match(snapshot, /rewritten_mentions=1|None reported/);
});

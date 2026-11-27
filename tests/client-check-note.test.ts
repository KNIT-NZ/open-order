import assert from "node:assert/strict";
import test from "node:test";
import { adjudicationNote, clientCheckNote, publicScenarioAdjudication } from "../lib/open-order/client-check-note";
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

test("adjudication filtering is idempotent and keeps colon refusal codes", () => {
  const raw = {
    status: "v40_quoted_source_adjudication",
    candidateCount: 4,
    selected: ["SO 1"],
    rejected: [
      "SO 404:scope-not-established:actor",
      "SO 405:scope-not-established:actor",
      "SO 406:the draft invented a power",
    ],
    gaps: ["facet one", "facet two", "facet three"],
    providerAttempts: 1,
    dossier: ["standing_orders:SO 404"],
    retrievedOutsideDossier: ["standing_orders:SO 405"],
    dispositions: [{
      citationLabel: "SO 404",
      corpus: "standing_orders",
      status: "rejected",
      reason: "scope-not-established:actor",
      role: null,
    }],
    unavailableNominations: 0,
    recovery: {
      status: "v40_no_governing_witness",
      candidates: ["standing_orders:SO 404", "standing_orders:SO 405"],
      dispositions: [{
        citationLabel: "SO 405",
        corpus: "standing_orders",
        status: "rejected",
        reason: "act-not-attested",
        role: null,
      }],
      unavailableNominations: 0,
      selected: [],
      rejected: ["SO 404:act-not-attested"],
    },
  };
  const once = publicScenarioAdjudication(raw);
  const twice = publicScenarioAdjudication(once);
  assert.deepEqual(twice, once);
  assert.equal(adjudicationNote(once), adjudicationNote(raw));
  assert.equal(adjudicationNote(twice), adjudicationNote(once));
  const note = adjudicationNote(once) ?? "";
  assert.match(note, /primary_refusal=scope-not-established:actor:2/);
  assert.match(note, /primary_refusal=other:1/);
  assert.match(note, /disposition=rejected_scope-not-established:actor:1/);
  assert.match(note, /unresolved_facets=3/);
  assert.match(note, /recovery_candidates=2/);
  assert.match(note, /recovery_refusal=act-not-attested:1/);
  assert.match(note, /disposition=rejected_act-not-attested:1/);
  assert.equal(note.includes("SO 404"), false);
  const snapshot = formatAiDebugSnapshot({
    ...EMPTY_AI_DIAGNOSTICS,
    selectorSummary: {
      candidateCount: 4,
      minObligationCoverage: 1,
      allObligationsComplete: true,
      obligationDetails: [],
      prePruneCount: 2,
      selectedLabels: ["SO 1"],
      scenarioAdjudication: once,
    },
  });
  assert.match(snapshot, /unresolved_facets=3/);
  assert.match(snapshot, /recovery_candidates=2/);
  assert.match(snapshot, /primary_refusal=scope-not-established:actor:2/);
  assert.match(snapshot, /disposition=rejected_scope-not-established:actor:1/);
  assert.equal(/unresolved_facets=1(?!\d)/.test(snapshot), false);
  assert.equal(snapshot.includes("primary_refusal=1:1"), false);
  assert.equal(snapshot.includes("SO 404"), false);
});

test("operation-failure code tokens keep uppercase provider codes", () => {
  assert.equal(
    clientCheckNote(["code=UNAVAILABLE", "code=RESOURCE_EXHAUSTED", "kind=LEAKMARKER", "code=SO 404"]),
    "code=UNAVAILABLE;code=RESOURCE_EXHAUSTED",
  );
});

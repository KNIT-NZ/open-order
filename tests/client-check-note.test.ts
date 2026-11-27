import assert from "node:assert/strict";
import test from "node:test";
import { clientCheckNote } from "../lib/open-order/client-check-note";
import { publicScenarioAdjudication } from "../lib/open-order/public-diagnostics";
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

test("diagnostics event and debug snapshot omit rejected labels, reasons and adjudicator gaps", () => {
  const markers = {
    rejectedLabel: "SO 404",
    rejectedRuling: "77/9",
    recoveryLabel: "Appendix Z cl 99",
    proseReason: "LEAK_MARKER_REASON select-committee source for chamber question",
    gap: "LEAK_MARKER_GAP the adjudicator thinks the draft is wrong",
    recoveryGap: "LEAK_MARKER_RECOVERY_GAP",
  };
  const raw = {
    status: "v40_quoted_source_adjudication",
    candidateCount: 4,
    selected: ["SO 1"],
    rejected: [
      `${markers.rejectedLabel}:scope-not-established:actor`,
      `${markers.rejectedRuling}:${markers.proseReason}`,
      "unknown-source:unavailable-or-duplicate",
    ],
    gaps: [markers.gap, markers.recoveryGap],
    providerAttempts: 1,
    dossier: ["standing_orders:SO 1"],
    retrievedOutsideDossier: [],
    dispositions: [
      { citationLabel: "SO 1", corpus: "standing_orders", status: "admitted", reason: "verified_source_witness", role: "governing" },
      { citationLabel: markers.rejectedLabel, corpus: "standing_orders", status: "rejected", reason: "scope-not-established:actor", role: "governing" },
      { citationLabel: markers.rejectedRuling, corpus: "speakers_rulings", status: "rejected", reason: markers.proseReason, role: "qualification" },
      { citationLabel: markers.recoveryLabel, corpus: "standing_orders", status: "not_nominated", reason: "model_did_not_nominate", role: null },
    ],
    unavailableNominations: 1,
    recovery: {
      status: "v40_no_governing_witness",
      candidates: [],
      dispositions: [
        { citationLabel: markers.recoveryLabel, corpus: "standing_orders", status: "rejected", reason: "unverified-verbatim-witness", role: "governing" },
      ],
      unavailableNominations: 0,
      selected: [],
      rejected: [`${markers.recoveryLabel}:unverified-verbatim-witness`, "missing-primary-governing-witness"],
    },
  };
  const sent = publicScenarioAdjudication(raw);
  const event = JSON.stringify({ selectorSummary: { scenarioAdjudication: sent } });
  const selector = {
    candidateCount: 4, minObligationCoverage: 1, allObligationsComplete: true,
    obligationDetails: [], prePruneLabels: ["SO 1"], selectedLabels: ["SO 1"],
  };
  // The snapshot must filter both the public form and an unfiltered (older) payload.
  const snapshots = [sent, raw].map((scenarioAdjudication) => formatAiDebugSnapshot({
    ...EMPTY_AI_DIAGNOSTICS,
    selectorSummary: { ...selector, scenarioAdjudication },
  }));
  for (const blob of [event, ...snapshots]) {
    for (const marker of [markers.rejectedLabel, markers.rejectedRuling, markers.recoveryLabel, "LEAK_MARKER", "select-committee", "adjudicator thinks"]) {
      assert.equal(blob.includes(marker), false, `${marker} leaked`);
    }
  }
  assert.deepEqual(sent.rejected, ["rejected=3", "scope-not-established:actor=1", "other_reason=1", "unavailable-or-duplicate=1"]);
  assert.deepEqual(sent.gaps, ["unresolved_facets=2"]);
  assert.deepEqual(sent.dispositions, []);
  assert.deepEqual(sent.selected, []);
  assert.deepEqual(sent.dossier, []);
  assert.equal(sent.dossierCount, 1);
  assert.equal(sent.selectedCount, 1);
  assert.deepEqual(sent.dispositionCounts, [
    "admitted:verified_source_witness=1", "rejected:scope-not-established:actor=1",
    "rejected:other_reason=1", "not_nominated:model_did_not_nominate=1",
  ]);
  assert.deepEqual(sent.recovery.rejected, ["rejected=2", "unverified-verbatim-witness=1", "missing-primary-governing-witness=1"]);
  assert.deepEqual(publicScenarioAdjudication(sent), sent, "filtering is idempotent");
  for (const snapshot of snapshots) {
    assert.match(snapshot, /Primary refusals: rejected=3; scope-not-established:actor=1/);
    assert.match(snapshot, /Unresolved facets: unresolved_facets=2/);
    assert.equal(snapshot.includes("standing_orders:SO 1 — admitted"), false);
    assert.match(snapshot, /Dossier entries: 1/);
  }
});

test("debug snapshot keeps the route's fixed prune count and drops any other prune text", () => {
  const snapshotFor = (pruneNote: string | null) => formatAiDebugSnapshot({
    ...EMPTY_AI_DIAGNOSTICS,
    terminalValidation: {
      degraded: false, fallbackReason: null, rewriteNote: null, pruneNote,
      claimValidationNote: null, invalidCitations: [],
    },
  });
  assert.match(snapshotFor("Pruned unsupported lines: 3"), /Deterministic pruning: Pruned unsupported lines: 3\n/);
  assert.match(snapshotFor("Pruned unsupported lines: 12"), /Deterministic pruning: Pruned unsupported lines: 12\n/);
  for (const note of [
    "Pruned unsupported lines: 3 LEAK_MARKER_PRUNE",
    "Pruned unsupported lines: three",
    "Pruned unsupported lines: 3; The Speaker must expel the member.",
    "Pruned unsupported lines: -1",
    "Pruned unsupported lines: 12345",
    " Pruned unsupported lines: 3",
    "LEAK_MARKER_PRUNE Pruned unsupported lines: 3",
    "Pruned line: The Speaker must expel the member.",
  ]) {
    const snapshot = snapshotFor(note);
    assert.equal(snapshot.includes("LEAK_MARKER"), false, note);
    assert.equal(snapshot.includes("expel"), false, note);
    assert.match(snapshot, /Deterministic pruning: None reported\n/, note);
  }
});

test("a refused dossier label and an unshown selected label stay out of public diagnostics", () => {
  const refused = "QX REFUSED GOVERNING";
  const unshown = "QX NEVER SHOWN";
  const raw = {
    status: "v40_no_governing_witness",
    candidateCount: 1,
    selected: [unshown],
    rejected: [`${refused}:scope-not-established:actor`],
    gaps: ["a private gap"],
    providerAttempts: 1,
    dossier: [`standing_orders:${refused}`],
    retrievedOutsideDossier: [],
    dispositions: [{ citationLabel: refused, corpus: "standing_orders", status: "rejected", reason: "scope-not-established:actor", role: "governing" }],
    unavailableNominations: 0,
    recovery: {
      status: "not_needed",
      candidates: [`standing_orders:${refused}`],
      dispositions: [],
      unavailableNominations: 0,
      selected: [unshown],
      rejected: [],
    },
  };
  const sent = publicScenarioAdjudication(raw);
  const event = JSON.stringify({ selectorSummary: { scenarioAdjudication: sent } });
  const snapshot = formatAiDebugSnapshot({
    ...EMPTY_AI_DIAGNOSTICS,
    selectorSummary: {
      candidateCount: 0, minObligationCoverage: 0, allObligationsComplete: false,
      obligationDetails: [], prePruneLabels: [], selectedLabels: [], scenarioAdjudication: raw,
    },
  });
  for (const blob of [event, snapshot]) {
    assert.equal(blob.includes(refused), false, blob.slice(0, 200));
    assert.equal(blob.includes(unshown), false);
  }
  assert.deepEqual(sent.selected, []);
  assert.deepEqual(sent.dossier, []);
  assert.deepEqual(sent.recovery.selected, []);
  assert.deepEqual(sent.recovery.candidates, ["recovery_candidates=1"]);
  assert.deepEqual(sent.gaps, ["unresolved_facets=1"]);
});

test("provider failure codes stay, and a token with a space does not", () => {
  assert.equal(
    clientCheckNote(["code=UNAVAILABLE", "code=RESOURCE_EXHAUSTED", "kind=LEAKMARKER", "code=SO 404"]),
    "code=UNAVAILABLE;code=RESOURCE_EXHAUSTED",
  );
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { describeMissingAuthoritySlots } from "../lib/procedural-reasoning";
import { clientCheckNote } from "../lib/open-order/client-check-note";
import { publicScenarioAdjudication } from "../lib/open-order/public-diagnostics";

const PRIMARY = [
  "not_invoked",
  "v40_quoted_source_adjudication",
  "v40_no_governing_witness",
  "v402_independent_governing_recovery",
  "no_retrieved_source_bodies",
  "adjudication_unavailable:provider_transient",
  "adjudication_unavailable:provider_nonretryable",
  "adjudication_unavailable:validation_format",
  "adjudication_unavailable:application_or_unknown",
];
const RECOVERY = [
  "not_needed",
  "v40_quoted_source_adjudication",
  "v40_no_governing_witness",
  "no_eligible_sources",
  "time_budget_exhausted",
  "provider_unavailable",
  "invalid_structured_result",
  "accepted_source_witness",
];

function empty(status: string, recoveryStatus: string) {
  return publicScenarioAdjudication({
    status,
    candidateCount: 0,
    selected: [],
    rejected: [],
    gaps: [],
    providerAttempts: 0,
    dossier: [],
    retrievedOutsideDossier: [],
    dispositions: [],
    unavailableNominations: 0,
    recovery: {
      status: recoveryStatus,
      candidates: [],
      dispositions: [],
      unavailableNominations: 0,
      selected: [],
      rejected: [],
    },
  });
}

test("every status the route emits stays a code", () => {
  for (const status of PRIMARY) {
    assert.equal(empty(status, "not_needed").status, status, status);
  }
  for (const status of RECOVERY) {
    assert.equal(empty("not_needed", status).recovery.status, status, status);
  }
});

test("every repair diagnostic the route emits survives the allow-list", () => {
  const source = readFileSync(new URL("../app/api/ai/answer/route.ts", import.meta.url), "utf8");
  const phases = [...source.matchAll(/repairPhase = "([a-z_]+)"/g)].map((match) => match[1]);
  const fixed = [...source.matchAll(/v401RepairDiagnostic = "([a-z_]+)"/g)].map((match) => match[1]);
  const reasons = [...source.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]).filter((token) => token === "empty_repair");
  assert.ok(phases.length >= 4, phases.join(","));
  for (const phase of phases) {
    for (const kind of ["provider_transient", "provider_nonretryable", "validation_format", "application_or_unknown"]) {
      const token = `incident_repair=unavailable:${phase}:${kind}`;
      assert.equal(clientCheckNote([token]), token, token);
    }
  }
  for (const status of [...new Set(fixed)]) {
    const token = `incident_repair=${status}`;
    assert.equal(clientCheckNote([token]), token, token);
  }
  for (const reason of [...new Set([...reasons, "missing_bottom_line", "empty_repair"])]) {
    const token = `incident_repair=refused:${reason}`;
    assert.equal(clientCheckNote([token]), token, token);
  }
  for (const token of ["status=429", "status=503", "code=none", "incident_repair=independent_review_pending"]) {
    assert.equal(clientCheckNote([token]), token, token);
  }
});

test("missing-slot gaps are built without planner query text", () => {
  const source = readFileSync(new URL("../app/api/ai/answer/route.ts", import.meta.url), "utf8");
  assert.match(source, /describeMissingAuthoritySlots\(\{[\s\S]*?plannerQueries: \[\]/);
  const gaps = describeMissingAuthoritySlots({
    question: "May the House suspend the sitting?",
    plannerQueries: [],
    missingRequiredSlots: ["governing-rule"],
  });
  assert.equal(JSON.stringify(gaps).includes("SO 99"), false);
  assert.equal(JSON.stringify(gaps).includes("Ruling 999"), false);
});

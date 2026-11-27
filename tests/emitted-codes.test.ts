import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { AI_ERROR_KINDS } from "../lib/ai/errors";
import { classifyAiError, DIAGNOSTIC_KINDS, NONRETRYABLE_CODES, TRANSIENT_CODES, TRANSIENT_STATUSES } from "../lib/ai/provider-resilience";
import { v402RepairRefusals } from "../lib/ai/scenario-adjudication";
import { describeMissingAuthoritySlots } from "../lib/procedural-reasoning";
import { clientCheckNote, forumCountCodes } from "../lib/open-order/client-check-note";
import { publicScenarioAdjudication } from "../lib/open-order/public-diagnostics";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function stringsIn(block: string): string[] {
  return [...block.matchAll(/"([a-z][a-z0-9_]*)"/g)].map((match) => match[1]);
}

function repairReasons(): string[] {
  const withClaims = v402RepairRefusals({
    hasBottomLine: false,
    citationValid: false,
    mentionValid: false,
    sourceQualificationVetoes: 1,
    responsive: false,
    unaddressedParts: ["part"],
    claimIds: ["a", "a"],
    validatedClaims: [
      { id: "b", supported: false },
      { id: "b", supported: false },
    ],
  });
  const counted = v402RepairRefusals({
    hasBottomLine: true,
    citationValid: true,
    mentionValid: true,
    sourceQualificationVetoes: 0,
    responsive: true,
    unaddressedParts: [],
    claimIds: ["a"],
    validatedClaims: [],
  });
  const empty = v402RepairRefusals({
    hasBottomLine: true,
    citationValid: true,
    mentionValid: true,
    sourceQualificationVetoes: 0,
    responsive: true,
    unaddressedParts: [],
    claimIds: [],
    validatedClaims: [],
  });
  return [...new Set([...withClaims, ...counted, ...empty])];
}

function emptyAdjudication(status: string, recoveryStatus: string) {
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

test("every status the diagnostics module names stays a code", () => {
  const diagnostics = source("../lib/open-order/public-diagnostics.ts");
  const statusBlock = diagnostics.slice(
    diagnostics.indexOf("const ADJUDICATION_STATUS"),
    diagnostics.indexOf("const FAILURE_KIND"),
  );
  const failureBlock = diagnostics.slice(
    diagnostics.indexOf("const FAILURE_KIND"),
    diagnostics.indexOf("function knownReason"),
  );
  const statuses = stringsIn(statusBlock);
  const failures = stringsIn(failureBlock);
  assert.ok(statuses.length > 0);
  for (const status of statuses) {
    assert.equal(emptyAdjudication(status, "not_needed").status, status, status);
  }
  for (const kind of failures) {
    const status = `adjudication_unavailable:${kind}`;
    assert.equal(emptyAdjudication(status, "not_needed").status, status, status);
  }
});

test("every emitted diagnostic survives, and a value the code does not emit is rejected", () => {
  const route = source("../app/api/ai/answer/route.ts");
  const phases = [...route.matchAll(/repairPhase = "([a-z_]+)"/g)].map((match) => match[1]);
  const fixed = [...route.matchAll(/v401RepairDiagnostic = "([a-z_]+)"/g)].map((match) => match[1]);
  const preliminary = route.slice(route.indexOf("const preliminaryRefusals"), route.indexOf("].filter(Boolean)"));
  const recovery = [...route.matchAll(/reconstructionDiagnostic = "([a-z_]+)"/g)].map((match) => match[1]);
  const reasons = [...new Set([...repairReasons(), ...stringsIn(preliminary)])];
  assert.ok(phases.length >= 4, phases.join(","));
  assert.ok(reasons.includes("empty_repair"), reasons.join(","));
  assert.ok(reasons.length >= 13, reasons.join(","));

  const tokens: string[] = [];
  for (const phase of phases) {
    for (const kind of DIAGNOSTIC_KINDS) tokens.push(`incident_repair=unavailable:${phase}:${kind}`);
  }
  for (const status of new Set(fixed)) tokens.push(`incident_repair=${status}`);
  for (const reason of reasons) tokens.push(`incident_repair=refused:${reason}`);
  tokens.push(`incident_repair=refused:${reasons.join(",")}`);
  for (const status of recovery) tokens.push(`bottom_line_recovery=${status}`);
  for (const code of [...TRANSIENT_CODES, ...NONRETRYABLE_CODES]) tokens.push(`code=${code}`);
  for (const kind of AI_ERROR_KINDS) tokens.push(`code=${kind.toUpperCase()}`);
  tokens.push("code=none");
  for (const status of TRANSIENT_STATUSES) tokens.push(`status=${status}`);
  tokens.push("status=none", "status=400", "status=500");
  for (const kind of DIAGNOSTIC_KINDS) tokens.push(`kind=${kind}`);
  const claimPrefix = source("../lib/procedural-reasoning.ts").match(/id: `claim-\$\{/)?.[0];
  assert.ok(claimPrefix, "claim ids are emitted as claim-N");
  const claimIds = Array.from({ length: 16 }, (_, index) => `claim-${index + 1}`);
  tokens.push(`claim_ids=${claimIds.join(",")}`, "claim_ids=none");
  tokens.push(...forumCountCodes("selector_forum", { identity: 2, ambiguous: 3 }));
  tokens.push(...forumCountCodes("overlooked_forum", { identity: 1, ambiguous: 0 }));

  for (const token of tokens) {
    assert.equal(clientCheckNote([token]), token, token);
  }

  const kindOnly = classifyAiError({ kind: "configuration" }, "drafting");
  assert.equal(kindOnly.code, null);
  for (const kind of AI_ERROR_KINDS) {
    const diagnosed = classifyAiError({ code: kind }, "drafting");
    assert.equal(diagnosed.code, kind.toUpperCase(), kind);
    assert.equal(clientCheckNote([`code=${diagnosed.code}`]), `code=${diagnosed.code}`);
  }
  assert.equal(clientCheckNote(["incident_repair=unavailable:generation:configuration"]), null);
  assert.equal(clientCheckNote(["code=NOT_A_REAL_CODE"]), null);
  assert.equal(clientCheckNote(["incident_repair=refused:not_a_reason"]), null);
});

test("missing-slot gaps are built without planner query text", () => {
  const route = source("../app/api/ai/answer/route.ts");
  assert.match(route, /describeMissingAuthoritySlots\(\{[\s\S]*?plannerQueries: \[\]/);
  const gaps = describeMissingAuthoritySlots({
    question: "May the House suspend the sitting?",
    plannerQueries: [],
    missingRequiredSlots: ["governing-rule"],
  });
  assert.equal(JSON.stringify(gaps).includes("SO 99"), false);
  assert.equal(JSON.stringify(gaps).includes("Ruling 999"), false);
});

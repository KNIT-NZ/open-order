import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { classifyAiError, DIAGNOSTIC_KINDS, NONRETRYABLE_CODES, TRANSIENT_CODES, TRANSIENT_STATUSES } from "../lib/ai/provider-resilience";
import { EMPTY_REPAIR_REASON, V402_REPAIR_REASONS, v402RepairRefusals } from "../lib/ai/scenario-adjudication";
import { CLAIM_ID_MAX_LENGTH } from "../lib/open-order/client-check-note";
import { COUNT_DIGITS, FORUM_COUNT_WIDTH, RECOVERY_COUNT_DIGITS } from "../lib/open-order/emitted-widths";
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
  assert.deepEqual([...reasons].sort(), [...new Set([...V402_REPAIR_REASONS, EMPTY_REPAIR_REASON])].sort());
  assert.equal(repairReasons().length, V402_REPAIR_REASONS.length);

  const tokens: string[] = [];
  for (const phase of phases) {
    for (const kind of DIAGNOSTIC_KINDS) tokens.push(`incident_repair=unavailable:${phase}:${kind}`);
  }
  for (const status of new Set(fixed)) tokens.push(`incident_repair=${status}`);
  for (const reason of reasons) tokens.push(`incident_repair=refused:${reason}`);
  tokens.push(`incident_repair=refused:${reasons.join(",")}`);
  for (const status of recovery) tokens.push(`bottom_line_recovery=${status}`);
  for (const code of [...TRANSIENT_CODES, ...NONRETRYABLE_CODES]) tokens.push(`code=${code}`);
  tokens.push("code=none");
  for (const status of TRANSIENT_STATUSES) tokens.push(`status=${status}`);
  const statusBounds = source("../lib/ai/provider-resilience.ts").match(/value >= (\d+) && value <= (\d+)/);
  assert.ok(statusBounds);
  const statusLow = statusBounds[1];
  const statusHigh = statusBounds[2];
  const noneStatus = route.match(/httpStatus \?\? "([a-z]+)"/)?.[1];
  assert.ok(noneStatus);
  tokens.push(`status=${noneStatus}`, `status=${statusLow}`, `status=${statusHigh}`);
  for (const kind of DIAGNOSTIC_KINDS) tokens.push(`kind=${kind}`);
  const claimPrefix = source("../lib/procedural-reasoning.ts").match(/id: `claim-\$\{/)?.[0];
  assert.ok(claimPrefix, "claim ids are emitted as claim-N");
  const claimIds = Array.from({ length: 16 }, (_, index) => `claim-${index + 1}`);
  const widest = `claim-${"9".repeat(CLAIM_ID_MAX_LENGTH - "claim-".length)}`;
  tokens.push(`claim_ids=${claimIds.join(",")}`, `claim_ids=${widest}`, "claim_ids=none");
  tokens.push(...forumCountCodes("selector_forum", { identity: 2, ambiguous: 3 }));
  tokens.push(...forumCountCodes("overlooked_forum", { identity: 1, ambiguous: 0 }));

  for (const token of tokens) {
    assert.equal(clientCheckNote([token]), token, token);
  }

  const kindOnly = classifyAiError({ kind: "configuration" }, "drafting");
  assert.equal(kindOnly.code, null);
  for (const upstream of ["ECONNREFUSED", "ENOTFOUND", "UND_ERR_CONNECT_TIMEOUT", "INTERNAL", "INSUFFICIENT_QUOTA", "CONFIGURATION"]) {
    const diagnosed = classifyAiError({ code: upstream }, "drafting");
    assert.equal(diagnosed.code, null, upstream);
    assert.equal(clientCheckNote([`code=${upstream}`]), null, upstream);
  }
  assert.equal(clientCheckNote(["code=none"]), "code=none");
  assert.equal(clientCheckNote(["incident_repair=unavailable:generation:configuration"]), null);
  assert.equal(clientCheckNote(["incident_repair=unavailable:generation:provider_transient:extra"]), null);
  assert.equal(clientCheckNote(["code=NOT_A_REAL_CODE"]), null);
  assert.equal(clientCheckNote(["incident_repair=refused:not_a_reason"]), null);
  assert.equal(clientCheckNote(["incident_repair=refused:no_claims,"]), null);
  assert.equal(clientCheckNote(["incident_repair=refused:,no_claims"]), null);
  assert.equal(clientCheckNote(["incident_repair=refused:no_claims,,invalid_citations"]), null);
  assert.equal(clientCheckNote(["claim_ids=claim-1,"]), null);
  assert.equal(clientCheckNote([`incident_repair=refused:${reasons[0]},${reasons[0]}`]), null);
  const outerUnknown = classifyAiError({ code: "INSUFFICIENT_QUOTA", cause: { code: "ECONNRESET" } }, "drafting");
  assert.equal(outerUnknown.code, "ECONNRESET");
  assert.equal(clientCheckNote(["code=ECONNRESET"]), "code=ECONNRESET");
  const overForum = "1".repeat(FORUM_COUNT_WIDTH + 1);
  assert.equal(clientCheckNote([`selector_forum=forum-identity:${overForum}`]), null);
  assert.equal(clientCheckNote([`overlooked_forum=forum-ambiguous:${overForum}`]), null);
  assert.equal(clientCheckNote([`selector_forum_withheld=forum-identity:${overForum}`]), null);
  const overCount = "1".repeat(COUNT_DIGITS + 1);
  assert.equal(clientCheckNote([`rewritten_mentions=${overCount}`]), null);
  assert.equal(clientCheckNote([`attempts=${overCount}`]), null);
  const overRecovery = "1".repeat(RECOVERY_COUNT_DIGITS + 1);
  assert.equal(clientCheckNote([`recovery_candidates=${overRecovery}`]), null);
  assert.equal(clientCheckNote(["bottom_line_before=maybe"]), null);
  assert.equal(clientCheckNote(["citations_valid=maybe"]), null);
  assert.equal(clientCheckNote([`incident_repair=refused:${reasons.join(",")},extra_reason`]), null);
  assert.equal(clientCheckNote(["claim_ids=claim-1,claim-1"]), null);
  assert.equal(clientCheckNote([`claim_ids=claim-${"9".repeat(CLAIM_ID_MAX_LENGTH)}`]), null);
  assert.equal(clientCheckNote(["kind=configuration"]), null);
  assert.equal(clientCheckNote(["status=200"]), null);
  assert.equal(clientCheckNote(["provider=local"]), null);
  assert.equal(clientCheckNote(["operation=planning"]), null);
  assert.equal(clientCheckNote(["responsiveness=maybe"]), null);
  assert.equal(clientCheckNote(["repair=rejected"]), null);
  assert.equal(clientCheckNote(["appeal=accepted"]), null);
  assert.equal(clientCheckNote(["bottom_line_recovery=accepted"]), null);
  assert.equal(clientCheckNote(["disposition=other"]), null);
  assert.equal(clientCheckNote(["recovery_candidates=nope"]), null);
  assert.equal(clientCheckNote(["rewritten_mentions=many"]), null);
  assert.equal(clientCheckNote(["retryable=maybe"]), null);
  assert.equal(clientCheckNote(["selector_forum=forum-identity:nope"]), null);
  const kept = forumCountCodes("selector_forum", { identity: 25000, ambiguous: 3 });
  assert.equal(kept.some((token) => token.startsWith("selector_forum=forum-identity:")), true);
  assert.equal(clientCheckNote(kept), kept.join(";"));
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

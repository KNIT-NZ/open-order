import type { AiScenarioAdjudication, AiSourceDisposition } from "./types";
import { COUNT_DIGITS, DIAGNOSTIC_KEY_LENGTH, RECOVERY_COUNT_DIGITS, boundedCount } from "./emitted-widths";

// Public diagnostics are counts and reason codes. Authority labels do not leave
// this function: selected, dossier, the out-of-dossier list, disposition rows,
// and recovery candidates and selected are emptied. Counts replace them.
const COUNTED = new RegExp(`^[a-z0-9_.:,-]{1,${DIAGNOSTIC_KEY_LENGTH}}=\\d{1,${COUNT_DIGITS}}$`, "i");
const SCOPE = /^scope-not-established:(?:actor|setting|action|stage)(?:,(?:actor|setting|action|stage))*$/;
const REASONS = new Set([
  "verified_source_witness", "model_did_not_nominate", "ambiguous-source-identity", "admission_limit",
  "unverified-verbatim-witness", "invalid-source-role", "act_attestation_unconfirmed",
  "forum_identity_unconfirmed", "missing-primary-governing-witness", "unavailable-or-duplicate",
  "forum-identity", "procedure-homonym", "other_reason",
]);
const DISPOSITION_STATUS = new Set(["admitted", "rejected", "not_nominated", "withheld_no_primary", "not_reviewed_limit"]);
const ADJUDICATION_STATUS = new Set([
  "v40_quoted_source_adjudication", "v40_no_governing_witness", "v402_independent_governing_recovery",
  "no_retrieved_source_bodies", "not_reported", "not_needed", "not_invoked",
  "no_eligible_sources", "time_budget_exhausted", "provider_unavailable",
  "invalid_structured_result", "accepted_source_witness",
]);
const FAILURE_KIND = new Set([
  "configuration", "rate_limited", "unavailable", "upstream", "unknown", "parse", "validation", "timeout",
  "provider_transient", "provider_nonretryable", "validation_format", "application_or_unknown",
]);

function knownReason(raw: string): string {
  const text = String(raw ?? "").trim().toLowerCase();
  if (REASONS.has(text) || SCOPE.test(text)) return text;
  return "other_reason";
}

function publicStatus(raw: string): string {
  const text = String(raw ?? "").trim().toLowerCase();
  if (ADJUDICATION_STATUS.has(text)) return text;
  const prefix = "adjudication_unavailable:";
  if (text.startsWith(prefix) && FAILURE_KIND.has(text.slice(prefix.length))) return text;
  return "other";
}

function dispositionStatus(raw: string): string {
  const text = String(raw ?? "").trim().toLowerCase();
  return DISPOSITION_STATUS.has(text) ? text : "other";
}

/** "label:reason" entries (or already-counted codes) become "reason=count" codes. */
export function rejectionCodes(entries: readonly string[] | undefined): string[] {
  const counts = new Map<string, number>();
  const passthrough: string[] = [];
  let total = 0;
  for (const entry of entries ?? []) {
    const text = String(entry ?? "");
    if (COUNTED.test(text)) {
      const key = text.slice(0, text.indexOf("="));
      const kept = key === "rejected" ? text : `${knownReason(key)}=${text.slice(text.indexOf("=") + 1)}`;
      if (!passthrough.includes(kept)) passthrough.push(kept);
      continue;
    }
    const colon = text.indexOf(":");
    const reason = colon >= 0 ? text.slice(colon + 1) : text;
    const code = knownReason(reason);
    counts.set(code, (counts.get(code) ?? 0) + 1);
    total += 1;
  }
  if (total === 0) return passthrough;
  return [`rejected=${boundedCount(total, COUNT_DIGITS)}`, ...[...counts].map(([code, count]) => `${code}=${boundedCount(count, COUNT_DIGITS)}`)];
}

function publicDispositionCount(entry: string): string | null {
  const eq = entry.lastIndexOf("=");
  if (eq < 0 || !new RegExp(`^\\d{1,${COUNT_DIGITS}}$`).test(entry.slice(eq + 1))) return null;
  const key = entry.slice(0, eq);
  const colon = key.indexOf(":");
  if (colon < 0) return null;
  const status = dispositionStatus(key.slice(0, colon));
  const reason = knownReason(key.slice(colon + 1));
  if (status === "other") return null;
  return `${status}:${reason}=${entry.slice(eq + 1)}`;
}

function statusCounts(rows: readonly AiSourceDisposition[] | undefined, prior?: readonly string[]): string[] {
  const counted = (prior ?? []).flatMap((item) => {
    if (!COUNTED.test(item)) return [];
    const checked = publicDispositionCount(item);
    return checked ? [checked] : [];
  });
  if (counted.length > 0 || !rows || rows.length === 0) return counted;
  const counts = new Map<string, number>();
  for (const row of rows) {
    const code = `${dispositionStatus(row.status)}:${knownReason(row.reason)}`;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts].map(([code, count]) => `${code}=${count}`);
}

function nonNegativeInt(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function gapCodes(gaps: readonly string[] | undefined): string[] {
  const list = gaps ?? [];
  if (list.length === 1 && new RegExp(`^unresolved_facets=\\d{1,${COUNT_DIGITS}}$`).test(list[0] ?? "")) return [...list];
  return list.length > 0 ? [`unresolved_facets=${boundedCount(list.length, COUNT_DIGITS)}`] : [];
}

type NominationInput = {
  rejectedGoverning?: Array<{ inDossier?: boolean }> | number;
  rejectedInDossier?: number;
  rejectedOutsideDossier?: number;
};

function nominationCounts(input: NominationInput): {
  rejectedGoverning: number; rejectedInDossier: number; rejectedOutsideDossier: number;
} | null {
  if (input.rejectedGoverning === undefined && input.rejectedInDossier === undefined
    && input.rejectedOutsideDossier === undefined) return null;
  if (typeof input.rejectedGoverning === "number" || typeof input.rejectedInDossier === "number"
    || typeof input.rejectedOutsideDossier === "number") {
    const inside = nonNegativeInt(input.rejectedInDossier);
    const outside = nonNegativeInt(input.rejectedOutsideDossier);
    const supplied = nonNegativeInt(input.rejectedGoverning);
    const total = input.rejectedInDossier !== undefined || input.rejectedOutsideDossier !== undefined
      ? inside + outside
      : supplied;
    return {
      rejectedGoverning: total,
      rejectedInDossier: input.rejectedInDossier !== undefined || input.rejectedOutsideDossier !== undefined ? inside : 0,
      rejectedOutsideDossier: input.rejectedInDossier !== undefined || input.rejectedOutsideDossier !== undefined ? outside : total,
    };
  }
  const rows = Array.isArray(input.rejectedGoverning) ? input.rejectedGoverning : [];
  let inside = 0;
  let outside = 0;
  for (const row of rows) {
    if (row?.inDossier === true) inside += 1;
    else outside += 1;
  }
  return { rejectedGoverning: inside + outside, rejectedInDossier: inside, rejectedOutsideDossier: outside };
}

type PublicInput = AiScenarioAdjudication & NominationInput & {
  selectedCount?: number;
  dossierCount?: number;
  outsideDossierCount?: number;
  recovery?: AiScenarioAdjudication["recovery"] & { selectedCount?: number };
};

export function publicScenarioAdjudication(input: PublicInput): PublicInput {
  const recovery = input.recovery;
  const nominations = nominationCounts(input);
  const recoveryCandidates = recovery?.candidates ?? [];
  const recoveryCandidateCode = recoveryCandidates.length === 1 && new RegExp(`^recovery_candidates=\\d{1,${RECOVERY_COUNT_DIGITS}}$`).test(recoveryCandidates[0] ?? "")
    ? [...recoveryCandidates]
    : [`recovery_candidates=${boundedCount(recoveryCandidates.length, RECOVERY_COUNT_DIGITS)}`];
  return {
    status: publicStatus(input.status),
    candidateCount: Number(input.candidateCount) || 0,
    selected: [],
    selectedCount: input.selected?.length ? input.selected.length : nonNegativeInt(input.selectedCount),
    rejected: rejectionCodes(input.rejected),
    gaps: gapCodes(input.gaps),
    providerAttempts: Number(input.providerAttempts) || 0,
    dossier: [],
    dossierCount: input.dossier?.length ? input.dossier.length : nonNegativeInt(input.dossierCount),
    retrievedOutsideDossier: [],
    outsideDossierCount: input.retrievedOutsideDossier?.length
      ? input.retrievedOutsideDossier.length
      : nonNegativeInt(input.outsideDossierCount),
    dispositions: [],
    dispositionCounts: statusCounts(input.dispositions, input.dispositionCounts),
    unavailableNominations: Number(input.unavailableNominations) || 0,
    ...(nominations ?? {}),
    recovery: {
      status: publicStatus(recovery?.status ?? "not_reported"),
      candidates: recoveryCandidateCode,
      dispositions: [],
      dispositionCounts: statusCounts(recovery?.dispositions, recovery?.dispositionCounts),
      unavailableNominations: Number(recovery?.unavailableNominations) || 0,
      selected: [],
      selectedCount: recovery?.selected?.length ? recovery.selected.length : nonNegativeInt(recovery?.selectedCount),
      rejected: rejectionCodes(recovery?.rejected),
    },
  };
}

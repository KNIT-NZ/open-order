import type { AiScenarioAdjudication, AiSourceDisposition } from "./types";

// Public diagnostics are counts and reason codes. Authority labels do not leave
// this function: selected, dossier, the out-of-dossier list, disposition rows,
// and recovery candidates and selected are emptied. Counts replace them.
const CODE = /^[a-z0-9_.:,-]{1,64}$/i;
const COUNTED = /^[a-z0-9_.:,-]{1,64}=\d{1,4}$/i;

// A reason is kept only when it is already a code. Prose (including fixed
// server prose) becomes "other_reason" so no sentence can ride out as a slug.
function reasonCode(raw: string): string {
  const text = String(raw ?? "").trim();
  return CODE.test(text) ? text.toLowerCase() : "other_reason";
}

/** "label:reason" entries (or already-counted codes) become "reason=count" codes. */
export function rejectionCodes(entries: readonly string[] | undefined): string[] {
  const counts = new Map<string, number>();
  const passthrough: string[] = [];
  let total = 0;
  for (const entry of entries ?? []) {
    const text = String(entry ?? "");
    if (COUNTED.test(text)) { if (!passthrough.includes(text)) passthrough.push(text); continue; }
    const colon = text.indexOf(":");
    const reason = colon >= 0 ? text.slice(colon + 1) : text;
    const code = reasonCode(reason);
    counts.set(code, (counts.get(code) ?? 0) + 1);
    total += 1;
  }
  if (total === 0) return passthrough;
  return [`rejected=${total}`, ...[...counts].map(([code, count]) => `${code}=${count}`)];
}

function statusCounts(rows: readonly AiSourceDisposition[] | undefined, prior?: readonly string[]): string[] {
  const counted = (prior ?? []).filter((item) => COUNTED.test(item));
  if (counted.length > 0 || !rows || rows.length === 0) return counted;
  const counts = new Map<string, number>();
  for (const row of rows) {
    const code = `${reasonCode(row.status)}:${reasonCode(row.reason)}`;
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
  if (list.length === 1 && /^unresolved_facets=\d{1,2}$/.test(list[0])) return [...list];
  return list.length > 0 ? [`unresolved_facets=${list.length}`] : [];
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
  const recoveryCandidateCode = recoveryCandidates.length === 1 && /^recovery_candidates=\d+$/.test(recoveryCandidates[0] ?? "")
    ? [...recoveryCandidates]
    : [`recovery_candidates=${recoveryCandidates.length}`];
  return {
    status: reasonCode(input.status),
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
      status: reasonCode(recovery?.status ?? "not_reported"),
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

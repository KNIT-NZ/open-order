import type { AiScenarioAdjudication, AiSourceDisposition } from "./types";

// Source-adjudication diagnostics that may reach the client (diagnostics event and
// debug snapshot). Rejected authority labels, their reasons and adjudicator free
// text (gaps) are reduced to counts and reason codes. Admitted labels stay: they are
// already shown as the selected authorities.
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

function admittedOnly(rows: readonly AiSourceDisposition[] | undefined): AiSourceDisposition[] {
  return (rows ?? [])
    .filter((row) => row.status === "admitted")
    .map((row) => ({ citationLabel: row.citationLabel, corpus: row.corpus, status: "admitted",
      reason: reasonCode(row.reason), role: row.role && CODE.test(row.role) ? row.role : null }));
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
  if (typeof input.rejectedGoverning === "number" || typeof input.rejectedInDossier === "number") {
    return {
      rejectedGoverning: Number(input.rejectedGoverning) || 0,
      rejectedInDossier: Number(input.rejectedInDossier) || 0,
      rejectedOutsideDossier: Number(input.rejectedOutsideDossier) || 0,
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

export function publicScenarioAdjudication(
  input: AiScenarioAdjudication & NominationInput,
): AiScenarioAdjudication & NominationInput {
  const recovery = input.recovery;
  const nominations = nominationCounts(input);
  return {
    status: reasonCode(input.status),
    candidateCount: Number(input.candidateCount) || 0,
    selected: [...(input.selected ?? [])],
    rejected: rejectionCodes(input.rejected),
    gaps: gapCodes(input.gaps),
    providerAttempts: Number(input.providerAttempts) || 0,
    dossier: [...(input.dossier ?? [])],
    retrievedOutsideDossier: [...(input.retrievedOutsideDossier ?? [])],
    dispositions: admittedOnly(input.dispositions),
    dispositionCounts: statusCounts(input.dispositions, input.dispositionCounts),
    unavailableNominations: Number(input.unavailableNominations) || 0,
    ...(nominations ?? {}),
    recovery: {
      status: reasonCode(recovery?.status ?? "not_reported"),
      candidates: [...(recovery?.candidates ?? [])],
      dispositions: admittedOnly(recovery?.dispositions),
      dispositionCounts: statusCounts(recovery?.dispositions, recovery?.dispositionCounts),
      unavailableNominations: Number(recovery?.unavailableNominations) || 0,
      selected: [...(recovery?.selected ?? [])],
      rejected: rejectionCodes(recovery?.rejected),
    },
  };
}

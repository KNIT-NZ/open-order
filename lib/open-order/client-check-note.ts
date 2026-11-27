const ALLOWED_KEY = /^(?:rewritten_mentions|pruned_lines|invalid_citations|ungrounded_mentions|responsiveness|incident_repair|pruned_unsupported_claims|claim_ids|appeal_attempted|appeal_corroborated|appeal_unavailable|bottom_line_before|bottom_line_after|draft_claims|rejected_claims|remaining_claims|citations_valid|mentions_valid|appeal|bottom_line_recovery|claim_check_attempts|repair|repair_attempts|operation|kind|status|code|provider|retryable|attempts|unresolved_facets|primary_refusal|recovery_refusal|disposition|recovery_candidates)$/;
const ALLOWED_BARE = new Set(["v29_semantic_fallback"]);
const CODE_VALUE = /^[a-z0-9_.,:-]{1,120}$/;

/**
 * Client-visible check text: an allow-list of codes, counts and claim ids.
 * Model prose, authority labels and pruned excerpts do not match.
 */
export function clientCheckNote(parts: Array<string | null | undefined>): string | null {
  const kept: string[] = [];
  for (const part of parts) {
    for (const piece of String(part ?? "").split(";")) {
      const token = piece.trim();
      if (!acceptCheckToken(token) || kept.includes(token)) continue;
      kept.push(token);
    }
  }
  return kept.length > 0 ? kept.join(";") : null;
}

export function acceptCheckToken(token: string): boolean {
  if (ALLOWED_BARE.has(token)) return true;
  const split = token.indexOf("=");
  if (split <= 0) return false;
  const key = token.slice(0, split);
  const value = token.slice(split + 1);
  return ALLOWED_KEY.test(key) && CODE_VALUE.test(value);
}

type PublicDisposition = {
  citationLabel: string;
  corpus: string;
  status: string;
  reason: string;
  role: string | null;
};

type PublicAdjudication = {
  status: string;
  candidateCount: number;
  selected: string[];
  rejected: string[];
  gaps: string[];
  providerAttempts: number;
  dossier: string[];
  retrievedOutsideDossier: string[];
  dispositions: PublicDisposition[];
  unavailableNominations: number;
  recovery: {
    status: string;
    candidates: string[];
    dispositions: PublicDisposition[];
    unavailableNominations: number;
    selected: string[];
    rejected: string[];
  };
};

function reasonToken(entry: string): string {
  const text = String(entry ?? "");
  const colon = text.indexOf(":");
  const reason = (colon >= 0 ? text.slice(colon + 1) : text).trim();
  if (!/^[a-z0-9_:-]+$/i.test(reason)) return "other";
  return reason.toLowerCase();
}

function tally(prefix: "primary_refusal" | "recovery_refusal" | "disposition", codes: string[]): string[] {
  const counts = new Map<string, number>();
  for (const code of codes) {
    const token = /^[a-z0-9_-]+$/.test(code) ? code : "other";
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return [...counts.entries()].map(([token, count]) => `${prefix}=${token}:${count}`);
}

function dispositionTokens(rows: Array<{ status?: string; reason?: string }> | undefined): string[] {
  return tally("disposition", (rows ?? []).map((row) => {
    const status = /^[a-z0-9_]+$/i.test(String(row?.status ?? "")) ? String(row.status).toLowerCase() : "other";
    return `${status}_${reasonToken(String(row?.reason ?? "")).replace(/:/g, "_")}`;
  }));
}

/** Client copy of source adjudication: counts and reason codes, no free text and no rejected labels. */
export function publicScenarioAdjudication(input: PublicAdjudication | null | undefined): PublicAdjudication | undefined {
  if (!input) return undefined;
  const recovery = input.recovery ?? {
    status: "not_needed", candidates: [], dispositions: [], unavailableNominations: 0, selected: [], rejected: [],
  };
  return {
    status: /^[a-z0-9_:-]+$/i.test(input.status) ? input.status : "other",
    candidateCount: Number(input.candidateCount) || 0,
    selected: [],
    rejected: tally("primary_refusal", (input.rejected ?? []).map(reasonToken)),
    gaps: [`unresolved_facets=${(input.gaps ?? []).length}`],
    providerAttempts: Number(input.providerAttempts) || 0,
    dossier: [],
    retrievedOutsideDossier: [],
    dispositions: [],
    unavailableNominations: Number(input.unavailableNominations) || 0,
    recovery: {
      status: /^[a-z0-9_:-]+$/i.test(recovery.status) ? recovery.status : "other",
      candidates: [`recovery_candidates=${(recovery.candidates ?? []).length}`],
      dispositions: [],
      unavailableNominations: Number(recovery.unavailableNominations) || 0,
      selected: [],
      rejected: tally("recovery_refusal", (recovery.rejected ?? []).map(reasonToken)),
    },
  };
}

export function adjudicationNote(input: PublicAdjudication | null | undefined): string | null {
  if (!input) return null;
  const safe = publicScenarioAdjudication(input);
  if (!safe) return null;
  return clientCheckNote([
    ...safe.rejected,
    ...safe.gaps,
    ...dispositionTokens(input.dispositions),
    ...safe.recovery.rejected,
    ...safe.recovery.candidates,
    ...dispositionTokens(input.recovery?.dispositions),
  ]);
}

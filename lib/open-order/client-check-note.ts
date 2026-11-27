const ALLOWED_KEY = /^(?:rewritten_mentions|pruned_lines|invalid_citations|ungrounded_mentions|responsiveness|incident_repair|pruned_unsupported_claims|claim_ids|appeal_attempted|appeal_corroborated|appeal_unavailable|bottom_line_before|bottom_line_after|draft_claims|rejected_claims|remaining_claims|citations_valid|mentions_valid|appeal|bottom_line_recovery|claim_check_attempts|repair|repair_attempts|operation|kind|status|code|provider|retryable|attempts|unresolved_facets|primary_refusal|recovery_refusal|disposition|recovery_candidates|selector_forum|overlooked_forum|selector_forum_withheld)$/;
const ALLOWED_BARE = new Set(["v29_semantic_fallback"]);
const CODE_VALUE = /^[a-z0-9_.,:-]{1,120}$/;
// Provider failure codes are uppercase (UNAVAILABLE, RESOURCE_EXHAUSTED). Only this key accepts them.
const CODE_KEY_VALUE = /^[A-Za-z0-9_.,:-]{1,120}$/;
const REFUSAL_CODE = /^[a-z0-9_-]+(?::[a-z0-9_-]+)?$/;
const COUNTED_REFUSAL = /^(primary_refusal|recovery_refusal|disposition)=([a-z0-9_-]+(?::[a-z0-9_-]+)?):(\d+)$/;

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
  const valuePattern = key === "code" ? CODE_KEY_VALUE : CODE_VALUE;
  return ALLOWED_KEY.test(key) && valuePattern.test(value);
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
  rejectedGoverning?: Array<{ id?: string; inDossier?: boolean }> | number;
  rejectedInDossier?: number;
  rejectedOutsideDossier?: number;
};

function nominationCounts(input: {
  rejectedGoverning?: Array<{ inDossier?: boolean }> | number;
  rejectedInDossier?: number;
  rejectedOutsideDossier?: number;
}): { rejectedGoverning: number; rejectedInDossier: number; rejectedOutsideDossier: number } {
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

function asRefusalCode(value: string): string | null {
  const text = value.trim().toLowerCase();
  return REFUSAL_CODE.test(text) ? text : null;
}

/** A bare code stays whole. A `label:code` entry keeps the code, including one colon. Prose becomes other. */
function reasonToken(entry: string): string {
  const text = String(entry ?? "").trim();
  const whole = asRefusalCode(text);
  if (whole) return whole;
  const colon = text.indexOf(":");
  if (colon >= 0) {
    const reason = asRefusalCode(text.slice(colon + 1));
    if (reason) return reason;
  }
  return "other";
}

function tally(prefix: "primary_refusal" | "recovery_refusal" | "disposition", items: Array<{ code: string; count: number }>): string[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (item.count <= 0) continue;
    const token = asRefusalCode(item.code) ?? "other";
    counts.set(token, (counts.get(token) ?? 0) + item.count);
  }
  return [...counts.entries()].map(([token, count]) => `${prefix}=${token}:${count}`);
}

function dispositionCode(row: { status?: string; reason?: string }): string {
  const status = /^[a-z0-9_]+$/i.test(String(row?.status ?? "")) ? String(row.status).toLowerCase() : "other";
  return `${status}_${reasonToken(String(row?.reason ?? ""))}`;
}

/** Already-counted refusal lines pass through. Raw rows are counted once, and disposition codes stay with them. */
function publicRefusals(
  prefix: "primary_refusal" | "recovery_refusal",
  entries: string[],
  rows: Array<{ status?: string; reason?: string }> | undefined,
): string[] {
  if (entries.every((entry) => COUNTED_REFUSAL.test(entry)) && (rows ?? []).length === 0) return [...entries];
  const items = entries.map((entry) => {
    const parsed = entry.match(COUNTED_REFUSAL);
    if (parsed && parsed[1] === prefix) return { code: parsed[2], count: Number(parsed[3]) };
    return { code: reasonToken(entry), count: 1 };
  });
  return [
    ...tally(prefix, items),
    ...tally("disposition", (rows ?? []).map((row) => ({ code: dispositionCode(row), count: 1 }))),
  ];
}

function publicCount(entries: string[], key: "unresolved_facets" | "recovery_candidates"): string[] {
  const pattern = new RegExp(`^${key}=(\\d+)$`);
  if (entries.length > 0 && entries.every((entry) => pattern.test(entry))) {
    const total = entries.reduce((sum, entry) => sum + Number(pattern.exec(entry)?.[1] ?? 0), 0);
    return [`${key}=${total}`];
  }
  return [`${key}=${entries.length}`];
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
    rejected: publicRefusals("primary_refusal", input.rejected ?? [], input.dispositions),
    gaps: publicCount(input.gaps ?? [], "unresolved_facets"),
    providerAttempts: Number(input.providerAttempts) || 0,
    dossier: [],
    retrievedOutsideDossier: [],
    dispositions: [],
    unavailableNominations: Number(input.unavailableNominations) || 0,
    recovery: {
      status: /^[a-z0-9_:-]+$/i.test(recovery.status) ? recovery.status : "other",
      candidates: publicCount(recovery.candidates ?? [], "recovery_candidates"),
      dispositions: [],
      unavailableNominations: Number(recovery.unavailableNominations) || 0,
      selected: [],
      rejected: publicRefusals("recovery_refusal", recovery.rejected ?? [], recovery.dispositions),
    },
    ...nominationCounts(input),
  };
}

/** Counts only. The same key=code:count shape as the adjudication refusal lines. */
export function forumCountCodes(
  prefix: "selector_forum" | "overlooked_forum",
  counts: { identity?: number; ambiguous?: number },
): string[] {
  const identity = Math.max(0, Math.trunc(Number(counts?.identity) || 0));
  const ambiguous = Math.max(0, Math.trunc(Number(counts?.ambiguous) || 0));
  const tokens = [
    `${prefix}=forum-identity:${identity}`,
    `${prefix}=forum-ambiguous:${ambiguous}`,
  ];
  return clientCheckNote(tokens)?.split(";") ?? [];
}

export function adjudicationNote(input: PublicAdjudication | null | undefined): string | null {
  if (!input) return null;
  const safe = publicScenarioAdjudication(input);
  if (!safe) return null;
  return clientCheckNote([
    ...safe.rejected,
    ...safe.gaps,
    ...safe.recovery.rejected,
    ...safe.recovery.candidates,
  ]);
}

const PUBLIC_NOTE = /^[a-z0-9_.=:+,-]{1,160}$/i;
const CODE_VALUE = /^[a-z0-9_.,:-]{1,120}$/;
const CODE_KEY_VALUE = /^[A-Za-z0-9_.,:-]{1,120}$/;
const ALLOWED_KEY = /^(?:rewritten_mentions|pruned_lines|invalid_citations|ungrounded_mentions|responsiveness|incident_repair|pruned_unsupported_claims|claim_ids|appeal_attempted|appeal_corroborated|appeal_unavailable|bottom_line_before|bottom_line_after|draft_claims|rejected_claims|remaining_claims|citations_valid|mentions_valid|appeal|bottom_line_recovery|claim_check_attempts|repair|repair_attempts|operation|kind|status|code|provider|retryable|attempts|unresolved_facets|primary_refusal|recovery_refusal|disposition|recovery_candidates|rejected|selector_forum|overlooked_forum|selector_forum_withheld)$/;
const ALLOWED_BARE = new Set(["v29_semantic_fallback"]);

/**
 * Client notes are an allow-list of key=value codes, and the token must also
 * match the code charset. Prose and bare labels do not pass.
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

function acceptCheckToken(token: string): boolean {
  if (!PUBLIC_NOTE.test(token)) return false;
  if (ALLOWED_BARE.has(token)) return true;
  const split = token.indexOf("=");
  if (split <= 0) return false;
  const key = token.slice(0, split);
  const value = token.slice(split + 1);
  const valuePattern = key === "code" ? CODE_KEY_VALUE : CODE_VALUE;
  return ALLOWED_KEY.test(key) && valuePattern.test(value);
}

/** Counts only. key=code:count, with no labels and no prose. */
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

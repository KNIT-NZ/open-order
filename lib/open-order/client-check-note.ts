import { AI_ERROR_KINDS } from "../ai/errors";
import { DIAGNOSTIC_KINDS, NONRETRYABLE_CODES, TRANSIENT_CODES } from "../ai/provider-resilience";

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

const COUNT_KEY = new Set([
  "rewritten_mentions", "pruned_lines", "invalid_citations", "ungrounded_mentions",
  "pruned_unsupported_claims", "draft_claims", "rejected_claims", "remaining_claims",
  "claim_check_attempts", "repair_attempts", "attempts", "unresolved_facets",
  "appeal_attempted", "appeal_corroborated", "appeal_unavailable", "rejected",
]);
const BOOL_KEY = new Set(["bottom_line_before", "bottom_line_after", "citations_valid", "mentions_valid", "retryable"]);
const PROVIDER_CODE = new Set<string>([
  ...TRANSIENT_CODES,
  ...NONRETRYABLE_CODES,
  ...AI_ERROR_KINDS.map((kind) => kind.toUpperCase()),
]);
const KIND = new Set<string>(DIAGNOSTIC_KINDS);
const REPAIR_REASON = /^(?:missing_bottom_line|invalid_citations|invalid_authority_mentions|qualification_veto|not_responsive_or_missing_verdict|unaddressed_parts|no_claims|duplicate_claim_ids|verdict_count_mismatch|duplicate_verdict_ids|unexpected_verdict_id|missing_claim_verdict|unsupported_claim|empty_repair)$/;
const REPAIR_PHASE = /^(?:generation|deterministic_checks|independent_validation|independent_verdict_schema)$/;
function allowedValue(key: string, value: string): boolean {
  if (value.includes(" ")) return false;
  if (COUNT_KEY.has(key)) return /^\d{1,6}$/.test(value);
  if (BOOL_KEY.has(key)) return value === "true" || value === "false";
  if (key === "claim_ids") return /^(?:none|claim-\d+(?:,claim-\d+)*)$/.test(value);
  if (key === "code") return value === "none" || PROVIDER_CODE.has(value);
  if (key === "kind") return KIND.has(value);
  if (key === "status") return value === "none" || value === "429" || value === "503" || /^[45]\d\d$/.test(value);
  if (key === "provider") return /^(?:gemini|openai-compatible|router|none|unknown)$/.test(value);
  if (key === "operation") return /^(?:drafting|claim_validation|post_validation)$/.test(value);
  if (key === "selector_forum" || key === "overlooked_forum") return /^forum-(?:identity|ambiguous):\d{1,4}$/.test(value);
  if (key === "selector_forum_withheld") return /^forum-identity:\d{1,4}$/.test(value);
  if (key === "incident_repair") {
    if (/^(?:not_needed|not_admitted|independent_review_pending|independent_gate_refused|accepted_after_recheck|empty_repair)$/.test(value)) return true;
    if (value.startsWith("refused:")) return value.slice("refused:".length).split(",").every((part) => REPAIR_REASON.test(part));
    if (value.startsWith("unavailable:")) {
      const parts = value.split(":");
      return REPAIR_PHASE.test(parts[1] ?? "") && KIND.has(parts[2] ?? "");
    }
    return false;
  }
  if (key === "bottom_line_recovery") {
    return /^(?:not_needed|attempted_rejected|accepted_after_recheck|unavailable_original_rejection_preserved)$/.test(value);
  }
  if (key === "responsiveness") return /^(?:supported|partial|not_answered|withheld)$/.test(value);
  if (key === "repair") return value === "accepted";
  if (key === "appeal") return value === "not_attempted";
  if (key === "recovery_candidates") return /^\d{1,4}$/.test(value);
  if (key === "disposition") return /^(?:admitted|rejected|not_nominated|withheld_no_primary|not_reviewed_limit)$/.test(value);
  if (key === "primary_refusal" || key === "recovery_refusal") return false;
  return false;
}

function acceptCheckToken(token: string): boolean {
  if (!token || /\s/.test(token)) return false;
  if (ALLOWED_BARE.has(token)) return true;
  const split = token.indexOf("=");
  if (split <= 0) return false;
  const key = token.slice(0, split);
  const value = token.slice(split + 1);
  if (!value || !ALLOWED_KEY.test(key)) return false;
  // Membership is decided before any length cap, so a long list of valid members survives.
  if (key === "code") {
    if (!/^[A-Za-z0-9_.,:-]+$/.test(value)) return false;
  } else if (!/^[a-z0-9_.,:-]+$/i.test(value)) return false;
  return allowedValue(key, value);
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

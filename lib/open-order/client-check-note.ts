import { EMPTY_REPAIR_REASON, V402_REPAIR_REASONS } from "../ai/scenario-adjudication";
import { DIAGNOSTIC_KINDS, NONRETRYABLE_CODES, TRANSIENT_CODES } from "../ai/provider-resilience";
import { CLAIM_ID_MAX_LENGTH, COUNT_DIGITS, FORUM_COUNT_WIDTH, RECOVERY_COUNT_DIGITS } from "./emitted-widths";

export { CLAIM_ID_MAX_LENGTH };

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
const PROVIDER_CODE = new Set<string>([...TRANSIENT_CODES, ...NONRETRYABLE_CODES]);
const KIND = new Set<string>(DIAGNOSTIC_KINDS);
const REPAIR_REASON = new Set<string>([...V402_REPAIR_REASONS, EMPTY_REPAIR_REASON]);
const REPAIR_PHASE = /^(?:generation|deterministic_checks|independent_validation|independent_verdict_schema)$/;
const COUNT_VALUE = new RegExp(`^\\d{1,${COUNT_DIGITS}}$`);
const RECOVERY_VALUE = new RegExp(`^\\d{1,${RECOVERY_COUNT_DIGITS}}$`);
const FORUM_VALUE = new RegExp(`^forum-(?:identity|ambiguous):\\d{1,${FORUM_COUNT_WIDTH}}$`);
const FORUM_WITHHELD_VALUE = new RegExp(`^forum-identity:\\d{1,${FORUM_COUNT_WIDTH}}$`);
function allowedValue(key: string, value: string): boolean {
  if (value.includes(" ")) return false;
  if (COUNT_KEY.has(key)) return COUNT_VALUE.test(value);
  if (BOOL_KEY.has(key)) return value === "true" || value === "false";
  if (key === "claim_ids") {
    if (value === "none") return true;
    const ids = value.split(",");
    if (ids.some((id) => id.length === 0)) return false;
    if (new Set(ids).size !== ids.length) return false;
    return ids.every((id) => /^claim-\d+$/.test(id) && id.length <= CLAIM_ID_MAX_LENGTH);
  }
  if (key === "code") return value === "none" || PROVIDER_CODE.has(value);
  if (key === "kind") return KIND.has(value);
  if (key === "status") return value === "none" || value === "429" || value === "503" || /^[45]\d\d$/.test(value);
  if (key === "provider") return /^(?:gemini|openai-compatible|router|none|unknown)$/.test(value);
  if (key === "operation") return /^(?:drafting|claim_validation|post_validation)$/.test(value);
  if (key === "selector_forum" || key === "overlooked_forum") return FORUM_VALUE.test(value);
  if (key === "selector_forum_withheld") return FORUM_WITHHELD_VALUE.test(value);
  if (key === "incident_repair") {
    if (/^(?:not_needed|not_admitted|independent_review_pending|independent_gate_refused|accepted_after_recheck|empty_repair)$/.test(value)) return true;
    if (value.startsWith("refused:")) {
      const parts = value.slice("refused:".length).split(",");
      if (parts.length === 0 || parts.length > REPAIR_REASON.size) return false;
      if (parts.some((part) => part.length === 0)) return false;
      if (new Set(parts).size !== parts.length) return false;
      return parts.every((part) => REPAIR_REASON.has(part));
    }
    if (value.startsWith("unavailable:")) {
      const parts = value.split(":");
      return parts.length === 3 && REPAIR_PHASE.test(parts[1] ?? "") && KIND.has(parts[2] ?? "");
    }
    return false;
  }
  if (key === "bottom_line_recovery") {
    return /^(?:not_needed|attempted_rejected|accepted_after_recheck|unavailable_original_rejection_preserved)$/.test(value);
  }
  if (key === "responsiveness") return /^(?:supported|partial|not_answered|withheld)$/.test(value);
  if (key === "repair") return value === "accepted";
  if (key === "appeal") return value === "not_attempted";
  if (key === "recovery_candidates") return RECOVERY_VALUE.test(value);
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
  const limit = 10 ** FORUM_COUNT_WIDTH - 1;
  const clamp = (value: number) => Math.min(limit, Math.max(0, Math.trunc(Number(value) || 0)));
  const identity = clamp(counts?.identity ?? 0);
  const ambiguous = clamp(counts?.ambiguous ?? 0);
  const tokens = [
    `${prefix}=forum-identity:${identity}`,
    `${prefix}=forum-ambiguous:${ambiguous}`,
  ];
  return clientCheckNote(tokens)?.split(";") ?? [];
}

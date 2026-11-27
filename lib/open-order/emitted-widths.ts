/** Digit widths of values the emitters actually produce. The checker imports these. */

/** Forum identity tallies. forumCountCodes saturates at this width. */
export const FORUM_COUNT_WIDTH = 4;

/** Count keys such as rewritten_mentions. */
export const COUNT_DIGITS = 6;

/** recovery_candidates, emitted by public diagnostics. */
export const RECOVERY_COUNT_DIGITS = 4;

/** claim-N ids. The emitter and the checker share this cap. */
export const CLAIM_ID_MAX_LENGTH = 40;

/** Longest key name in a public diagnostic token. */
export const DIAGNOSTIC_KEY_LENGTH = 64;

/** Largest integer a digit width can emit. */
export function countLimit(digits: number): number {
  return 10 ** digits - 1;
}

/** Saturate a tally at the width the checker accepts. */
export function boundedCount(value: number, digits: number): number {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(countLimit(digits), parsed);
}

/**
 * Frozen copy of the mention detector on main 2ca3449.
 * The head must flag every text this flags, apart from the explicit keep-list in the differential test.
 * Do not retarget this file at the current detector.
 */

function normalizeAuthorityMention(text: string): string {
  return text
    .replace(/^standing order\s+/i, "SO ")
    .replace(/^(appendix\s+[a-f]\s+)cl(?:ause)?\.?\s+/i, "$1cl ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function stripBracketedCitations(text: string): string {
  return text.replace(/\[[^\]]+\]/g, " ");
}

const MAIN_MENTION = /\b(?:standing order|so)\s+\d+[a-z]*\b|\bappendix\s+[a-f]\s+(?:cl(?:ause)?\.?\s+\d+[a-z]*|(?:table|part)\s+\d+\s+row\s+\d+|note)\b/gi;

/** True when main 2ca3449 would treat the prose as naming an unretrieved provision. */
export function mainFlagsMention(answerText: string, labels: string[]): boolean {
  const allowed = new Set(labels.map((label) => normalizeAuthorityMention(label)));
  const prose = stripBracketedCitations(answerText);
  const matches = prose.match(new RegExp(MAIN_MENTION.source, "gi")) ?? [];
  return matches.some((match) => !allowed.has(normalizeAuthorityMention(match)));
}

/**
 * Frozen copy of the mention pattern on main 2ca3449,
 * lib/procedural-reasoning.ts line 1859 (validateAnswerAuthorityMentions).
 * The rewrite on that commit uses the same pattern. This is that source text,
 * including the bare-fraction alternative |\b\d+\/\d+\b.
 * Do not retarget this file at the head detector.
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

const MAIN_MENTION = /\b(?:standing order|so)\s+\d+[a-z]*\b|\bappendix\s+[a-f]\s+(?:cl(?:ause)?\.?\s+\d+[a-z]*|(?:table|part)\s+\d+\s+row\s+\d+|note)\b|\b\d+\/\d+\b/gi;

/** True when main 2ca3449 would treat the prose as naming an unretrieved provision. */
export function mainFlagsMention(answerText: string, labels: string[]): boolean {
  const allowed = new Set(labels.map((label) => normalizeAuthorityMention(label)));
  const prose = stripBracketedCitations(answerText);
  const matches = prose.match(new RegExp(MAIN_MENTION.source, "gi")) ?? [];
  return matches.some((match) => !allowed.has(normalizeAuthorityMention(match)));
}

/**
 * Wording for a placeholder the route inserts in place of an ungrounded mention.
 * The bracket text is fixed. Whether that bracket is trusted is decided by the
 * span the rewrite recorded, not by finding the words in the answer.
 */
export const PLACEHOLDER_CITATION = "citation not verified";
export const PLACEHOLDER_BRACKET = `[${PLACEHOLDER_CITATION}]`;
/** Private token. Only a rewrite this route performed inserts it. */
export const ROUTE_PLACEHOLDER_CITATION = "oo-route-placeholder";
export const ROUTE_PLACEHOLDER_BRACKET = `[${ROUTE_PLACEHOLDER_CITATION}]`;

const CLOSER = /[\s.,;:!?\])]/;

export function renderRoutePlaceholders(text: string): string {
  return text.split(ROUTE_PLACEHOLDER_BRACKET).join(PLACEHOLDER_BRACKET);
}

export function provisionPlaceholder(before: string, after: string, citation = PLACEHOLDER_CITATION): { text: string; consumeBefore: number; consumeAfter: number } {
  const tail = before.slice(-80);
  const determiner = /(?:^|[^A-Za-z])((?:The|An|A|the|an|a))\s+$/u.exec(tail);
  const possessive = /^[\s\u00a0]*['’]s/u.exec(after.slice(0, 8));
  const consumeAfter = possessive?.[0].length ?? 0;
  const mark = possessive?.[0].includes("’") ? "’" : "'";
  let phrase: string;
  let consumeBefore = 0;
  if (determiner?.[1]) {
    const word = determiner[1];
    const at = tail.length - determiner[0].length + (determiner[0].startsWith(word) ? 0 : 1);
    consumeBefore = tail.length - at;
    const article = word.toLowerCase() === "an" ? (word.startsWith("A") ? "A" : "a") : word;
    phrase = `${article} provision`;
  } else if (isSentenceStart(before)) {
    phrase = "A provision";
  } else {
    phrase = "a provision";
  }
  if (possessive) phrase += `${mark}s`;
  let text = `${phrase} [${citation}]`;
  const preceding = before.slice(0, before.length - consumeBefore).slice(-1);
  if (preceding && /[A-Za-z0-9\]]/.test(preceding)) text = ` ${text}`;
  const following = after.slice(consumeAfter)[0] ?? "";
  if (following && !CLOSER.test(following)) text = `${text} `;
  return { text, consumeBefore, consumeAfter };
}

function isSentenceStart(before: string): boolean {
  const end = before.slice(-64);
  const breakAt = end.lastIndexOf("\n");
  const line = breakAt >= 0 ? end.slice(breakAt + 1) : end;
  const atLineStart = breakAt >= 0 || before.length === end.length;
  const lead = line.replace(/[\s"'“”‘’(\[]+$/u, "");
  if (lead.length === 0) return atLineStart;
  if (/[!?]$/.test(lead)) return true;
  return lead.endsWith(".") && !/\b(?:no|cf|etc|eg|ie|dr|mr|mrs|ms|st|vs|al)\.$/i.test(lead);
}

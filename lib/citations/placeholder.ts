/**
 * Wording for a placeholder the route inserts in place of an ungrounded mention.
 * The bracket text is fixed. Whether that bracket is trusted is decided by the
 * span the rewrite recorded, not by finding the words in the answer.
 */
export const PLACEHOLDER_CITATION = "citation not verified";
export const PLACEHOLDER_BRACKET = `[${PLACEHOLDER_CITATION}]`;

export type PlaceholderSpan = { start: number; end: number };

const CLOSER = /[\s.,;:!?\])]/;
const MARKER_BODY = String.raw`o\s*o\s*-\s*r\s*o\s*u\s*t\s*e\s*-\s*p\s*l\s*a\s*c\s*e\s*h\s*o\s*l\s*d\s*e\s*r`;
const MARKER_BRACKET = new RegExp(`[\\[［〔【]\\s*${MARKER_BODY}\\s*[\\]］〕】]`, "gi");
const MARKER_PROSE = new RegExp(`(?<![A-Za-z0-9])${MARKER_BODY}(?![A-Za-z0-9])`, "gi");

/** A model draft that already contains the old marker becomes an ordinary ungrounded citation. */
export function neutraliseForgedMarkers(text: string): string {
  return text.replace(MARKER_BRACKET, PLACEHOLDER_BRACKET).replace(MARKER_PROSE, PLACEHOLDER_BRACKET);
}

export function renderInsertedPlaceholders(text: string, token: string): string {
  if (!token) return text;
  return text.split(`[${token}]`).join(PLACEHOLDER_BRACKET);
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

/** Keep recorded spans aligned when a region is replaced. */
export function shiftPlaceholderSpans(spans: PlaceholderSpan[], replaceStart: number, replaceEnd: number, delta: number): PlaceholderSpan[] {
  return spans.flatMap((span) => {
    if (span.end <= replaceStart) return [span];
    if (span.start >= replaceEnd) return [{ start: span.start + delta, end: span.end + delta }];
    return [];
  });
}

/** After formatting, the inserted bracket still identifies the span. */
export function realignPlaceholderSpans(before: string, after: string, spans: PlaceholderSpan[]): PlaceholderSpan[] {
  if (before === after) return spans;
  let cursor = 0;
  const mapped: PlaceholderSpan[] = [];
  for (const span of [...spans].sort((left, right) => left.start - right.start)) {
    const snippet = before.slice(span.start, span.end);
    if (!snippet) continue;
    const at = after.indexOf(snippet, cursor);
    if (at < 0) continue;
    mapped.push({ start: at, end: at + snippet.length });
    cursor = at + snippet.length;
  }
  return mapped;
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

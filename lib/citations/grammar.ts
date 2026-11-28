/**
 * Citation grammar v1.3. Pure detector: no model calls, no retained draft text
 * in the reason codes. Trees come from full section text or, in tests, from
 * the corpus provision_tree.
 */

export const RULE_CODES = [
  "grounded",
  "grounded-pinpoint",
  "grounded-qualifier",
  "quantity",
  "neutral",
  "ungrounded-not-admitted",
  "ungrounded-nonexistent",
  "ambiguous-tree",
  "unknown-tree",
  "ungrounded-revoked",
  "ungrounded-edition",
  "ungrounded-superseded",
  "ungrounded-misattributed",
  "ungrounded-open-range",
  "ungrounded-range",
  "ungrounded-residue",
  "deferred-ruling-index",
  "deferred-Q5",
  "deferred-quote",
  "neutral-bracket",
  "uncited",
] as const;

export type RuleCode = (typeof RULE_CODES)[number];

const ROW_PRECEDENCE: RuleCode[] = [
  "ungrounded-revoked",
  "ungrounded-misattributed",
  "ungrounded-nonexistent",
  "ambiguous-tree",
  "ungrounded-edition",
  "ungrounded-superseded",
  "ungrounded-open-range",
  "ungrounded-range",
  "ungrounded-not-admitted",
  "ungrounded-residue",
  "unknown-tree",
  "deferred-ruling-index",
  "deferred-Q5",
  "deferred-quote",
  "grounded-pinpoint",
  "grounded",
];

const REVOKED = new Set([
  "SO 135", "SO 136", "SO 150", "SO 208", "SO 265", "SO 282", "SO 283",
  "SO 300(4)", "SO 408(3)", "APP B cl 15", "APP B cl 19",
]);

/** Parents whose repeated letters make every pinpoint under them ambiguous. */
const AMBIGUOUS_PARENTS = new Set(["SO 3(1)", "APP B cl 2(1)", "APP F cl 2"]);

export type PartStatus = "grounded" | "ungrounded" | "not_citation";
export type BracketClass = "grounded" | "partial" | "ungrounded" | "not_citation";
export type RowVerdict = "yes" | "partial" | "no";

export type GrammarAuthority = {
  citationLabel: string;
  sectionContent?: string | null;
};

export type GrammarMention = {
  where: "bracket" | "prose";
  ref: string;
  kind: string;
  status: PartStatus;
  code: RuleCode;
  cpk: string | null;
  start: number;
  end: number;
};

export type GrammarBracket = {
  text: string;
  class: BracketClass;
  code: "neutral-bracket" | null;
  start: number;
  end: number;
};

export type GrammarAssessment = {
  mentions: GrammarMention[];
  brackets: GrammarBracket[];
  verdict: RowVerdict;
  reasonCode: "served" | "rewritten" | "withheld_invalid_citations" | "served_no_authority";
  ruleCodes: { parts: RuleCode[]; brackets: Array<"neutral-bracket" | null>; row: RuleCode };
  groundedCpk: string[];
  /** Ungrounded prose spans, in original coordinates, for the rewrite step. */
  rewriteSpans: Array<{ start: number; end: number }>;
  /** Suffixes on admitted mentions that the route strips. */
  stripSpans: Array<{ start: number; end: number }>;
};

export type GrammarOptions = {
  /** Test-only trees keyed by CPK. Omit to build from sectionContent. */
  provisionTree?: Record<string, string[]> | null;
  deferralTags?: string[];
};

type Norm = { text: string; starts: number[] };

const FORMAT = new Set([0x200b, 0x200c, 0x200d, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0x180e, 0xfeff, 0xad]);

function isSep(cp: number): boolean {
  return cp === 0x20 || cp === 0xa0 || cp === 0x1680 || cp === 0x2028 || cp === 0x2029 || cp === 0x202f
    || cp === 0x205f || cp === 0x3000 || (cp >= 0x2000 && cp <= 0x200a);
}

function isSlash(cp: number): boolean {
  return cp === 0x2f || cp === 0x2044 || cp === 0xff0f;
}

function isDash(cp: number): boolean {
  return cp === 0x2d || cp === 0x2013 || cp === 0x2014;
}

function isApos(cp: number): boolean {
  return cp === 0x27 || cp === 0x2019 || cp === 0x2bc;
}

function classOf(ch: string): "digit" | "upper" | "letter" | "other" {
  if (/[0-9]/.test(ch)) return "digit";
  if (/[A-Z]/.test(ch)) return "upper";
  if (/\p{L}/u.test(ch)) return "letter";
  return "other";
}

export function normalizeGrammarText(input: string): Norm {
  return normalizeGrammarTextStable(input);
}

function normalizeGrammarTextStable(input: string): Norm {
  const out: string[] = [];
  const starts: number[] = [];
  let orig = 0;
  const chars = [...input];
  const cps = chars.map((ch) => ch.codePointAt(0) ?? 0);
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    const cp = cps[i];
    const start = orig;
    orig += ch.length;
    if (isSep(cp)) {
      const prev = out[out.length - 1] ?? "";
      const nextCp = nextSignificant(cps, i + 1);
      if (isSlash(nextCp) || isSlash(prev.codePointAt(0) ?? 0)) continue;
      if (prev !== " ") {
        out.push(" ");
        starts.push(start);
      }
      continue;
    }
    if (FORMAT.has(cp)) {
      const prev = out[out.length - 1] ?? "";
      const nextCh = nextSignificantChar(chars, cps, i + 1);
      const prevClass = prev ? classOf(prev) : "other";
      const nextClass = nextCh ? classOf(nextCh) : "other";
      const bothLetters = (prevClass === "letter" || prevClass === "upper") && (nextClass === "letter" || nextClass === "upper");
      const bothDigits = prevClass === "digit" && nextClass === "digit";
      const digitUpper = prevClass === "digit" && nextClass === "upper";
      const letterDigit = ((prevClass === "letter" || prevClass === "upper") && nextClass === "digit")
        || (prevClass === "digit" && (nextClass === "letter" || nextClass === "upper"));
      if (bothLetters || bothDigits || digitUpper) continue;
      if (letterDigit && prev !== " ") {
        out.push(" ");
        starts.push(start);
      }
      continue;
    }
    let emitted = ch;
    if (isSlash(cp)) emitted = "/";
    else if (isDash(cp)) emitted = "-";
    else if (isApos(cp)) emitted = "'";
    if (emitted === "/" && out[out.length - 1] === " ") {
      out.pop();
      starts.pop();
    }
    out.push(emitted);
    starts.push(start);
  }
  if (out[0] === " ") { out.shift(); starts.shift(); }
  if (out[out.length - 1] === " ") { out.pop(); starts.pop(); }
  starts.push(input.length);
  return { text: out.join(""), starts };
}

function nextSignificant(cps: number[], from: number): number {
  for (let i = from; i < cps.length; i += 1) {
    if (!FORMAT.has(cps[i]) && !isSep(cps[i])) return cps[i];
  }
  return 0;
}

function nextSignificantChar(chars: string[], cps: number[], from: number): string {
  for (let i = from; i < chars.length; i += 1) {
    if (!FORMAT.has(cps[i]) && !isSep(cps[i])) return chars[i];
  }
  return "";
}

function origSpan(norm: Norm, start: number, end: number): { start: number; end: number } {
  return { start: norm.starts[start] ?? 0, end: norm.starts[end] ?? norm.starts[norm.starts.length - 1] ?? 0 };
}

const ONES: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
const TEENS: Record<string, number> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17,
  eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30, fortieth: 40, fiftieth: 50, sixtieth: 60,
  seventieth: 70, eightieth: 80, ninetieth: 90, hundredth: 100,
};

function readCardinal(text: string, index: number): { value: number; end: number } | null {
  const slice = text.slice(index);
  const hundred = /^(?:(?:a|one)\s+hundred)(?:\s+and)?/i.exec(slice);
  let value = 0;
  let end = index;
  let rest = slice;
  let body = index;
  if (hundred) {
    value = 100;
    end = index + hundred[0].length;
    const gap = /^\s+/.exec(text.slice(end));
    body = end + (gap?.[0].length ?? 0);
    rest = text.slice(body);
  }
  const teen = /^(ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)\b/i.exec(rest);
  if (teen && (value === 0 || hundred)) {
    return { value: value + TEENS[teen[1].toLowerCase()], end: body + teen[0].length };
  }
  const ten = /^(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[-\s](one|two|three|four|five|six|seven|eight|nine))?\b/i.exec(rest);
  if (ten) {
    return { value: value + TENS[ten[1].toLowerCase()] + (ten[2] ? ONES[ten[2].toLowerCase()] : 0), end: body + ten[0].length };
  }
  const one = /^(one|two|three|four|five|six|seven|eight|nine)\b/i.exec(rest);
  if (one && (value > 0 || !hundred)) {
    if (value === 0) return { value: ONES[one[1].toLowerCase()], end: index + one[0].length };
    return { value: value + ONES[one[1].toLowerCase()], end: body + one[0].length };
  }
  if (hundred && value === 100 && !ten && !one) return { value: 100, end };
  return null;
}

function readOrdinal(text: string, index: number): { value: number; end: number } | null {
  const digit = /^(\d+)(?:st|nd|rd|th)\b/i.exec(text.slice(index));
  if (digit) return { value: Number(digit[1]), end: index + digit[0].length };
  const word = /^(ninety|eighty|seventy|sixty|fifty|forty|thirty|twenty)[-\s](first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)\b/i.exec(text.slice(index));
  if (word) return { value: TENS[word[1].toLowerCase()] + ONES[word[2].toLowerCase().replace(/th$/, "")], end: index + word[0].length };
  const simple = /^([a-z]+)\b/i.exec(text.slice(index));
  if (simple && ORDINALS[simple[1].toLowerCase()] !== undefined) {
    return { value: ORDINALS[simple[1].toLowerCase()], end: index + simple[0].length };
  }
  return null;
}

type Item = {
  kind: string;
  ref: string;
  cpk: string | null;
  pins: string;
  number: number | null;
  slash: boolean;
  range: boolean;
  open: boolean;
  year: number | null;
  yearBound: boolean;
  suffixStart: number | null;
  textStart: number;
  textEnd: number;
  quantity: boolean;
  residue: boolean;
  editorial: boolean;
  title: boolean;
  superseded: boolean;
  revokedHint: boolean;
};

const UNIT = /^(?:(?:members?|mps?|people|persons?|seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|calendar\s+days?|working\s+days?|sitting\s+days?|weeks?|months?|years?|per\s+cent|percent|votes?|times?)\b|%)/i;
const GATED = /^(?:bills?|questions?|motions?|amendments?|readings?|speakers?|part(?:y|ies))\b/i;
const CLOCK = /^(?:am|pm|a\.m\.|p\.m\.|o'clock)\b/i;

function wordAfter(text: string, index: number): string {
  return text.slice(index).replace(/^\s+/, "");
}

function isQuantityTail(text: string, index: number, singularComma: boolean, joiner: string): boolean {
  const rest = wordAfter(text, index);
  if (/^(?:am|pm|a\.m\.|p\.m\.|o'clock|noon)\b/i.test(rest)) {
    const hour = /(\d+)\s*$/.exec(text.slice(0, index));
    if (hour && Number(hour[1]) >= 1 && Number(hour[1]) <= 12) return true;
  }
  const orMore = /^(?:or more|or fewer|or less)\s+/i.exec(rest);
  if (orMore) {
    const after = rest.slice(orMore[0].length);
    if (UNIT.test(after) || GATED.test(after)) return true;
  }
  if (UNIT.test(rest)) {
    const unit = UNIT.exec(rest);
    const after = rest.slice(unit?.[0].length ?? 0);
    if (after.startsWith("-")) return false;
    if (/^'/i.test(after) && /^(?:members?|mps?|people|persons?)\b/i.test(unit?.[0] ?? "")) return false;
    return true;
  }
  if (/^(?:speakers?|part(?:y|ies))\b/i.test(rest) && singularComma && /,/.test(joiner)) return true;
  return false;
}

function boundary(text: string, index: number): boolean {
  if (index <= 0) return true;
  return !/[A-Za-z0-9]/.test(text[index - 1] ?? "");
}

function readPins(text: string, index: number): { pins: string; end: number } {
  let pins = "";
  let end = index;
  for (;;) {
    const pin = /^\s*(\((?:\d+[A-Z]*|[a-z]{1,2}|[ivxlcdm]+)\))/i.exec(text.slice(end));
    if (!pin) break;
    const inner = pin[1];
    const year = /^\((\d{4})\)$/.exec(inner);
    if (year && Number(year[1]) >= 1800 && Number(year[1]) <= 2099) break;
    pins += inner;
    end += pin[0].length;
  }
  return { pins, end };
}

function isUnreadablePinGroup(body: string): boolean {
  const inner = body.slice(1, -1);
  if (/^\s*(?:ibid\.?|op\.?\s*cit\.?|idem|supra|infra|above|note)\s*$/i.test(inner)) return false;
  if (inner.trim().split(/\s+/).length > 1) return false;
  const year = /^\((?:1[8-9]\d{2}|20\d{2})\)$/.test(body);
  const valid = !year && /^\((?:\d+[A-Z]*|[a-z]{1,2}|[ivxlcdm]+)\)$/i.test(body);
  return !valid && !year && inner.trim().length > 0 && inner.trim().length <= 12;
}

/** A parenthesised group that is not a pin, plus every pin group after it. Years and asides stay put. */
function unreadablePinTail(text: string, index: number): number {
  let end = index;
  let started = false;
  for (;;) {
    const group = /^\s*(\([^)]*\))/.exec(text.slice(end));
    if (!group) break;
    const body = group[1];
    const year = /^\((?:1[8-9]\d{2}|20\d{2})\)$/.test(body);
    const valid = !year && /^\((?:\d+[A-Z]*|[a-z]{1,2}|[ivxlcdm]+)\)$/i.test(body);
    if (!started) {
      if (!isUnreadablePinGroup(body)) break;
      started = true;
    } else if (!valid && !isUnreadablePinGroup(body)) {
      break;
    }
    end += group[0].length;
  }
  return end;
}

function pinResidue(text: string, start: number, end: number): Item {
  return makeItem({
    kind: "residue",
    ref: text.slice(start, end).trim().slice(0, 40) || "pin",
    residue: true,
    textStart: start,
    textEnd: end,
  });
}

function readYear(text: string, index: number): { year: number; end: number } | null {
  const year = /^\s*\((1[8-9]\d{2}|20\d{2})\)/.exec(text.slice(index));
  if (!year) return null;
  return { year: Number(year[1]), end: index + year[0].length };
}

function readNumberToken(text: string, index: number): { value: number; raw: string; end: number; suffix: string } | null {
  const spelled = readCardinal(text, index);
  if (spelled && boundary(text, index)) return { value: spelled.value, raw: String(spelled.value), end: spelled.end, suffix: "" };
  const paren = /^\((\d+)\)/.exec(text.slice(index));
  if (paren) return { value: Number(paren[1]), raw: paren[1], end: index + paren[0].length, suffix: "" };
  const num = /^(\d+)([A-Z]{1,4}|[a-z]{1,4})?/.exec(text.slice(index));
  if (!num) return null;
  return { value: Number(num[1]), raw: num[1] + (num[2] ?? ""), end: index + num[0].length, suffix: num[2] ?? "" };
}

type Prefix = { end: number; plural: boolean; singular: boolean; family: "so" | "sr" };

function readPrefix(text: string, index: number): Prefix | null {
  if (!boundary(text, index)) return null;
  const slice = text.slice(index);
  const patterns: Array<{ re: RegExp; plural: boolean; singular: boolean; family: "so" | "sr" }> = [
    { re: /^standing\s+order\s+nos\./i, plural: true, singular: false, family: "so" },
    { re: /^standing\s+orders(?:\s+nos\.)?/i, plural: true, singular: false, family: "so" },
    { re: /^standing\s+order\s+\(so\)/i, plural: false, singular: true, family: "so" },
    { re: /^standing(?:\s+|-|)order(?:\(s\))?/i, plural: false, singular: true, family: "so" },
    { re: /^s\.?\s*o\.?\s*s\b/i, plural: true, singular: false, family: "so" },
    { re: /^sos\b/i, plural: true, singular: false, family: "so" },
    { re: /^s\.\s*o\./i, plural: false, singular: true, family: "so" },
    { re: /^s\.o\./i, plural: false, singular: true, family: "so" },
    { re: /^so(?![a-z])/i, plural: false, singular: true, family: "so" },
    { re: /^(?:speakers?|speaker)'?s?\s+rulings?\b/i, plural: false, singular: true, family: "sr" },
    { re: /^rulings?\b/i, plural: false, singular: true, family: "sr" },
    { re: /^s\.r\./i, plural: false, singular: true, family: "sr" },
    { re: /^sr(?![a-z])/i, plural: false, singular: true, family: "sr" },
  ];
  for (const pattern of patterns) {
    const match = pattern.re.exec(slice);
    if (!match) continue;
    if (pattern.family === "so" && /^so/i.test(match[0]) && /s$/i.test(match[0]) && pattern.plural === false) continue;
    return { end: index + match[0].length, plural: pattern.plural, singular: pattern.singular, family: pattern.family };
  }
  return null;
}

function skipNumberWord(text: string, index: number): number {
  const no = /^\s*(?:no\.|number\b|no\b)/i.exec(text.slice(index));
  return no ? index + no[0].length : index;
}

type Raw = Item & { where: "bracket" | "prose" };

function makeItem(partial: Partial<Item> & Pick<Item, "kind" | "ref" | "textStart" | "textEnd">): Item {
  return {
    cpk: null,
    pins: "",
    number: null,
    slash: false,
    range: false,
    open: false,
    year: null,
    yearBound: false,
    suffixStart: null,
    quantity: false,
    residue: false,
    editorial: false,
    title: false,
    superseded: false,
    revokedHint: false,
    ...partial,
  };
}

function soCpk(raw: string, pins: string): string {
  return `SO ${raw}${pins}`;
}

function readSoNumber(text: string, index: number, allowParen: boolean): { raw: string; value: number | null; pins: string; end: number; residueStart: number | null } | null {
  const spaced = /^\s*/.exec(text.slice(index));
  const at = index + (spaced?.[0].length ?? 0);
  const finish = (raw: string, value: number | null, pinEnd: number, pins: string) => {
    const tail = unreadablePinTail(text, pinEnd);
    return { raw, value, pins, end: tail, residueStart: tail > pinEnd ? pinEnd : null };
  };
  if (!allowParen && /^\(\d+\)/.test(text.slice(at)) && !/^\(\d{4}\)/.test(text.slice(at))) {
    const paren = /^\((\d+)\)/.exec(text.slice(at));
    if (!paren) return null;
    const pins = readPins(text, at + paren[0].length);
    return finish(paren[1], Number(paren[1]), pins.end, pins.pins);
  }
  const token = readNumberToken(text, at);
  if (!token) return null;
  const pins = readPins(text, token.end);
  return finish(`${token.raw}`, token.suffix ? null : token.value, pins.end, pins.pins);
}

function skipSpace(text: string, index: number): number {
  const spaced = /^\s*/.exec(text.slice(index));
  return index + (spaced?.[0].length ?? 0);
}

function joinerAt(text: string, index: number): { end: number; text: string } | null {
  const match = /^\s*(?:,(?:\s+(?:and|or))?|;|:|&|\+|see also\b|see\b|cf\.|cf\b|and\b|or\b|with\b)/i.exec(text.slice(index));
  if (!match) return null;
  if (/^with$/i.test(match[1] ?? match[0].trim()) && !/^\s+(?:so\b|s\.o\.|standing|appendix|sr\b|ruling)/i.test(text.slice(index + match[0].length))) {
    return null;
  }
  return { end: index + match[0].length, text: match[0] };
}

function rangeAt(text: string, index: number): { end: number } | null {
  const match = /^\s*(?:-|to|through)\b/i.exec(text.slice(index));
  if (!match) return null;
  if (match[0].trim() === "-" && /^\s*-?\d/.test(text.slice(index + match[0].length)) === false && !/^\s*\d/.test(text.slice(index + match[0].length))) return null;
  return { end: index + match[0].length };
}

function readXrefSuffix(text: string, index: number): { end: number; innerStart: number } | null {
  const match = /^\s*\(\s*referred to in\b/i.exec(text.slice(index));
  if (!match) return null;
  const close = text.slice(index).toLowerCase().indexOf("not retrieved)");
  if (close < 0) return null;
  return { end: index + close + "not retrieved)".length, innerStart: index + match[0].length };
}

function finishYear(text: string, item: Item): Item {
  const year = readYear(text, item.textEnd);
  if (!year) return item;
  const current = item.kind === "speakers_ruling" ? 2023 : 2026;
  if (year.year === current) {
    item.year = year.year;
    item.textEnd = year.end;
    return item;
  }
  item.year = year.year;
  item.yearBound = true;
  item.textEnd = year.end;
  return item;
}

function readProvisionAt(text: string, index: number, inBracket: boolean, singularComma: boolean): { items: Item[]; end: number; plural: boolean } | null {
  const ordinal = readOrdinal(text, index);
  if (ordinal && /^\s+standing\s+order\b/i.test(text.slice(ordinal.end))) {
    const tail = /^\s+standing\s+order\b/i.exec(text.slice(ordinal.end));
    const end = ordinal.end + (tail?.[0].length ?? 0);
    return {
      plural: false,
      end,
      items: [makeItem({ kind: "standing_order", ref: `SO ${ordinal.value}`, cpk: `SO ${ordinal.value}`, number: ordinal.value, textStart: index, textEnd: end })],
    };
  }
  const prefix = readPrefix(text, index);
  if (!prefix) return readBare(text, index, inBracket);
  if (prefix.family === "sr") return readRuling(text, index, prefix.end, inBracket);
  let cursor = skipNumberWord(text, prefix.end);
  const slash = readSlash(text, cursor);
  if (slash) {
    slash.textStart = index;
    return { plural: prefix.plural, end: slash.textEnd, items: [finishYear(text, slash)] };
  }
  const first = readSoNumber(text, cursor, true);
  if (!first) {
    if (inBracket) {
      return { plural: prefix.plural, end: prefix.end, items: [makeItem({ kind: "unresolvable", ref: text.slice(index, prefix.end).trim(), residue: true, textStart: index, textEnd: prefix.end })] };
    }
    return null;
  }
  cursor = first.end;
  const items: Item[] = [makeItem({
    kind: "standing_order",
    ref: soCpk(first.raw, first.pins),
    cpk: soCpk(first.raw, first.pins),
    pins: first.pins,
    number: first.value,
    textStart: index,
    textEnd: first.residueStart ?? cursor,
  })];
  if (first.residueStart !== null) items.push(pinResidue(text, first.residueStart, first.end));
  let plural = prefix.plural;
  for (;;) {
    const xref = readXrefSuffix(text, cursor);
    if (xref) {
      items[items.length - 1].suffixStart = cursor;
      items[items.length - 1].textEnd = xref.end;
      cursor = xref.end;
      break;
    }
    const year = readYear(text, cursor);
    if (year && items.length === 1) {
      const item = items[0];
      item.year = year.year;
      item.yearBound = year.year !== 2026;
      item.textEnd = year.end;
      cursor = year.end;
      if (item.yearBound) break;
    }
    const open = /^\s*(?:et\s+seq\.?|ff\.?|and\s+following)\b/i.exec(text.slice(cursor));
    if (open) {
      let end = cursor + open[0].length;
      if (text[end] === ".") end += 1;
      const start = items[0]?.textStart ?? cursor + (open[0].length - open[0].trimStart().length);
      items.push(makeItem({ kind: "open_range", ref: "OPEN", open: true, textStart: start, textEnd: end }));
      cursor = end;
      break;
    }
    const range = rangeAt(text, cursor);
    if (range && items[items.length - 1].number !== null) {
      const next = readSoNumber(text, range.end, false);
      if (next && next.value !== null && isQuantityTail(text, next.end, false, "")) {
        const start = skipSpace(text, range.end);
        items.push(makeItem({ kind: "quantity", ref: "QTY", quantity: true, textStart: start, textEnd: endOfQuantity(text, next.end) }));
        cursor = endOfQuantity(text, next.end);
        break;
      }
      if (next && next.value !== null && items[items.length - 1].number !== null) {
        const from = items[items.length - 1].number as number;
        const to = next.value;
        items.pop();
        if (to < from || to - from > 100) {
          items.push(makeItem({ kind: "standing_order", ref: `SO ${from}..${to}`, range: true, number: from, textStart: index, textEnd: next.end }));
        } else if (to - from <= 2) {
          for (let n = from; n <= to; n += 1) {
            items.push(makeItem({ kind: "standing_order", ref: `SO ${n}`, cpk: `SO ${n}`, number: n, textStart: index, textEnd: next.end }));
          }
        } else {
          const grouped = groupRange(from, to);
          for (const group of grouped) items.push({ ...group, textStart: index, textEnd: next.end });
        }
        cursor = next.end;
        continue;
      }
    }
    const join = joinerAt(text, cursor);
    if (!join) break;
    const after = join.end;
    const qtyNum = readNumberToken(text, after) ?? (readCardinal(text, after) ? { value: readCardinal(text, after)!.value, raw: "", end: readCardinal(text, after)!.end, suffix: "" } : null);
    if (qtyNum && isQuantityTail(text, qtyNum.end, prefix.singular && !plural, join.text)) {
      items.push(makeItem({ kind: "quantity", ref: "QTY", quantity: true, textStart: after, textEnd: endOfQuantity(text, qtyNum.end) }));
      cursor = endOfQuantity(text, qtyNum.end);
      break;
    }
    const continuedSlash = /^\s*\d+(?:\([^)]+\))?\/\d+/.exec(text.slice(after));
    if (continuedSlash) {
      const lead = continuedSlash[0].length - continuedSlash[0].trimStart().length;
      const numberAt = after + lead;
      items.push(makeItem({
        kind: "standing_order",
        ref: `SO ${continuedSlash[0].trim()}`,
        slash: true,
        textStart: numberAt,
        textEnd: after + continuedSlash[0].length,
      }));
      cursor = after + continuedSlash[0].length;
      continue;
    }
    const pinOnly = readPins(text, after);
    if (pinOnly.pins && pinOnly.end > after && items.length > 0) {
      const prev = items[items.length - 1];
      const base = (prev.cpk ?? "").replace(/\([^)]*\)$/, "");
      const cpk = `${base}${pinOnly.pins}`;
      const tail = unreadablePinTail(text, pinOnly.end);
      items.push(makeItem({ kind: "standing_order", ref: cpk, cpk, pins: pinOnly.pins, textStart: skipSpace(text, after), textEnd: pinOnly.end }));
      if (tail > pinOnly.end) items.push(pinResidue(text, pinOnly.end, tail));
      cursor = tail;
      continue;
    }
    const badPin = unreadablePinTail(text, skipSpace(text, after));
    if (badPin > skipSpace(text, after)) {
      const start = skipSpace(text, after);
      items.push(pinResidue(text, start, badPin));
      cursor = badPin;
      continue;
    }
    const at = skipSpace(text, after);
    const nested = readPrefix(text, at);
    if (nested) {
      const inner = readProvisionAt(text, at, inBracket, false);
      if (!inner) break;
      items.push(...inner.items);
      cursor = inner.end;
      continue;
    }
    const appendix = readAppendix(text, at);
    if (appendix) {
      items.push(...appendix.items);
      cursor = appendix.end;
      continue;
    }
    const nextNum = readSoNumber(text, at, false);
    if (!nextNum) {
      const tight = /^\s*((?:para(?:graph)?|note|subclause|clause|cl\.?)\s+\d+[A-Za-z]*)/i.exec(text.slice(after));
      if (tight) {
        const start = skipSpace(text, after);
        const end = after + tight[0].length;
        items.push(makeItem({ kind: "residue", ref: tight[1], residue: true, textStart: start, textEnd: end }));
        cursor = end;
      }
      break;
    }
    if (isQuantityTail(text, nextNum.end, prefix.singular && /^\s*,/.test(join.text), join.text)) {
      items.push(makeItem({ kind: "quantity", ref: "QTY", quantity: true, textStart: at, textEnd: endOfQuantity(text, nextNum.end) }));
      cursor = endOfQuantity(text, nextNum.end);
      break;
    }
    items.push(makeItem({
      kind: "standing_order",
      ref: soCpk(nextNum.raw, nextNum.pins),
      cpk: soCpk(nextNum.raw, nextNum.pins),
      pins: nextNum.pins,
      number: nextNum.value,
      textStart: at,
      textEnd: nextNum.residueStart ?? nextNum.end,
    }));
    if (nextNum.residueStart !== null) items.push(pinResidue(text, nextNum.residueStart, nextNum.end));
    cursor = nextNum.end;
    plural = true;
  }
  if (items[0] && !items[0].yearBound) items[0] = finishYear(text, items[0]);
  items[items.length - 1].textEnd = Math.max(items[items.length - 1].textEnd, cursor);
  return { items, end: cursor, plural };
}

function groupRange(from: number, to: number): Item[] {
  const items: Item[] = [];
  items.push(makeItem({ kind: "standing_order", ref: `SO ${from}`, cpk: `SO ${from}`, number: from, textStart: 0, textEnd: 0 }));
  if (to > from + 1) {
    items.push(makeItem({
      kind: "standing_order",
      ref: `SO ${from + 1}..${to}`,
      cpk: null,
      number: from + 1,
      range: false,
      textStart: 0,
      textEnd: 0,
    }));
  }
  return items;
}

function endOfQuantity(text: string, index: number): number {
  const rest = wordAfter(text, index);
  const unit = UNIT.exec(rest) ?? GATED.exec(rest) ?? CLOCK.exec(rest);
  if (!unit) return index;
  let end = index + (text.slice(index).length - rest.length) + unit[0].length;
  if (text[end] === "'") end += 1;
  return end;
}

function readSlash(text: string, index: number): Item | null {
  const match = /^\s*(\d+)(?:\([^)]+\))?\/\d+(?:\/\d+)?/.exec(text.slice(index));
  if (!match) return null;
  const lead = match[0].length - match[0].trimStart().length;
  return makeItem({
    kind: "standing_order",
    ref: `SO ${match[0].trim()}`,
    slash: true,
    textStart: index + lead,
    textEnd: index + match[0].length,
  });
}

function readRuling(text: string, index: number, numberAt: number, inBracket: boolean): { items: Item[]; end: number; plural: boolean } | null {
  const num = /^\s*(\d+)\s*\/\s*(\d+)/.exec(text.slice(numberAt));
  if (!num) {
    // "ruling" and "rulings" in prose are ordinary words unless a ruling number follows.
    if (!inBracket) return null;
    return { plural: false, end: numberAt, items: [makeItem({ kind: "unresolvable", ref: text.slice(index, numberAt).trim(), residue: true, textStart: index, textEnd: numberAt })] };
  }
  let end = numberAt + num[0].length;
  const pins = readPins(text, end);
  end = pins.end;
  const cpk = `R ${num[1]}/${num[2]}${pins.pins}`;
  const pinTail = unreadablePinTail(text, end);
  if (pinTail > end) {
    const base = makeItem({ kind: "speakers_ruling", ref: cpk.replace(/^R /, "SR "), cpk, pins: pins.pins, textStart: index, textEnd: end });
    return { plural: false, end: pinTail, items: [base, pinResidue(text, end, pinTail)] };
  }
  const range = rangeAt(text, end);
  if (range) {
    const next = /^\s*(\d+)\s*\/\s*(\d+)/.exec(text.slice(range.end));
    if (next) {
      return {
        plural: false,
        end: range.end + next[0].length,
        items: [makeItem({ kind: "speakers_ruling", ref: `${cpk}..`, range: true, cpk, textStart: index, textEnd: range.end + next[0].length })],
      };
    }
    const bare = /^\s*(\d+)\b/.exec(text.slice(range.end));
    if (bare) {
      const endAll = range.end + bare[0].length;
      return {
        plural: false,
        end: endAll,
        items: [makeItem({
          kind: "speakers_ruling",
          ref: `${cpk}..${bare[1]}`,
          range: true,
          cpk,
          textStart: index,
          textEnd: endAll,
        })],
      };
    }
  }
  const item = finishYear(text, makeItem({ kind: "speakers_ruling", ref: cpk.replace(/^R /, "SR "), cpk, pins: pins.pins, textStart: index, textEnd: end }));
  return { plural: false, end: item.textEnd, items: [item] };
}

function readBare(text: string, index: number, inBracket: boolean): { items: Item[]; end: number; plural: boolean } | null {
  if (!inBracket && !/^\d+\s*\//.test(text.slice(index))) return null;
  if (/^\d+\s*\//.test(text.slice(index)) && boundary(text, index)) {
    const ruling = readRuling(text, index, index, inBracket);
    if (ruling && ruling.items[0] && !ruling.items[0].residue) return ruling;
  }
  return null;
}

function readAppendix(text: string, index: number): { items: Item[]; end: number } | null {
  if (!boundary(text, index)) return null;
  const slice = text.slice(index);
  const table = /^appendix\s+([a-f])\s+table\s+(\d+)\s+row\s+(\d+)/i.exec(slice);
  if (table) {
    const cpk = `APP ${table[1].toUpperCase()} table ${table[2]} row ${table[3]}`;
    return { end: index + table[0].length, items: [makeItem({ kind: "appendix", ref: cpk, cpk, textStart: index, textEnd: index + table[0].length })] };
  }
  const partRow = /^appendix\s+([a-f])\s+part\s+(\d+)\s+row\s+(\d+)/i.exec(slice);
  if (partRow) {
    const cpk = `APP ${partRow[1].toUpperCase()} part ${partRow[2]} row ${partRow[3]}`;
    return { end: index + partRow[0].length, items: [makeItem({ kind: "appendix", ref: cpk, cpk, textStart: index, textEnd: index + partRow[0].length })] };
  }
  const note = /^appendix\s+([a-f])\s+note\b/i.exec(slice);
  if (note) {
    const cpk = `APP ${note[1].toUpperCase()} note`;
    return { end: index + note[0].length, items: [makeItem({ kind: "appendix_note", ref: cpk, cpk, textStart: index, textEnd: index + note[0].length })] };
  }
  const clause = /^appendix\s+([a-f])\s*,?\s*(?:clause|clauses|cl\.?)\s+(\d+[A-Za-z]*)/i.exec(slice);
  if (clause) {
    const pins = readPins(text, index + clause[0].length);
    const cpk = `APP ${clause[1].toUpperCase()} cl ${clause[2]}${pins.pins}`;
    const tail = unreadablePinTail(text, pins.end);
    const clauseItems = [makeItem({ kind: "appendix", ref: cpk, cpk, pins: pins.pins, textStart: index, textEnd: pins.end })];
    if (tail > pins.end) clauseItems.push(pinResidue(text, pins.end, tail));
    return { end: tail, items: clauseItems };
  }
  const ofApp = /^(?:clauses|clause|cl\.?)\s+(\d+[A-Za-z]*)([\s\S]*?)\s+of\s+appendix\s+([a-f])/i.exec(slice);
  if (ofApp && ofApp[0].length < 120) {
    const letter = ofApp[3].toUpperCase();
    const extras = [...ofApp[2].matchAll(/(\d+[A-Za-z]*)/g)].map((match) => match[1]);
    const end = index + ofApp[0].length;
    const numbers = [ofApp[1], ...extras];
    return {
      end,
      items: numbers.map((number) => makeItem({
        kind: "appendix",
        ref: `APP ${letter} cl ${number}`,
        cpk: `APP ${letter} cl ${number}`,
        textStart: index,
        textEnd: end,
      })),
    };
  }
  const part = /^part\s+(\d+)\s+of\s+appendix\s+([a-f])/i.exec(slice);
  if (part) {
    const cpk = `APP ${part[2].toUpperCase()} part ${part[1]}`;
    return { end: index + part[0].length, items: [makeItem({ kind: "appendix", ref: cpk, cpk, textStart: index, textEnd: index + part[0].length })] };
  }
  const bare = /^appendix(?:\s+([a-f])|\s+(\d+))?\b/i.exec(slice);
  if (bare) {
    if (bare[2]) {
      return { end: index + bare[0].length, items: [makeItem({ kind: "appendix", ref: "APP ?", residue: true, textStart: index, textEnd: index + bare[0].length })] };
    }
    const letter = bare[1]?.toUpperCase();
    const cpk = letter ? `APP ${letter}` : null;
    return { end: index + bare[0].length, items: [makeItem({ kind: "appendix", ref: cpk ?? "APP ?", cpk, residue: !letter, textStart: index, textEnd: index + bare[0].length })] };
  }
  return null;
}

function readTitle(text: string, index: number): Item | null {
  if (!boundary(text, index)) return null;
  const match = /^(?:the\s+)?(?:standing\s+orders|speakers'\s+rulings(?:\s+supplement)?)\s+(1[8-9]\d{2}|20\d{2})\b/i.exec(text.slice(index));
  if (!match) return null;
  const year = Number(match[1]);
  const sr = /rulings/i.test(match[0]);
  const current = sr ? year === 2023 : year === 2026;
  return makeItem({
    kind: "instrument_title",
    ref: match[0].replace(/^the\s+/i, ""),
    title: true,
    superseded: !current,
    textStart: index,
    textEnd: index + match[0].length,
  });
}

function readQuantityAt(text: string, index: number): Item | null {
  if (!boundary(text, index)) return null;
  const number = readNumberToken(text, index) ?? (() => {
    const card = readCardinal(text, index);
    return card ? { value: card.value, raw: String(card.value), end: card.end, suffix: "" } : null;
  })();
  if (!number) {
    const frac = /^(\d+\s*\/\s*\d+)\s+majority\b/i.exec(text.slice(index));
    if (frac) return makeItem({ kind: "quantity", ref: "QTY", quantity: true, textStart: index, textEnd: index + frac[0].length });
    const spelledFrac = /^(?:two-thirds|one-half|three-quarters)(?:\s+majority)?\b/i.exec(text.slice(index));
    if (spelledFrac) return makeItem({ kind: "quantity", ref: "QTY", quantity: true, textStart: index, textEnd: index + spelledFrac[0].length });
    return null;
  }
  if (number.value >= 1 && number.value <= 12 && CLOCK.test(wordAfter(text, number.end))) {
    return makeItem({ kind: "quantity", ref: "QTY", quantity: true, textStart: index, textEnd: endOfQuantity(text, number.end) });
  }
  if (/^\s*\/\s*\d+\s+majority\b/i.test(text.slice(number.end))) {
    const maj = /^\s*\/\s*\d+\s+majority\b/i.exec(text.slice(number.end));
    return makeItem({ kind: "quantity", ref: "QTY", quantity: true, textStart: index, textEnd: number.end + (maj?.[0].length ?? 0) });
  }
  if (isQuantityTail(text, number.end, false, "")) {
    return makeItem({ kind: "quantity", ref: "QTY", quantity: true, textStart: index, textEnd: endOfQuantity(text, number.end) });
  }
  return null;
}

function scanRegion(text: string, from: number, to: number, where: "bracket" | "prose"): { items: Item[]; end: number } {
  const items: Item[] = [];
  let cursor = from;
  while (cursor < to) {
    while (text[cursor] === " ") cursor += 1;
    if (cursor >= to) break;
    const title = readTitle(text, cursor);
    if (title && title.textEnd <= to + 1) {
      title.textStart = cursor;
      items.push(title);
      cursor = title.textEnd;
      if (/standing orders/i.test(title.ref)) {
        const at = skipSpace(text, cursor);
        const probe = readSoNumber(text, at, false);
        if (probe && probe.value !== null && probe.end <= to && !isQuantityTail(text, probe.end, false, "")) {
          const prefix = "SOs ";
          const parsed = readProvisionAt(`${prefix}${text.slice(at, to)}`, 0, where === "bracket", false);
          if (parsed) {
            const delta = at - prefix.length;
            for (const item of parsed.items) {
              items.push({ ...item, textStart: Math.max(at, item.textStart + delta), textEnd: item.textEnd + delta });
            }
            cursor = Math.min(to, parsed.end + delta);
          }
        }
      }
      continue;
    }
    const appendix = readAppendix(text, cursor);
    if (appendix && appendix.end <= to) {
      items.push(...appendix.items);
      cursor = appendix.end;
      continue;
    }
    const lowerSo = /^so\b/i.exec(text.slice(cursor));
    if (lowerSo && text.slice(cursor, cursor + 2).toLowerCase() === "so" && text[cursor] === "s") {
      const rest = readProvisionAt(text, cursor, where === "bracket", true);
      const firstNum = rest?.items.find((item) => item.number !== null);
      if (rest && firstNum && isQuantityTail(text, rest.items[0].textEnd, true, "")) {
        const qty = readQuantityAt(text, firstNum.textStart);
        if (qty) {
          items.push(qty);
          cursor = qty.textEnd;
          continue;
        }
      }
    }
    const provision = readProvisionAt(text, cursor, where === "bracket", true);
    if (provision && provision.end <= to && provision.items.length > 0) {
      items.push(...provision.items);
      cursor = provision.end;
      continue;
    }
    const qty = readQuantityAt(text, cursor);
    if (qty && qty.textEnd <= to) {
      items.push(qty);
      cursor = qty.textEnd;
      continue;
    }
    const join = joinerAt(text, cursor);
    if (join && items.length > 0) {
      const pin = readPins(text, join.end);
      if (pin.pins && pin.end > join.end) {
        const prev = items[items.length - 1];
        const base = (prev.cpk ?? "").replace(/\([^)]*\)$/, "");
        if (base) {
          const cpk = `${base}${pin.pins}`;
          items.push(makeItem({ kind: prev.kind, ref: cpk, cpk, pins: pin.pins, textStart: join.end, textEnd: pin.end }));
          cursor = pin.end;
          continue;
        }
      }
    }
    const wrapped = /^\s*\(\s*/.exec(text.slice(cursor));
    if (wrapped && cursor + wrapped[0].length < to) {
      let innerAt = cursor + wrapped[0].length;
      const lead = /^(?:cf\.|cf|see also|see|also)\s+/i.exec(text.slice(innerAt));
      if (lead) innerAt += lead[0].length;
      const inner = readProvisionAt(text, innerAt, where === "bracket", false);
      if (inner && inner.end <= to && inner.items.some((item) => item.cpk || item.kind === "standing_order" || item.kind === "speakers_ruling" || item.kind === "appendix")) {
        items.push(...inner.items);
        cursor = inner.end;
        if (text[cursor] === ")") cursor += 1;
        continue;
      }
    }
    if (where === "bracket" && items.length > 0 && /\d/.test(text.slice(cursor, to))) {
      items.push(makeItem({
        kind: "residue",
        ref: text.slice(cursor, to).trim().slice(0, 40),
        residue: true,
        textStart: cursor,
        textEnd: to,
      }));
      break;
    }
    if (where === "bracket" && items.length === 0) {
      const body = text.slice(cursor, to).trim();
      const url = /^https?:\/\/|^www\./i.test(body);
      const backref = /^(?:ibid\.?|op\.?\s*cit\.?|see above|see infra|see supra)$/i.test(body);
      const orphan = /^\([0-9]+[A-Za-z]*\)$/.test(body) || /^\([a-z]{1,2}\)$/i.test(body) || /^\([ivxlcdm]+\)$/i.test(body);
      const digit = /\d/.test(body) || Boolean(readCardinal(body, 0));
      const editorial = !backref && !orphan && (!digit || url || body === "..." || body === "?" || body === "-" || body === "");
      items.push(makeItem({
        kind: editorial ? "editorial" : "unresolvable",
        ref: body || "blank",
        residue: !editorial,
        editorial,
        textStart: cursor,
        textEnd: to,
      }));
      break;
    }
    cursor += 1;
  }
  return { items, end: to };
}

type TreeIndex = {
  nodes: Map<string, Set<string>>;
  unknown: Set<string>;
};

function labelToCpk(label: string): string | null {
  const flat = label.replace(/\s+/g, " ").trim();
  const so = /^(?:standing orders?|s\.?\s*o\.?|so)\s*(\d+[A-Za-z]*)(.*)$/i.exec(flat);
  if (so && !so[1].includes("/")) return `SO ${so[1]}${so[2].replace(/\s+/g, "")}`;
  const ruling = /^(?:sr|s\.r\.|speakers?'?\s+rulings?|rulings?)?\s*(\d+\s*\/\s*\d+)/i.exec(flat);
  if (ruling && /\//.test(flat)) return `R ${ruling[1].replace(/\s+/g, "")}`;
  const bare = /^(\d+\s*\/\s*\d+)/.exec(flat);
  if (bare) return `R ${bare[1].replace(/\s+/g, "")}`;
  const note = /^appendix\s+([a-f])\s+note$/i.exec(flat);
  if (note) return `APP ${note[1].toUpperCase()} note`;
  const table = /^appendix\s+([a-f])\s+table\s+(\d+)\s+row\s+(\d+)$/i.exec(flat);
  if (table) return `APP ${table[1].toUpperCase()} table ${table[2]} row ${table[3]}`;
  const part = /^appendix\s+([a-f])\s+part\s+(\d+)(?:\s+row\s+(\d+))?$/i.exec(flat);
  if (part) return `APP ${part[1].toUpperCase()} part ${part[2]}${part[3] ? ` row ${part[3]}` : ""}`;
  const clause = /^appendix\s+([a-f])\s+(?:cl\.?|clause)\s+(\d+[A-Za-z]*)$/i.exec(flat);
  if (clause) return `APP ${clause[1].toUpperCase()} cl ${clause[2]}`;
  return null;
}

function ancestorOf(cpk: string, admitted: Set<string>): string | null {
  let best: string | null = null;
  for (const label of admitted) {
    if (cpk === label) return label;
    if (cpk.startsWith(`${label}(`) && (best === null || label.length > best.length)) best = label;
  }
  return best;
}

function isRevoked(cpk: string): boolean {
  for (const entry of REVOKED) {
    if (cpk === entry || cpk.startsWith(`${entry}(`)) return true;
  }
  return false;
}

function gradeItem(item: Item, admitted: Set<string>, trees: TreeIndex, tags: Set<string>, where: "bracket" | "prose"): { status: PartStatus; code: RuleCode; cpk: string | null } {
  if (item.quantity) return { status: "not_citation", code: "quantity", cpk: null };
  if (item.editorial) return { status: "not_citation", code: "neutral", cpk: null };
  if (item.title && !item.superseded) return { status: "not_citation", code: "neutral", cpk: null };
  if (item.title && item.superseded) return { status: "ungrounded", code: "ungrounded-superseded", cpk: null };
  if (item.open) return { status: "ungrounded", code: "ungrounded-open-range", cpk: null };
  if (item.slash) return { status: "ungrounded", code: "ungrounded-misattributed", cpk: null };
  if (item.range && item.kind === "standing_order") return { status: "ungrounded", code: "ungrounded-range", cpk: null };
  if (item.range && item.kind === "speakers_ruling") return { status: "ungrounded", code: "deferred-ruling-index", cpk: item.cpk };
  if (item.residue || item.kind === "unresolvable") return { status: "ungrounded", code: "ungrounded-residue", cpk: null };
  if (item.yearBound) return { status: "ungrounded", code: "ungrounded-edition", cpk: item.cpk };
  if (item.kind === "speakers_ruling" && item.pins) return { status: "ungrounded", code: "deferred-ruling-index", cpk: item.cpk };
  if (item.ref.startsWith("SO ") && item.ref.includes("..")) {
    const span = /^SO (\d+)\.\.(\d+)$/.exec(item.ref);
    if (span) {
      const from = Number(span[1]);
      const to = Number(span[2]);
      let all = true;
      for (let n = from; n <= to; n += 1) if (!admitted.has(`SO ${n}`)) all = false;
      if (all) return { status: "grounded", code: "grounded", cpk: null };
      return { status: "ungrounded", code: "ungrounded-not-admitted", cpk: null };
    }
  }
  const cpk = item.cpk;
  if (!cpk) return { status: "ungrounded", code: "ungrounded-residue", cpk: null };
  if (isRevoked(cpk)) return { status: "ungrounded", code: "ungrounded-revoked", cpk };
  if (admitted.has(cpk)) {
    if (item.year && !item.yearBound) return { status: "grounded", code: "grounded", cpk };
    return { status: "grounded", code: "grounded", cpk };
  }
  const ancestor = ancestorOf(cpk, admitted);
  if (!ancestor || ancestor === cpk) {
    if (item.suffixStart !== null && where === "prose" && tags.has("deferred-Q5")) {
      return { status: "ungrounded", code: "deferred-Q5", cpk };
    }
    if (where === "bracket" && tags.has("deferred-quote")) return { status: "ungrounded", code: "deferred-quote", cpk };
    return { status: "ungrounded", code: "ungrounded-not-admitted", cpk };
  }
  if (item.kind === "appendix_note") return { status: "ungrounded", code: "ungrounded-nonexistent", cpk };
  if (trees.unknown.has(ancestor)) return { status: "ungrounded", code: "unknown-tree", cpk };
  const nodes = trees.nodes.get(ancestor);
  if (!nodes) return { status: "ungrounded", code: "unknown-tree", cpk };
  if (nodes.has(cpk)) return { status: "grounded", code: "grounded-pinpoint", cpk };
  const parent = cpk.replace(/\([^()]+\)$/, "");
  if (AMBIGUOUS_PARENTS.has(parent) || AMBIGUOUS_PARENTS.has(ancestor)) {
    return { status: "ungrounded", code: "ambiguous-tree", cpk };
  }
  if (where === "bracket" && tags.has("deferred-quote")) return { status: "ungrounded", code: "deferred-quote", cpk };
  return { status: "ungrounded", code: "ungrounded-nonexistent", cpk };
}

function bracketClass(parts: Array<{ status: PartStatus }>): BracketClass {
  const grounded = parts.some((part) => part.status === "grounded");
  const ungrounded = parts.some((part) => part.status === "ungrounded");
  if (grounded && ungrounded) return "partial";
  if (grounded) return "grounded";
  if (ungrounded) return "ungrounded";
  return "not_citation";
}

function rowCode(codes: RuleCode[]): RuleCode {
  for (const code of ROW_PRECEDENCE) {
    if (codes.includes(code)) return code;
  }
  return "uncited";
}

function verdictOf(parts: Array<{ status: PartStatus }>): RowVerdict {
  const grounded = parts.some((part) => part.status === "grounded");
  const ungrounded = parts.some((part) => part.status === "ungrounded");
  if (grounded && !ungrounded) return "yes";
  if (grounded && ungrounded) return "partial";
  return "no";
}

const ROMAN_GLYPHS: Array<[number, string]> = [
  [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"],
  [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
];

function canonicalRoman(value: number): string {
  let rest = value;
  let out = "";
  for (const [amount, glyph] of ROMAN_GLYPHS) {
    while (rest >= amount) {
      out += glyph;
      rest -= amount;
    }
  }
  return out;
}

function romanValue(token: string): number | null {
  const lower = token.toLowerCase();
  if (!/^[ivxlcdm]+$/.test(lower)) return null;
  const digit: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  let total = 0;
  let previous = 0;
  for (let index = lower.length - 1; index >= 0; index -= 1) {
    const value = digit[lower[index]] ?? 0;
    if (value < previous) total -= value;
    else {
      total += value;
      previous = value;
    }
  }
  if (total <= 0 || canonicalRoman(total) !== lower) return null;
  return total;
}

function buildTree(label: string, sectionContent: string): { nodes: Set<string>; revoked: string[] } {
  const cpk = labelToCpk(label) ?? label;
  const norm = normalizeGrammarTextStable(sectionContent).text;
  const nodes = new Set<string>([cpk]);
  const revoked = new Set<string>();
  const letterCounts = new Map<string, Map<string, number>>();
  const ambiguous = new Set<string>();
  let letterParent = cpk;
  let lastLetter: string | null = null;
  let letterHost: string | null = null;
  let romanOpen = false;
  let lastRoman = 0;
  const noteLetter = (parent: string, letter: string) => {
    const counts = letterCounts.get(parent) ?? new Map<string, number>();
    const count = (counts.get(letter) ?? 0) + 1;
    counts.set(letter, count);
    letterCounts.set(parent, counts);
    if (count > 1) ambiguous.add(parent);
  };
  for (const line of norm.split(/\n/)) {
    const marker = /^\s*\(([0-9]+[A-Z]*|[a-z]{1,4}|[ivxlcdm]+)\)\s*([\s\S]*)$/i.exec(line);
    if (!marker) {
      if (/^\s*\[revoked/i.test(line)) revoked.add(cpk);
      continue;
    }
    const token = marker[1];
    const rest = marker[2] ?? "";
    const lower = token.toLowerCase();
    const revokedHere = /^\s*\[revoked/i.test(rest);
    if (/^[0-9]/.test(token)) {
      const key = `${cpk}(${token})`;
      letterParent = key;
      lastLetter = null;
      letterHost = null;
      romanOpen = false;
      lastRoman = 0;
      if (revokedHere) revoked.add(key);
      else nodes.add(key);
      continue;
    }
    const rom = romanValue(lower);
    // A two-letter insert keeps the letter run: (b)(ba)(c) and (c)(ca)(d).
    // The next single letter continues from the insert's first letter, and is not a roman under the insert.
    const anchor = lastLetter === null ? "" : lastLetter.length === 1 ? lastLetter : lastLetter[0];
    const continuesLetter = anchor.length === 1 && lower.length === 1
      && lower.charCodeAt(0) === anchor.charCodeAt(0) + 1;
    // (aa) and (ab) are letters. (ii) and (iv) are roman, even though they are two letters.
    const asLetter = (/^[a-z]{2}$/.test(lower) && rom === null) || continuesLetter || (/^[a-z]$/.test(lower) && rom === null);
    if (asLetter) {
      const key = `${letterParent}(${lower})`;
      noteLetter(letterParent, lower);
      lastLetter = lower;
      letterHost = key;
      romanOpen = false;
      lastRoman = 0;
      if (revokedHere) revoked.add(key);
      else nodes.add(key);
      continue;
    }
    if (rom !== null && (!romanOpen || rom === lastRoman + 1)) {
      const parent = letterHost ?? letterParent;
      const key = `${parent}(${lower})`;
      if (revokedHere) revoked.add(key);
      else nodes.add(key);
      romanOpen = true;
      lastRoman = rom;
    }
  }
  for (const parent of ambiguous) {
    for (const node of [...nodes]) {
      if (node.startsWith(`${parent}(`)) nodes.delete(node);
    }
  }
  for (const node of revoked) nodes.delete(node);
  return { nodes, revoked: [...revoked] };
}

/** Structural subdivisions of one provision, from its full section text. */
export function buildProvisionTree(label: string, sectionContent: string): string[] {
  return [...buildTree(label, sectionContent).nodes].sort();
}

function indexTrees(authorities: GrammarAuthority[], override: Record<string, string[]> | null | undefined): { admitted: Set<string>; trees: TreeIndex } {
  const admitted = new Set<string>();
  const nodes = new Map<string, Set<string>>();
  const unknown = new Set<string>();
  for (const authority of authorities) {
    const cpk = labelToCpk(authority.citationLabel);
    if (!cpk) continue;
    admitted.add(cpk);
    if (override && Object.prototype.hasOwnProperty.call(override, cpk)) {
      nodes.set(cpk, new Set(override[cpk]));
      continue;
    }
    if (override && Object.prototype.hasOwnProperty.call(override, authority.citationLabel)) {
      nodes.set(cpk, new Set(override[authority.citationLabel]));
      continue;
    }
    if (override) {
      unknown.add(cpk);
      continue;
    }
    if (!authority.sectionContent?.trim()) {
      unknown.add(cpk);
      continue;
    }
    const built = buildTree(authority.citationLabel, authority.sectionContent);
    nodes.set(cpk, built.nodes);
  }
  return { admitted, trees: { nodes, unknown } };
}

function findBrackets(text: string): Array<{ start: number; end: number; contentStart: number; contentEnd: number }> {
  const found = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== "[") continue;
    let end = i + 1;
    let closed = false;
    while (end < text.length) {
      if (text[end] === "]" ) { closed = true; break; }
      if (text[end] === "\n" || text[end] === "[") break;
      end += 1;
    }
    const content = text.slice(i + 1, end);
    if (content.length === 0 && closed) { i = end; continue; }
    found.push({ start: i, end: closed ? end + 1 : end, contentStart: i + 1, contentEnd: end });
    i = end - (closed ? 0 : 1);
  }
  return found;
}

export function assessCitations(text: string, authorities: GrammarAuthority[], options: GrammarOptions = {}): GrammarAssessment {
  const norm = normalizeGrammarTextStable(text);
  const tags = new Set(options.deferralTags ?? []);
  const { admitted, trees } = indexTrees(authorities, options.provisionTree);
  const bracketsRaw = findBrackets(norm.text);
  const masked = norm.text.split("");
  for (const bracket of bracketsRaw) {
    for (let i = bracket.start; i < bracket.end && i < masked.length; i += 1) masked[i] = " ";
  }
  const prose = scanRegion(masked.join(""), 0, masked.length, "prose");
  const mentions: GrammarMention[] = [];
  const brackets: GrammarBracket[] = [];
  const proseItems = prose.items.filter((item) => {
    const inside = bracketsRaw.some((bracket) => item.textStart >= bracket.start && item.textStart < bracket.end);
    return !inside;
  });
  for (const item of proseItems) {
    const graded = gradeItem(item, admitted, trees, tags, "prose");
    if (item.year && !item.yearBound) {
      mentions.push(toMention(item, graded, "prose", norm));
      mentions.push({
        where: "prose", ref: `ED ${item.year}`, kind: "edition_qualifier", status: "not_citation",
        code: "grounded-qualifier", cpk: null, ...origSpan(norm, item.textEnd - 6, item.textEnd),
      });
      continue;
    }
    mentions.push(toMention(item, graded, "prose", norm));
  }
  bracketsRaw.forEach((bracket) => {
    const content = norm.text.slice(bracket.contentStart, bracket.contentEnd);
    const parsed = scanRegion(norm.text, bracket.contentStart, bracket.contentEnd, "bracket");
    const parts = parsed.items.map((item) => ({ item, graded: gradeItem(item, admitted, trees, tags, "bracket") }));
    for (const part of parts) {
      if (part.item.year && !part.item.yearBound && part.graded.status === "grounded") {
        mentions.push(toMention(part.item, part.graded, "bracket", norm));
        mentions.push({
          where: "bracket", ref: `ED ${part.item.year}`, kind: "edition_qualifier", status: "not_citation",
          code: "grounded-qualifier", cpk: null, ...origSpan(norm, part.item.textEnd - 6, part.item.textEnd),
        });
      } else {
        mentions.push(toMention(part.item, part.graded, "bracket", norm));
      }
    }
    const klass = bracketClass(parts.map((part) => part.graded));
    brackets.push({
      text: content,
      class: klass,
      code: klass === "not_citation" ? "neutral-bracket" : null,
      ...origSpan(norm, bracket.start, bracket.end),
    });
  });
  mentions.sort((a, b) => a.start - b.start || a.end - b.end);
  const codes = mentions.map((mention) => mention.code);
  const verdict = verdictOf(mentions);
  const badBracket = brackets.some((bracket) => bracket.class === "ungrounded" || bracket.class === "partial");
  const proseBad = mentions.some((mention) => mention.where === "prose" && mention.status === "ungrounded");
  const stripped = mentions.some((mention) => mention.where === "prose" && mention.status === "grounded" && text.slice(mention.start, mention.end).toLowerCase().includes("not retrieved"));
  const grounded = mentions.some((mention) => mention.status === "grounded");
  const reasonCode = badBracket ? "withheld_invalid_citations"
    : proseBad || stripped ? "rewritten"
    : grounded ? "served"
    : "served_no_authority";
  const groundedCpk = [...new Set(mentions.filter((mention) => mention.status === "grounded" && mention.cpk).map((mention) => mention.cpk as string))].sort();
  return {
    mentions,
    brackets,
    verdict,
    reasonCode,
    ruleCodes: {
      parts: codes,
      brackets: brackets.map((bracket) => bracket.code),
      row: rowCode(codes),
    },
    groundedCpk,
    rewriteSpans: mentions.filter((mention) => mention.where === "prose" && mention.status === "ungrounded").map((mention) => ({ start: mention.start, end: mention.end })),
    stripSpans: mentions.filter((mention) => mention.where === "prose" && mention.status === "grounded" && text.slice(mention.start, mention.end).toLowerCase().includes("referred to in")).map((mention) => ({ start: mention.start, end: mention.end })),
  };
}

function toMention(item: Item, graded: { status: PartStatus; code: RuleCode; cpk: string | null }, where: "bracket" | "prose", norm: Norm): GrammarMention {
  return {
    where,
    ref: item.ref,
    kind: item.kind,
    status: graded.status,
    code: graded.code,
    cpk: graded.cpk,
    ...origSpan(norm, item.textStart, item.textEnd),
  };
}

const ACT_QUALIFICATION = "has not been confirmed to govern the specific act asked about.";
const FORUM_QUALIFICATION = "has not been confirmed to be the body the question is about.";
const SUBSTANTIVE = new Set(["Bottom line:", "What this means:", "Your options:", "Risks or constraints:"]);
const AUTHORITY_HEADINGS = new Set(["Best authorities to inspect or cite:", "Possibly relevant, not confirmed to apply:"]);

function lineCitesKey(line: string, key: string): boolean {
  for (const match of line.matchAll(/\[([^\[\]]+)\]/g)) {
    for (const part of match[1].split(/[;,]/)) {
      const parsed = labelToCpk(part.trim());
      if (parsed === key || (parsed !== null && parsed.startsWith(`${key}(`))) return true;
    }
  }
  return false;
}

/** Append main's qualification only where the parser says the claim is qualified or still ungrounded. */
export function applyStructuredHedge(answerText: string, assessment: GrammarAssessment, input: {
  actLabels?: string[];
  forumLabels?: string[];
}): string {
  if (answerText == null || answerText === "") {
    throw new TypeError("answer text is empty");
  }
  const actLabels = input.actLabels ?? [];
  const forumLabels = input.forumLabels ?? [];
  const act = new Set(actLabels.map((label) => labelToCpk(label)).filter((label): label is string => Boolean(label)));
  const forum = new Set(forumLabels.map((label) => labelToCpk(label)).filter((label): label is string => Boolean(label)));
  const lines = answerText.split("\n");
  let offset = 0;
  let section: string | null = null;
  const claimAt = new Map<number, number>();
  lines.forEach((line, index) => {
    const start = offset;
    offset += line.length + 1;
    const trimmed = line.trim();
    if (SUBSTANTIVE.has(trimmed) || AUTHORITY_HEADINGS.has(trimmed)) {
      section = trimmed;
      return;
    }
    if (section && SUBSTANTIVE.has(section) && trimmed) claimAt.set(index, start);
  });
  const placedAct = new Set<string>();
  const placedForum = new Set<string>();
  const appendSentence = (index: number, sentence: string) => {
    if (!lines[index].includes(sentence)) lines[index] = `${lines[index]} ${sentence}`;
  };
  for (const [index, start] of claimAt) {
    const end = start + lines[index].length;
    const parts = assessment.mentions.filter((mention) => mention.end > start && mention.start < end && mention.kind !== "quantity" && mention.kind !== "editorial" && mention.kind !== "edition_qualifier" && mention.kind !== "instrument_title");
    const citationParts = parts.filter((part) => part.cpk);
    const sureGrounded = citationParts.length > 0 && citationParts.every((part) => part.status === "grounded");
    const cited = (key: string) => citationParts.some((part) => part.cpk === key || part.cpk?.startsWith(`${key}(`)) || lineCitesKey(lines[index], key);
    const actHits = [...act].filter(cited);
    const forumHits = [...forum].filter(cited);
    if (sureGrounded && actHits.length === 0 && forumHits.length === 0) continue;
    for (const key of actHits) {
      appendSentence(index, `[${displayLabel(key, actLabels)}] ${ACT_QUALIFICATION}`);
      placedAct.add(key);
    }
    for (const key of forumHits) {
      appendSentence(index, `[${displayLabel(key, forumLabels)}] ${FORUM_QUALIFICATION}`);
      placedForum.add(key);
    }
  }
  const qualificationLines: string[] = [];
  for (const label of actLabels) {
    const key = labelToCpk(label);
    if (!key || placedAct.has(key)) continue;
    const sentence = `[${label}] ${ACT_QUALIFICATION}`;
    if (!answerText.includes(sentence)) qualificationLines.push(sentence);
  }
  for (const label of forumLabels) {
    const key = labelToCpk(label);
    if (!key || placedForum.has(key)) continue;
    const sentence = `[${label}] ${FORUM_QUALIFICATION}`;
    if (!answerText.includes(sentence)) qualificationLines.push(sentence);
  }
  if (qualificationLines.length > 0) lines.push("", "Qualification:", ...qualificationLines);
  return lines.join("\n");
}

function displayLabel(cpk: string, labels: string[]): string {
  const wanted = labelToCpk(cpk) ?? cpk;
  return labels.find((label) => labelToCpk(label) === wanted) ?? cpk;
}

export function rewriteByGrammar(text: string, assessment: GrammarAssessment): { text: string; removed: number } {
  type Edit = { start: number; end: number; kind: "rewrite" | "strip" };
  const edits: Edit[] = [
    ...assessment.rewriteSpans.map((span) => ({ start: span.start, end: span.end, kind: "rewrite" as const })),
    ...assessment.stripSpans.map((span) => ({ start: span.start, end: span.end, kind: "strip" as const })),
  ].sort((a, b) => b.start - a.start || b.end - a.end);
  let next = text;
  let removed = 0;
  let lastStart = Number.POSITIVE_INFINITY;
  for (const edit of edits) {
    if (edit.start === lastStart) continue;
    lastStart = edit.start;
    if (edit.start < 0 || edit.end > next.length || edit.end <= edit.start) continue;
    if (edit.kind === "strip") {
      const slice = next.slice(edit.start, edit.end);
      const stripped = slice.replace(/\s*\(referred to in[^)]*not retrieved\)/i, "");
      if (stripped === slice) continue;
      next = `${next.slice(0, edit.start)}${stripped}${next.slice(edit.end)}`;
      continue;
    }
    next = `${next.slice(0, edit.start)}a provision that was not retrieved${next.slice(edit.end)}`;
    removed += 1;
  }
  return { text: next, removed };
}

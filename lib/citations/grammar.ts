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
  const chars = [...input];
  const out: string[] = [];
  const starts: number[] = [];
  const origAt: number[] = [];
  let orig = 0;
  for (const ch of chars) {
    const cp = ch.codePointAt(0) ?? 0;
    const start = orig;
    orig += ch.length;
    if (isSep(cp)) {
      if (out[out.length - 1] !== " ") {
        out.push(" ");
        starts.push(start);
        origAt.push(start);
      }
      continue;
    }
    if (FORMAT.has(cp)) {
      let next = "";
      let look = orig;
      const rest = input.slice(orig);
      for (const n of rest) {
        const ncp = n.codePointAt(0) ?? 0;
        if (FORMAT.has(ncp)) { look += n.length; continue; }
        next = n;
        break;
      }
      const prev = out[out.length - 1] ?? "";
      const prevClass = prev ? classOf(prev) : "other";
      const nextClass = next ? classOf(next) : "other";
      const bothLetters = (prevClass === "letter" || prevClass === "upper") && (nextClass === "letter" || nextClass === "upper");
      const bothDigits = prevClass === "digit" && nextClass === "digit";
      const digitUpper = prevClass === "digit" && nextClass === "upper";
      const letterDigit = ((prevClass === "letter" || prevClass === "upper") && nextClass === "digit")
        || (prevClass === "digit" && (nextClass === "letter" || nextClass === "upper"));
      if (bothLetters || bothDigits || digitUpper) continue;
      if (letterDigit && out[out.length - 1] !== " ") {
        out.push(" ");
        starts.push(start);
        origAt.push(start);
      }
      continue;
    }
    let emitted = ch;
    if (isSlash(cp)) emitted = "/";
    else if (isDash(cp)) emitted = "-";
    else if (isApos(cp)) emitted = "'";
    out.push(emitted);
    starts.push(start);
    origAt.push(start);
  }
  let text = out.join("");
  const mapped = starts.slice();
  text = text.replace(/ \/|\/ /g, (piece, offset: number) => {
    if (piece === " /") mapped.splice(offset, 1);
    else mapped.splice(offset + 1, 1);
    return "/";
  });
  // The replace above used the pre-mutation offset incorrectly for successive matches.
  // Rebuild slash spacing from a second walk instead.
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
  if (hundred) {
    value = 100;
    end = index + hundred[0].length;
    rest = text.slice(end);
    if (rest.startsWith(" ")) { /* already included */ }
  }
  const teen = /^(ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)\b/i.exec(rest);
  if (teen && (value === 0 || hundred)) {
    return { value: value + TEENS[teen[1].toLowerCase()], end: end + teen[0].length };
  }
  const ten = /^(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[-\s](one|two|three|four|five|six|seven|eight|nine))?\b/i.exec(rest);
  if (ten) {
    return { value: value + TENS[ten[1].toLowerCase()] + (ten[2] ? ONES[ten[2].toLowerCase()] : 0), end: end + ten[0].length };
  }
  const one = /^(one|two|three|four|five|six|seven|eight|nine)\b/i.exec(rest);
  if (one && (value > 0 || !hundred)) {
    if (value === 0) return { value: ONES[one[1].toLowerCase()], end: index + one[0].length };
    return { value: value + ONES[one[1].toLowerCase()], end: end + one[0].length };
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

const UNIT = /^(?:members?|mps?|people|persons?|seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|calendar\s+days?|working\s+days?|sitting\s+days?|weeks?|months?|years?|per\s+cent|percent|%|votes?|times?)\b/i;
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

function readSoNumber(text: string, index: number, allowParen: boolean): { raw: string; value: number | null; pins: string; end: number } | null {
  const spaced = /^\s*/.exec(text.slice(index));
  const at = index + (spaced?.[0].length ?? 0);
  if (!allowParen && /^\(\d+\)/.test(text.slice(at)) && !/^\(\d{4}\)/.test(text.slice(at))) {
    const paren = /^\((\d+)\)/.exec(text.slice(at));
    if (!paren) return null;
    const pins = readPins(text, at + paren[0].length);
    return { raw: paren[1], value: Number(paren[1]), pins: pins.pins, end: pins.end };
  }
  const token = readNumberToken(text, at);
  if (!token) return null;
  const pins = readPins(text, token.end);
  return { raw: `${token.raw}`, value: token.suffix ? null : token.value, pins: pins.pins, end: pins.end };
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
  if (prefix.family === "sr") return readRuling(text, index, prefix.end);
  let cursor = skipNumberWord(text, prefix.end);
  const slash = readSlash(text, cursor);
  if (slash) {
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
    textEnd: cursor,
  })];
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
      items.push(makeItem({ kind: "open_range", ref: "OPEN", open: true, textStart: cursor, textEnd: cursor + open[0].length }));
      cursor += open[0].length;
      break;
    }
    const range = rangeAt(text, cursor);
    if (range && items[items.length - 1].number !== null) {
      const next = readSoNumber(text, range.end, false);
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
      items.push(makeItem({
        kind: "standing_order",
        ref: continuedSlash[0].trim(),
        slash: true,
        textStart: after,
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
      items.push(makeItem({ kind: "standing_order", ref: cpk, cpk, pins: pinOnly.pins, textStart: after, textEnd: pinOnly.end }));
      cursor = pinOnly.end;
      continue;
    }
    const nested = readPrefix(text, after);
    if (nested) {
      const inner = readProvisionAt(text, after, inBracket, false);
      if (!inner) break;
      items.push(...inner.items);
      cursor = inner.end;
      continue;
    }
    const appendix = readAppendix(text, after);
    if (appendix) {
      items.push(...appendix.items);
      cursor = appendix.end;
      continue;
    }
    const nextNum = readSoNumber(text, after, false);
    if (!nextNum) {
      const rest = text.slice(after);
      const cut = rest.search(/[\]\n]/);
      const residueEnd = after + (cut < 0 ? Math.min(rest.length, 80) : cut);
      if (/\d/.test(text.slice(after, residueEnd)) || readCardinal(text, after)) {
        items.push(makeItem({ kind: "residue", ref: text.slice(after, residueEnd).trim().slice(0, 40), residue: true, textStart: after, textEnd: residueEnd }));
        cursor = residueEnd;
      }
      break;
    }
    if (isQuantityTail(text, nextNum.end, prefix.singular && /^\s*,/.test(join.text), join.text)) {
      items.push(makeItem({ kind: "quantity", ref: "QTY", quantity: true, textStart: after, textEnd: endOfQuantity(text, nextNum.end) }));
      cursor = endOfQuantity(text, nextNum.end);
      break;
    }
    items.push(makeItem({
      kind: "standing_order",
      ref: soCpk(nextNum.raw, nextNum.pins),
      cpk: soCpk(nextNum.raw, nextNum.pins),
      pins: nextNum.pins,
      number: nextNum.value,
      textStart: after,
      textEnd: nextNum.end,
    }));
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
  return makeItem({
    kind: "standing_order",
    ref: `SO ${match[0].trim()}`,
    slash: true,
    textStart: index,
    textEnd: index + match[0].length,
  });
}

function readRuling(text: string, index: number, numberAt: number): { items: Item[]; end: number; plural: boolean } | null {
  const num = /^\s*(\d+)\s*\/\s*(\d+)/.exec(text.slice(numberAt));
  if (!num) {
    return { plural: false, end: numberAt, items: [makeItem({ kind: "unresolvable", ref: text.slice(index, numberAt).trim(), residue: true, textStart: index, textEnd: numberAt })] };
  }
  let end = numberAt + num[0].length;
  const pins = readPins(text, end);
  end = pins.end;
  const cpk = `R ${num[1]}/${num[2]}${pins.pins}`;
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
      const base = makeItem({ kind: "speakers_ruling", ref: cpk.replace(/^R /, "SR "), cpk, pins: pins.pins, textStart: index, textEnd: end });
      const continuation = makeItem({
        kind: "speakers_ruling", ref: `R ..${bare[1]}`, range: true, cpk, textStart: end, textEnd: range.end + bare[0].length,
      });
      return { plural: false, end: continuation.textEnd, items: [base, continuation] };
    }
  }
  const item = finishYear(text, makeItem({ kind: "speakers_ruling", ref: cpk.replace(/^R /, "SR "), cpk, pins: pins.pins, textStart: index, textEnd: end }));
  return { plural: false, end: item.textEnd, items: [item] };
}

function readBare(text: string, index: number, inBracket: boolean): { items: Item[]; end: number; plural: boolean } | null {
  if (!inBracket && !/^\d+\s*\//.test(text.slice(index))) return null;
  if (/^\d+\s*\//.test(text.slice(index)) && boundary(text, index)) {
    const ruling = readRuling(text, index, index);
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
    return { end: pins.end, items: [makeItem({ kind: "appendix", ref: cpk, cpk, pins: pins.pins, textStart: index, textEnd: pins.end })] };
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
    const title = where === "prose" || true ? readTitle(text, cursor) : null;
    if (title && title.textEnd <= to + 1) {
      title.textStart = cursor;
      items.push(title);
      cursor = title.textEnd;
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
      const digit = /\d/.test(body) || readCardinal(body, 0);
      const editorial = !digit || url || body === "..." || body === "?" || body === "-" || body === "";
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
  const cpk = item.cpk;
  if (!cpk) return { status: "ungrounded", code: "ungrounded-residue", cpk: null };
  if (isRevoked(cpk)) return { status: "ungrounded", code: "ungrounded-revoked", cpk };
  if (admitted.has(cpk)) {
    if (item.year && !item.yearBound) return { status: "grounded", code: "grounded", cpk };
    return { status: "grounded", code: "grounded", cpk };
  }
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

function buildTree(label: string, sectionContent: string): { nodes: Set<string>; revoked: string[] } {
  const cpk = labelToCpk(label) ?? label;
  const norm = normalizeGrammarTextStable(sectionContent).text;
  const nodes = new Set<string>([cpk]);
  const revoked: string[] = [];
  const lines = norm.split(/\n/);
  type Frame = { key: string; letters: Map<string, number> };
  const stack: Frame[] = [{ key: cpk, letters: new Map() }];
  const ambiguous = new Set<string>();
  const romanRun = new Set<string>();
  for (const line of lines) {
    if (/^\s*\[revoked/i.test(line)) {
      const top = stack[stack.length - 1];
      if (top) revoked.push(top.key);
      continue;
    }
    const marker = /^\s*(\(([0-9]+[A-Z]*|[a-z]{1,2}|[ivxlcdm]+)\))/i.exec(line);
    if (!marker) continue;
    const token = marker[2];
    const isNumber = /^[0-9]/.test(token);
    const isRoman = /^[ivxlcdm]+$/i.test(token) && !/^i$/i.test(token) || (token.toLowerCase() === "i" && !romanRun.has("letter-i-context"));
    let parent = stack[0];
    if (isNumber) {
      while (stack.length > 1) stack.pop();
      parent = stack[0];
      const key = `${cpk}(${token})`;
      nodes.add(key);
      stack.push({ key, letters: new Map() });
      romanRun.clear();
      continue;
    }
    const lower = token.toLowerCase();
    const letterAfterH = lower === "i" && stack[stack.length - 1]?.letters.has("h");
    const roman = !letterAfterH && /^[ivxlcdm]+$/i.test(lower) && lower !== "i" ? true : (!letterAfterH && lower === "i" && (stack[stack.length - 1]?.letters.size ?? 0) === 0);
    if (!isNumber && !roman) {
      while (stack.length > 2 && !/^\d/.test(stack[stack.length - 1].key.slice(cpk.length))) stack.pop();
      if (stack.length > 1 && /\([ivx]+\)$/i.test(stack[stack.length - 1].key)) stack.pop();
      parent = stack[stack.length - 1];
      const count = (parent.letters.get(lower) ?? 0) + 1;
      parent.letters.set(lower, count);
      if (count > 1) ambiguous.add(parent.key);
      const key = `${parent.key}(${lower})`;
      nodes.add(key);
      stack.push({ key, letters: new Map() });
      continue;
    }
    parent = stack[stack.length - 1];
    const key = `${parent.key}(${lower})`;
    nodes.add(key);
    romanRun.add(key);
  }
  for (const parent of ambiguous) {
    for (const node of [...nodes]) {
      if (node.startsWith(`${parent}(`)) nodes.delete(node);
    }
  }
  for (const node of revoked) nodes.delete(node);
  return { nodes, revoked };
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

/** Append main's qualification only where the parser says the claim is qualified or still ungrounded. */
export function applyStructuredHedge(answerText: string, assessment: GrammarAssessment, input: {
  actLabels?: string[];
  forumLabels?: string[];
}): string {
  const act = new Set((input.actLabels ?? []).map((label) => labelToCpk(label)).filter((label): label is string => Boolean(label)));
  const forum = new Set((input.forumLabels ?? []).map((label) => labelToCpk(label)).filter((label): label is string => Boolean(label)));
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
  const placed = new Set<string>();
  for (const [index, start] of claimAt) {
    const end = start + lines[index].length;
    const parts = assessment.mentions.filter((mention) => mention.end > start && mention.start < end && mention.kind !== "quantity" && mention.kind !== "editorial" && mention.kind !== "edition_qualifier" && mention.kind !== "instrument_title");
    const citationParts = parts.filter((part) => part.cpk);
    const allGrounded = citationParts.length > 0 && citationParts.every((part) => part.status === "grounded");
    const qualified = citationParts.filter((part) => part.cpk && (act.has(part.cpk) || forum.has(part.cpk)));
    if (allGrounded && qualified.length === 0) continue;
    for (const part of qualified) {
      const sentence = act.has(part.cpk as string)
        ? `[${displayLabel(part.cpk as string, input.actLabels ?? [])}] ${ACT_QUALIFICATION}`
        : `[${displayLabel(part.cpk as string, input.forumLabels ?? [])}] ${FORUM_QUALIFICATION}`;
      placed.add(part.cpk as string);
      if (!lines[index].includes(sentence)) lines[index] = `${lines[index]} ${sentence}`;
    }
  }
  const qualificationLines: string[] = [];
  for (const label of input.actLabels ?? []) {
    const key = labelToCpk(label);
    if (!key || placed.has(key)) continue;
    const sentence = `[${label}] ${ACT_QUALIFICATION}`;
    if (!answerText.includes(sentence)) qualificationLines.push(sentence);
  }
  for (const label of input.forumLabels ?? []) {
    const key = labelToCpk(label);
    if (!key || placed.has(key)) continue;
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
  const spans = [...assessment.rewriteSpans].sort((a, b) => b.start - a.start);
  let next = text;
  for (const span of spans) {
    if (span.start < 0 || span.end > next.length || span.end <= span.start) continue;
    next = `${next.slice(0, span.start)}${"a provision that was not retrieved"}${next.slice(span.end)}`;
  }
  for (const span of assessment.stripSpans.sort((a, b) => b.start - a.start)) {
    const slice = next.slice(span.start, span.end);
    const stripped = slice.replace(/\s*\(referred to in[^)]*not retrieved\)/i, "");
    if (stripped !== slice) next = `${next.slice(0, span.start)}${stripped}${next.slice(span.end)}`;
  }
  return { text: next, removed: spans.length };
}

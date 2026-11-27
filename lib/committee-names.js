/**
 * Committee names taken from corpus headings and paths.
 * A side is named only when it matches one of these records.
 * Capitalisation is not a signal: comparison is case-folded and macron-folded.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { committeeNameRecords } from "./committee-names-data.js";

const LEFT_STOP = new Set([
  "the", "a", "an", "in", "to", "by", "from", "with", "or",
  "at", "into", "when", "if", "as", "not", "under", "after", "before", "during",
  "per", "than", "its", "their",
]);
const CONNECTOR = new Set(["and", "of", "on", "for"]);
const RIGHT_STOP = new Set([
  "may", "must", "shall", "can", "will", "is", "are", "was", "were", "be",
  "when", "if", "not", "under", "after", "before", "to", "by", "from",
]);
/** Determiners and class words. They are generic only when they are the whole phrase and not a corpus name. */
const GENERIC_WORD = new Set([
  "this", "any", "every", "each", "that", "these", "those", "other", "another",
  "relevant", "specialist", "parliamentary",
  "select", "standing", "joint", "special", "subject",
]);
/** Heading words that introduce a name ("Functions of …"). Not committee names. */
const HEADING_PREFIX = new Set([
  "function", "basis", "purpose", "determination", "membership", "meeting",
  "power", "proceeding", "establishment", "life", "chairperson", "opinion",
  "report", "referral", "arrangement", "instruction", "consideration",
  "presence", "motion", "naming", "interruption", "question", "time",
]);

const overlay = new AsyncLocalStorage();

export function foldCommitteeText(text) {
  return String(text ?? "").normalize("NFC").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function nameToken(word) {
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** Letters only, after Unicode normalisation, so a macron does not split a name. */
export function committeeWords(text) {
  return foldCommitteeText(text).match(/\p{L}+/gu) ?? [];
}

/**
 * The name phrase on both sides of "Committee".
 * "Committee on X" keeps X. "and" and commas do not end a multi-part name.
 */
export function extractCommitteeTokens(text) {
  const words = committeeWords(text);
  const tokens = [];
  for (let index = 0; index < words.length; index += 1) {
    if (words[index] !== "committee" && words[index] !== "committees") continue;
    const left = [];
    for (let prior = index - 1; prior >= 0; prior -= 1) {
      const word = words[prior];
      if (word === "committee" || word === "committees") break;
      if (CONNECTOR.has(word)) continue;
      if (LEFT_STOP.has(word)) break;
      left.unshift(nameToken(word));
    }
    const right = [];
    if (["on", "of", "for"].includes(words[index + 1] ?? "")) {
      let next = index + 2;
      while (["the", "a", "an"].includes(words[next] ?? "")) next += 1;
      while (words[next] && words[next] !== "committee" && words[next] !== "committees") {
        const word = words[next];
        if (word === "and") { next += 1; continue; }
        if (RIGHT_STOP.has(word) || LEFT_STOP.has(word)) break;
        right.push(nameToken(word));
        next += 1;
      }
    }
    tokens.push(...left, ...right);
  }
  return [...new Set(tokens)];
}

export function committeeTokenKey(tokens) {
  return tokens.join(" ");
}

function wholeHouse(tokens) {
  return tokens.includes("whole") && tokens.includes("house");
}

export function isGenericCommitteePhrase(tokens) {
  return tokens.length === 0 || tokens.every((token) => GENERIC_WORD.has(token));
}

/** A heading or path segment that is a committee name, not a sentence about one. */
export function nameShapedCommitteeText(text) {
  const words = committeeWords(text);
  const index = words.findIndex((word) => word === "committee" || word === "committees");
  if (index < 0) return false;
  const after = words.slice(index + 1);
  if (after.length === 0) return true;
  if (!["on", "of", "for"].includes(after[0] ?? "")) return false;
  return words.slice(0, index).every((word) => ["the", "a", "an"].includes(word));
}

function withoutHeadingPrefix(tokens) {
  const rest = [...tokens];
  while (rest.length > 0 && HEADING_PREFIX.has(rest[0])) rest.shift();
  return rest;
}

function compileRecord(record) {
  const tokens = Array.isArray(record?.tokens) && record.tokens.length > 0
    ? record.tokens.map((token) => nameToken(foldCommitteeText(token)))
    : extractCommitteeTokens(record?.name ?? record ?? "");
  if (tokens.length === 0 || isGenericCommitteePhrase(tokens) || wholeHouse(tokens)) return null;
  return {
    tokens,
    sectionId: String(record?.sectionId ?? ""),
    citationLabel: String(record?.citationLabel ?? ""),
    path: Array.isArray(record?.path) ? record.path.map((segment) => String(segment)) : [],
  };
}

function compileLabels(labels) {
  const records = [];
  const seen = new Set();
  for (const label of labels ?? []) {
    const record = compileRecord(typeof label === "string" ? { name: label, path: [label] } : label);
    if (!record) continue;
    const key = committeeTokenKey(record.tokens);
    if (seen.has(key)) continue;
    seen.add(key);
    records.push(record);
  }
  return records;
}

const committed = compileLabels(committeeNameRecords);

export function committeeRecords() {
  return overlay.getStore() ?? committed;
}

/** Test isolation. Production reads the generated corpus records. */
export function withCorpusCommitteeNames(labels, run) {
  return overlay.run(compileLabels(labels), run);
}

/**
 * One record per distinct name, with the corpus location of the shortest heading
 * that yields that name. Rows are section headings and path segments.
 */
export function committeeRecordsFromSections(rows) {
  const best = new Map();
  for (const row of rows ?? []) {
    const texts = [row.heading, ...(Array.isArray(row.path) ? row.path : [])];
    for (const text of texts) {
      if (!nameShapedCommitteeText(text)) continue;
      const tokens = withoutHeadingPrefix(extractCommitteeTokens(text));
      if (tokens.length === 0 || isGenericCommitteePhrase(tokens) || wholeHouse(tokens)) continue;
      const key = committeeTokenKey(tokens);
      const candidate = {
        tokens,
        sectionId: String(row.sectionId ?? row.id ?? ""),
        citationLabel: String(row.citationLabel ?? row.citation_label ?? ""),
        path: Array.isArray(row.path) ? row.path.map((segment) => String(segment)) : [],
        heading: String(text ?? ""),
      };
      const current = best.get(key);
      if (!current || candidate.heading.length < current.heading.length) best.set(key, candidate);
    }
  }
  return [...best.values()]
    .map(({ heading, ...record }) => record)
    .sort((left, right) => committeeTokenKey(left.tokens).localeCompare(committeeTokenKey(right.tokens)));
}

/** True when the shorter name is the same body: equal, or the leading or trailing part of the longer name. */
export function sameCommitteeTokens(left, right) {
  if (!left?.length || !right?.length) return false;
  if (left.length === right.length) return left.every((token, index) => token === right[index]);
  const [small, large] = left.length < right.length ? [left, right] : [right, left];
  const head = large.slice(0, small.length).every((token, index) => token === small[index]);
  const tail = large.slice(-small.length).every((token, index) => token === small[index]);
  return head || tail;
}

/**
 * Committee names taken from corpus headings and paths.
 * A side is named only when it matches one of these records.
 * Capitalisation is not a signal: comparison is case-folded and macron-folded.
 *
 * This module is on the page import graph. It must not import Node builtins.
 */

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

export function isCommitteeHeadingPrefix(word) {
  const value = String(word ?? "");
  const singular = value.length > 3 && value.endsWith("s") && !value.endsWith("ss") ? value.slice(0, -1) : value;
  return HEADING_PREFIX.has(value) || HEADING_PREFIX.has(singular);
}

function withoutHeadingPrefix(tokens) {
  const rest = [...tokens];
  while (rest.length > 0 && HEADING_PREFIX.has(rest[0])) rest.shift();
  return rest;
}

/**
 * Name tokens used both when the corpus list is built and when a side is matched.
 * A heading prefix is removed only when a name remains, so "Functions Committee"
 * is not erased into a generic phrase.
 */
export function committeeNameTokens(text) {
  const raw = extractCommitteeTokens(text);
  const stripped = withoutHeadingPrefix(raw);
  return stripped.length > 0 ? stripped : raw;
}

function compileRecord(record) {
  const tokens = Array.isArray(record?.tokens) && record.tokens.length > 0
    ? record.tokens.map((token) => nameToken(foldCommitteeText(token)))
    : extractCommitteeTokens(record?.name ?? record ?? "");
  if (tokens.length === 0 || isGenericCommitteePhrase(tokens) || wholeHouse(tokens)) return null;
  const compiled = {
    tokens,
    citationLabel: String(record?.citationLabel ?? ""),
    path: Array.isArray(record?.path) ? record.path.map((segment) => String(segment)) : [],
  };
  // Section row ids stay out of the client bundle. The generator may still carry one.
  if (record?.sectionId) compiled.sectionId = String(record.sectionId);
  return compiled;
}

export function compileCommitteeLabels(labels) {
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

const committed = compileCommitteeLabels(committeeNameRecords);
let readOverlay = () => null;

export function committeeRecords() {
  return readOverlay() ?? committed;
}

/** Installed only by the test overlay. The page bundle never loads that file. */
export function installCommitteeRecordReader(reader) {
  readOverlay = reader;
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
      const tokens = committeeNameTokens(text);
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

/**
 * A parsed name identifies a listed body when it equals that body, or is a
 * multi-word leading or trailing part of it. A longer name does not match a
 * shorter listing, and one shared word does not identify a longer listing.
 */
export function identifiesCorpusRecord(parsed, record) {
  if (!parsed?.length || !record?.length || parsed.length > record.length) return false;
  if (parsed.length === 1 && record.length > 1) return false;
  if (parsed.length === record.length) return parsed.every((token, index) => token === record[index]);
  const head = record.slice(0, parsed.length).every((token, index) => token === parsed[index]);
  const tail = record.slice(-parsed.length).every((token, index) => token === parsed[index]);
  return head || tail;
}

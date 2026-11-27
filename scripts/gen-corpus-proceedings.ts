/**
 * Rebuild lib/corpus-proceedings-data.js from standing-order headings.
 *
 *   npm run gen:corpus-proceedings
 *
 * DATABASE_URL must point at the corpus database. CI does not run this
 * against a database. It rebuilds the module from the public section
 * paths and checks the bytes, and checks the phrases against the
 * published derivation.
 * Does not print headings or connection strings.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Pool } from "pg";
import { verifiedDatabaseUrl } from "../lib/db-transport";
import { CLOSED_CLASS } from "../lib/closed-class.js";
import { foldPlural } from "../lib/plural-fold.js";
import {
  COMMITTEE_REFERENCE_SEED,
  FORUM_WORDS as FORUM_WORD_LIST,
  HEADING_PREFIX_SEED,
  PROCEEDING_HEAD_NOUNS,
} from "./generator-seeds";

export { PROCEEDING_HEAD_NOUNS };

const FORUM_WORDS = new Set<string>(FORUM_WORD_LIST);

export type HeadingRow = { heading?: string | null; path?: string[] | null; section_type?: string | null };

export function foldToken(word: string): string {
  return foldPlural(word);
}

function tokensOf(text: string): string[] {
  return (String(text ?? "").replace(/['’]s\b/gi, "").match(/\p{L}+/gu) ?? [])
    .map(foldToken)
    .filter((token) => token.length > 1);
}

function isPartHeading(segment: string): boolean {
  const value = String(segment ?? "").trim();
  if (!value) return false;
  if (/^chapter\b/i.test(value) || /^so\b/i.test(value)) return false;
  return true;
}

export function headingPlaces(rows: HeadingRow[]): { leaves: string[]; parts: string[] } {
  const leaves: string[] = [];
  const parts: string[] = [];
  for (const row of rows ?? []) {
    const path = Array.isArray(row.path) ? row.path.map((segment) => String(segment)) : [];
    const leaf = String(row.heading ?? path.at(-1) ?? "").trim();
    if (leaf) leaves.push(leaf);
    for (const segment of path.slice(0, -1)) {
      if (isPartHeading(segment)) parts.push(segment);
    }
  }
  return { leaves, parts };
}

type Candidate = { key: string; tokens: string[]; leaves: Set<string>; parts: number };

function candidatesFrom(text: string, into: Map<string, Candidate>, leafId: string | null): void {
  const tokens = tokensOf(text);
  for (const width of [2, 3]) {
    for (let index = 0; index + width <= tokens.length; index += 1) {
      const slice = tokens.slice(index, index + width);
      const head = slice[slice.length - 1] ?? "";
      const start = slice[0] ?? "";
      if (!PROCEEDING_HEAD_NOUNS.includes(head as typeof PROCEEDING_HEAD_NOUNS[number])) continue;
      if (CLOSED_CLASS.has(start) || CLOSED_CLASS.has(head)) continue;
      if (slice.some((token) => FORUM_WORDS.has(token))) continue;
      const key = slice.join(" ");
      const current = into.get(key) ?? { key, tokens: slice, leaves: new Set<string>(), parts: 0 };
      if (leafId) current.leaves.add(leafId);
      else current.parts += 1;
      into.set(key, current);
    }
  }
}

function isCommitteeForum(token: string): boolean {
  return FORUM_WORDS.has(token) && token.includes("committee");
}

function isHouseForum(token: string): boolean {
  return FORUM_WORDS.has(token) && !isCommitteeForum(token);
}

/**
 * The whole-house forum is the shortest ancestor slice that contains both
 * forum-word families already used by phrase extraction. The words come
 * from the pack, not from a separate selector list.
 */
export function deriveWholeHousePhrases(rows: HeadingRow[]): string[][] {
  const found = new Map<string, string[]>();
  for (const part of headingPlaces(rows).parts) {
    const tokens = tokensOf(part);
    if (!tokens.some(isCommitteeForum) || !tokens.some(isHouseForum)) continue;
    let best: string[] | null = null;
    for (let start = 0; start < tokens.length; start += 1) {
      for (let end = start + 2; end <= tokens.length; end += 1) {
        const slice = tokens.slice(start, end);
        if (!slice.some(isCommitteeForum) || !slice.some(isHouseForum)) continue;
        if (!best || slice.length < best.length) best = slice;
      }
    }
    if (!best) continue;
    found.set(best.join(" "), best);
  }
  const phrases = [...found.values()];
  const shortest = phrases.reduce((min, phrase) => Math.min(min, phrase.length), Number.POSITIVE_INFINITY);
  return phrases.filter((phrase) => phrase.length === shortest).sort((left, right) => left.join(" ").localeCompare(right.join(" ")));
}

export function deriveCorpusProceedings(rows: HeadingRow[]): {
  heads: string[];
  phrases: string[][];
  wholeHouse: string[][];
} {
  const places = headingPlaces(rows);
  const found = new Map<string, Candidate>();
  places.leaves.forEach((leaf, index) => candidatesFrom(leaf, found, `leaf-${index}:${leaf}`));
  for (const part of places.parts) candidatesFrom(part, found, null);
  let kept = [...found.values()].filter((item) => item.leaves.size >= 1 && item.leaves.size + item.parts >= 2);
  kept = kept.filter((item) => !kept.some((longer) => {
    if (longer.tokens.length <= item.tokens.length) return false;
    if (!longer.key.includes(item.key)) return false;
    if (longer.leaves.size !== item.leaves.size) return false;
    for (const leaf of item.leaves) if (!longer.leaves.has(leaf)) return false;
    return true;
  }));
  kept.sort((left, right) => left.key.localeCompare(right.key));
  return {
    heads: [...PROCEEDING_HEAD_NOUNS],
    phrases: kept.map((item) => item.tokens),
    wholeHouse: deriveWholeHousePhrases(rows),
  };
}

export function renderCorpusProceedingsModule(derived: {
  heads: string[];
  phrases: string[][];
  wholeHouse?: string[][];
}): string {
  const wholeHouse = derived.wholeHouse ?? [];
  return `/** Generated by npm run gen:corpus-proceedings. Do not edit by hand. */\nexport const corpusProceedingHeads = ${JSON.stringify(derived.heads, null, 2)};\n\nexport const corpusProceedingPhrases = ${JSON.stringify(derived.phrases, null, 2)};\n\nexport const corpusWholeHousePhrases = ${JSON.stringify(wholeHouse, null, 2)};\n`;
}

export function renderCommitteeClassModule(words: string[]): string {
  return `/** Generated by npm run gen:corpus-proceedings from structural headings ending in "committees". Do not edit by hand. */\nexport const committeeClassWords = ${JSON.stringify(words, null, 2)};\n`;
}

export function renderDomainVocabularyModule(): string {
  const lines = (values: readonly string[]) => JSON.stringify([...values], null, 2);
  return `/** Generated by npm run gen:corpus-proceedings from scripts/generator-seeds.ts. Do not edit by hand. */\nexport const generatedForumWords = ${lines(FORUM_WORD_LIST)};\n\nexport const headingPrefixes = ${lines(HEADING_PREFIX_SEED)};\n\nexport const committeeReferenceWords = ${lines(COMMITTEE_REFERENCE_SEED)};\n`;
}

function classTokens(text: string): string[] {
  return (String(text ?? "").replace(/['’]s\b/gi, "").match(/\p{L}+/gu) ?? [])
    .map((word) => word.toLowerCase())
    .filter((token) => token.length > 1);
}

/** Structural headings ending in "committees", minus any word used in a listed body name. */
export function deriveCommitteeClassWords(rows: HeadingRow[], listedNames: string[]): string[] {
  const found = new Set<string>();
  for (const row of rows ?? []) {
    const path = Array.isArray(row.path) ? row.path.map((segment) => String(segment)) : [];
    for (const segment of path.slice(0, -1)) {
      const tokens = classTokens(segment);
      if (tokens.at(-1) !== "committees") continue;
      const kept: string[] = [];
      for (let index = tokens.length - 2; index >= 0; index -= 1) {
        const word = tokens[index] ?? "";
        if (CLOSED_CLASS.has(word) || /^\d+$/.test(word)) break;
        kept.unshift(word);
      }
      for (const word of kept) found.add(word);
    }
  }
  const used = new Set<string>();
  for (const name of listedNames) {
    for (const token of classTokens(name)) {
      if (token !== "committee" && token !== "committees") used.add(token);
    }
  }
  return [...found].filter((word) => !used.has(word)).sort();
}

const PROCEEDING_SQL = `
  select s.heading, s.path
  from sections s
  join documents d on d.id = s.document_id
  where d.corpus = 'standing_orders'
    and s.section_type = 'standing_order'
`;

export async function readProceedingRows(connectionString: string): Promise<HeadingRow[]> {
  const pool = new Pool({
    connectionString: verifiedDatabaseUrl(connectionString, process.env.NODE_ENV || "development"),
  });
  try {
    const result = await pool.query(PROCEEDING_SQL);
    return result.rows.map((row: { heading: string | null; path: string[] }) => ({
      heading: row.heading,
      path: row.path,
    }));
  } finally {
    await pool.end();
  }
}

function modulePath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../lib/corpus-proceedings-data.js");
}

function classModulePath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../lib/committee-class-data.js");
}

function domainModulePath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../lib/domain-vocabulary-data.js");
}

export function listedBodyNames(records: Array<{ path?: string[] | null }>): string[] {
  return records.map((record) => {
    const path = Array.isArray(record.path) ? record.path : [];
    return path.length > 0 ? String(path[path.length - 1]) : "";
  }).filter((name) => name.length > 0);
}

function rowsFromPack(packPath: string): HeadingRow[] {
  const pack = JSON.parse(readFileSync(packPath, "utf8")) as { sections?: HeadingRow[] };
  return (pack.sections ?? []).filter((section) => section.section_type === "standing_order");
}

export const PINNED_WHOLE_HOUSE_PHRASE = "committee of the whole house";

function assertPinnedWholeHouse(phrases: string[][]): void {
  const got = phrases.map((phrase) => phrase.join(" "));
  if (got.length !== 1 || got[0] !== PINNED_WHOLE_HOUSE_PHRASE) {
    console.error("pinned pack must yield exactly one whole-house phrase");
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const packFlag = process.argv.indexOf("--pack");
  const { committeeNameRecords } = await import("../lib/committee-names-data.js");
  let rows: HeadingRow[];
  if (packFlag >= 0) {
    const packPath = process.argv[packFlag + 1];
    if (!packPath) throw new Error("--pack needs a file");
    rows = rowsFromPack(packPath);
  } else {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      console.error("DATABASE_URL is required.");
      process.exit(1);
    }
    rows = await readProceedingRows(connectionString);
  }
  const derived = deriveCorpusProceedings(rows);
  assertPinnedWholeHouse(derived.wholeHouse);
  const classes = deriveCommitteeClassWords(rows, listedBodyNames(committeeNameRecords));
  const proceedings = renderCorpusProceedingsModule(derived);
  const classModule = renderCommitteeClassModule(classes);
  const domainModule = renderDomainVocabularyModule();
  if (process.argv.includes("--check")) {
    const sameProceedings = readFileSync(modulePath(), "utf8") === proceedings;
    const sameClasses = readFileSync(classModulePath(), "utf8") === classModule;
    const sameDomain = readFileSync(domainModulePath(), "utf8") === domainModule;
    if (!sameProceedings || !sameClasses || !sameDomain) {
      console.error("generated modules do not match the fixture");
      process.exit(1);
    }
    console.log(`Checked ${derived.phrases.length} proceeding phrases and ${classes.length} class words.`);
    return;
  }
  writeFileSync(modulePath(), proceedings);
  writeFileSync(classModulePath(), classModule);
  writeFileSync(domainModulePath(), domainModule);
  console.log(`Wrote ${derived.phrases.length} proceeding phrases and ${classes.length} class words.`);
}

const invoked = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invoked) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "proceeding generation failed");
    process.exit(1);
  });
}

import { THE } from "../lib/closed-class.js";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PACK_BASENAME = "open_order_so2026_candidate_RECONCILED_v3.json";
export const PACK_SHA256 = "34771e4a6102b996fc0a9cfc5d3663e06d32cd62395af7d00702a42e0b6eb100";
const FOLD_LABEL = "NFD, strip combining, lowercase, [a-z0-9]+";

export type PackSection = {
  heading?: string | null;
  path?: string[] | null;
  content?: string | null;
  section_type?: string | null;
};

export function foldText(text: string): string[] {
  const decomposed = String(text ?? "").normalize("NFD").replace(/\p{M}/gu, "");
  return decomposed.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

export function jsonIndent0(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return `[\n${value.map((item) => jsonIndent0(item)).join(",\n")}\n]`;
  }
  const record = value as Record<string, unknown>;
  const lines = Object.keys(record).map((key) => `${JSON.stringify(key)}: ${jsonIndent0(record[key])}`);
  return `{\n${lines.join(",\n")}\n}`;
}

export function deriveVocabulary(sections: PackSection[]): string[] {
  const found = new Set<string>();
  for (const section of sections) {
    for (const token of foldText(section.heading ?? "")) found.add(token);
    for (const segment of section.path ?? []) {
      for (const token of foldText(segment)) found.add(token);
    }
    for (const token of foldText(section.content ?? "")) found.add(token);
  }
  return [...found].sort();
}

export function vocabularyDocument(sections: PackSection[], sourceSha256: string): Record<string, unknown> {
  return {
    source: PACK_BASENAME,
    sourceSha256,
    sections: sections.length,
    fields: ["heading", "path", "content"],
    fold: FOLD_LABEL,
    tokens: deriveVocabulary(sections),
  };
}

type Slot = { boundary: boolean; word: string; raw: string };

function isAlnum(char: string): boolean {
  return /\p{L}|\p{N}/u.test(char);
}

function isUpper(char: string): boolean {
  return char.toUpperCase() !== char.toLowerCase() && char === char.toUpperCase();
}

function isLower(char: string): boolean {
  return char.toUpperCase() !== char.toLowerCase() && char === char.toLowerCase();
}

function bodySlots(body: string): Slot[] {
  const pattern = /[A-Za-zĀ-ž’'0-9]+|[.;:!?\n()]/g;
  const slots: Slot[] = [];
  for (const token of body.match(pattern) ?? []) {
    const first = token[0] ?? "";
    if (!isAlnum(first)) {
      slots.push({ boundary: true, word: "", raw: token });
      continue;
    }
    const folded = foldText(token);
    if (folded.length === 0) slots.push({ boundary: true, word: "", raw: token });
    else slots.push({ boundary: false, word: folded[0] ?? "", raw: token });
  }
  return slots;
}

export function deriveReferents(sections: PackSection[]): {
  functionWords: string[];
  referentWords: string[];
  referentPhrases: string[];
} {
  const body = sections.map((section) => section.content ?? "").join("\n");
  const slots = bodySlots(body);
  const capMid = new Map<string, number>();
  const lower = new Map<string, number>();
  const counts = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  let seen = 0;
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    if (!slot || slot.boundary) continue;
    const prevRaw = index === 0 ? "." : (slots[index - 1]?.raw || ".");
    const first = slot.raw[0] ?? "";
    const prevFirst = prevRaw[0] ?? ".";
    if (isUpper(first) && isAlnum(prevFirst)) capMid.set(slot.word, (capMid.get(slot.word) ?? 0) + 1);
    else if (isLower(first)) lower.set(slot.word, (lower.get(slot.word) ?? 0) + 1);
    counts.set(slot.word, (counts.get(slot.word) ?? 0) + 1);
    if (!firstSeen.has(slot.word)) firstSeen.set(slot.word, seen);
    seen += 1;
  }
  const functionWords = [...counts.keys()].sort((left, right) => {
    const byCount = (counts.get(right) ?? 0) - (counts.get(left) ?? 0);
    if (byCount !== 0) return byCount;
    return (firstSeen.get(left) ?? 0) - (firstSeen.get(right) ?? 0);
  }).slice(0, 60);
  const func = new Set(functionWords);
  const headUse = new Map<string, number>();
  const occ = new Map<string, number>();
  const theCount = new Map<string, number>();
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    if (!slot || slot.boundary) continue;
    const next = slots[index + 1];
    if (!next || next.boundary || func.has(next.word)) headUse.set(slot.word, (headUse.get(slot.word) ?? 0) + 1);
  }
  for (const size of [1, 2, 3]) {
    for (let start = 0; start + size <= slots.length; start += 1) {
      const window = slots.slice(start, start + size);
      if (window.some((slot) => slot.boundary)) continue;
      const key = window.map((slot) => (slot.boundary ? "" : slot.word)).join(" ");
      occ.set(key, (occ.get(key) ?? 0) + 1);
      const before = start > 0 ? slots[start - 1] : undefined;
      if (before && !before.boundary && before.word === THE) theCount.set(key, (theCount.get(key) ?? 0) + 1);
    }
  }
  const referentWords = [...occ.keys()].filter((key) => {
    if (key.includes(" ") || key === THE || (occ.get(key) ?? 0) < 5) return false;
    const total = occ.get(key) ?? 0;
    const definite = (theCount.get(key) ?? 0) / total >= 0.5 && (headUse.get(key) ?? 0) / total >= 0.5;
    const caps = (capMid.get(key) ?? 0) + (lower.get(key) ?? 0);
    const capitalised = caps > 0 && (capMid.get(key) ?? 0) / caps >= 0.8;
    return definite || capitalised;
  }).sort();
  const referentPhrases = [...occ.keys()].filter((key) => {
    if (!key.includes(" ") || key.startsWith(`${THE} `) || (occ.get(key) ?? 0) < 5) return false;
    return (theCount.get(key) ?? 0) / (occ.get(key) ?? 1) >= 0.5;
  }).sort();
  return { functionWords, referentWords, referentPhrases };
}

export function referentDocument(sections: PackSection[], sourceSha256: string): Record<string, unknown> {
  const derived = deriveReferents(sections);
  return {
    source: PACK_BASENAME,
    sourceSha256,
    params: {
      functionWords: "60 most frequent body tokens",
      headUse: 0.5,
      minOccurrences: 5,
      definiteRatio: 0.5,
      capitalisedRatio: 0.8,
    },
    referentWords: derived.referentWords,
    referentPhrases: derived.referentPhrases,
  };
}

export function renderVocabularyModule(tokens: string[]): string {
  return `/** Generated from tests/fixtures/so-pack.json. Do not edit by hand. */\nexport const corpusVocabulary = ${JSON.stringify(tokens, null, 2)};\n`;
}

export function renderReferentModule(words: string[], phrases: string[], functionWords: string[]): string {
  return `/** Generated from tests/fixtures/so-pack.json. Do not edit by hand. */\nexport const corpusReferentWords = ${JSON.stringify(words, null, 2)};\n\nexport const corpusReferentPhrases = ${JSON.stringify(phrases, null, 2)};\n\nexport const corpusFunctionWords = ${JSON.stringify(functionWords, null, 2)};\n`;
}

export function loadPack(bytes: Buffer): { sections: PackSection[]; sha256: string } {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const parsed = JSON.parse(bytes.toString("utf8")) as { sections?: PackSection[] };
  return { sections: parsed.sections ?? [], sha256 };
}

function repoPath(name: string): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", name);
}

function main(): void {
  const bytes = readFileSync(repoPath("tests/fixtures/so-pack.json"));
  const { sections, sha256 } = loadPack(bytes);
  if (sha256 !== PACK_SHA256) throw new Error(`pack sha is ${sha256}`);
  const vocabulary = vocabularyDocument(sections, sha256);
  const referents = referentDocument(sections, sha256);
  const derived = deriveReferents(sections);
  writeFileSync(repoPath("lib/corpus-vocabulary-data.js"), renderVocabularyModule(vocabulary.tokens as string[]));
  writeFileSync(repoPath("lib/corpus-referents-data.js"), renderReferentModule(derived.referentWords, derived.referentPhrases, derived.functionWords));
  console.log(`vocabulary ${(vocabulary.tokens as string[]).length}; referents ${derived.referentWords.length}/${derived.referentPhrases.length}`);
}

const invoked = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invoked) main();

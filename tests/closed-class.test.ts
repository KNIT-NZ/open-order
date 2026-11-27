import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ARTICLES,
  ADVERBS,
  AUXILIARIES,
  CLOSED_CLASS,
  HER,
  CONJUNCTIONS,
  DETERMINERS,
  DEMONSTRATIVES,
  MODALS,
  NEGATION,
  PREPOSITIONS,
  PRONOUNS,
  QUANTIFIERS,
  WH_ADVERBS,
  isNamedNonContent,
} from "../lib/closed-class.js";

test("closed classes are complete and pinned", () => {
  const classes = [
    ARTICLES, DEMONSTRATIVES, DETERMINERS, QUANTIFIERS, PRONOUNS, AUXILIARIES,
    MODALS, NEGATION, WH_ADVERBS, ADVERBS, PREPOSITIONS, CONJUNCTIONS,
  ];
  const union = new Set(classes.flat());
  assert.equal(CLOSED_CLASS.size, union.size);
  for (const word of union) assert.equal(CLOSED_CLASS.has(word), true, word);
  for (const word of ["such", "another", "other", "what", "which", "whose", "whilst", "lest", "whereas", "whatever", "whichever"]) {
    assert.equal(CLOSED_CLASS.has(word), true, word);
  }
  assert.equal(isNamedNonContent("million"), true);
  assert.equal(isNamedNonContent("its"), true);
  assert.equal(isNamedNonContent("may"), false);
  assert.equal(HER, "her");
  for (const word of ["never", "there", "then", "only"]) {
    assert.equal(CLOSED_CLASS.has(word), true, word);
    assert.equal(isNamedNonContent(word), false, word);
  }
  assert.equal(CLOSED_CLASS.has("day"), false);
  assert.equal(CLOSED_CLASS.has("committee"), false);
});

test("the forum path has no separate closed-class lists", () => {
  const files = [
    "lib/procedural-mechanisms.js",
    "lib/committee-names.js",
    "scripts/gen-corpus-proceedings.ts",
  ];
  for (const file of files) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.equal(/\bconst STOP =/.test(source), false, file);
    assert.equal(/\bconst ACT_SKIP =/.test(source), false, file);
    assert.equal(/\bconst STOPWORDS =/.test(source), false, file);
    assert.equal(/\bconst CLASS_FUNCTION =/.test(source), false, file);
    assert.equal(/\bconst FUNCTION_WORD =/.test(source), false, file);
    assert.equal(/\bconst PROCEEDING_STOP =/.test(source), false, file);
  }
  const mechanisms = readFileSync(new URL("../lib/procedural-mechanisms.js", import.meta.url), "utf8");
  const named = mechanisms.slice(mechanisms.indexOf("function unlistedNamedCommittee"), mechanisms.indexOf("function settingNamesCommittee"));
  assert.equal(named.includes("GENERATED_FUNCTION"), false);
  const action = readFileSync(new URL("../lib/committee-names.js", import.meta.url), "utf8");
  const scan = action.slice(action.indexOf("export function committeeNameAction"), action.indexOf("export function extractCommitteeTokens"));
  assert.equal(scan.includes("GENERATED_FUNCTION"), false);
  const generator = readFileSync(new URL("../scripts/gen-corpus-proceedings.ts", import.meta.url), "utf8");
  const main = generator.slice(generator.indexOf("async function main"));
  assert.match(main, /assertPinnedWholeHouse\(derived\.wholeHouse, derived\.wholeHouseAliases\)/);
  assert.equal(main.includes("if (packFlag >= 0) assertPinnedWholeHouse"), false);
  assert.equal(generator.includes("generator-seeds"), true);
  assert.equal(mechanisms.includes("generator-seeds"), false);
  assert.equal(action.includes("generator-seeds"), false);
});

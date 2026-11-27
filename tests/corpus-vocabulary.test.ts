import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { committeeNameRecords } from "../lib/committee-names-data.js";
import { corpusVocabulary } from "../lib/corpus-vocabulary-data.js";
import { corpusReferentPhrases, corpusReferentWords } from "../lib/corpus-referents-data.js";
import { forumIdentityOutcome } from "../lib/procedural-mechanisms.js";
import { deriveCommitteeClassWords, listedBodyNames } from "../scripts/gen-corpus-proceedings";
import {
  PACK_SHA256,
  deriveReferents,
  jsonIndent0,
  loadPack,
  referentDocument,
  vocabularyDocument,
} from "../scripts/gen-corpus-vocabulary";

const packBytes = readFileSync(new URL("./fixtures/so-pack.json", import.meta.url));
const pack = loadPack(packBytes);

test("the pinned pack and the generated vocabulary and referents match the published bytes", () => {
  assert.equal(createHash("sha256").update(packBytes).digest("hex"), PACK_SHA256);
  assert.equal(pack.sha256, PACK_SHA256);
  assert.equal(pack.sections.length, 561);
  const vocabulary = jsonIndent0(vocabularyDocument(pack.sections, pack.sha256));
  const referents = jsonIndent0(referentDocument(pack.sections, pack.sha256));
  assert.equal(createHash("sha256").update(vocabulary).digest("hex"), "036a81e47ddf7b43c776f145a533f3ce69e481f2deabfe4c74f46b86b3ed5d14");
  assert.equal(createHash("sha256").update(referents).digest("hex"), "6a1d636528ea6fd5c019f30d9032ccd71dd5a26ec87082bb142ca7e8f7252040");
  assert.equal(vocabulary, readFileSync(new URL("./fixtures/corpus-vocab-v2.9.json", import.meta.url), "utf8"));
  assert.equal(referents, readFileSync(new URL("./fixtures/corpus-referents-v2.9.json", import.meta.url), "utf8"));
  const derived = deriveReferents(pack.sections);
  assert.equal(derived.referentWords.length, 115);
  assert.equal(derived.referentPhrases.length, 323);
  assert.deepEqual(derived.functionWords.slice(0, 3), ["the", "of", "a"]);
  assert.ok(derived.functionWords.includes("speaker"));
  assert.ok(derived.functionWords.includes("house"));
  assert.ok(derived.functionWords.includes("clerk"));
  assert.equal(derived.functionWords[59], "notice");
  const vocabularyJson = JSON.parse(vocabulary) as { tokens: string[] };
  const referentJson = JSON.parse(referents) as { referentWords: string[]; referentPhrases: string[] };
  assert.deepEqual([...corpusVocabulary], vocabularyJson.tokens);
  assert.deepEqual([...corpusReferentWords], referentJson.referentWords);
  assert.deepEqual([...corpusReferentPhrases], referentJson.referentPhrases);
});

test("class words from the pack use listed body names and regenerate the committed module", () => {
  const rows = pack.sections
    .filter((section) => section.section_type === "standing_order")
    .map((section) => ({ heading: section.heading, path: section.path }));
  const words = deriveCommitteeClassWords(rows, listedBodyNames(committeeNameRecords));
  assert.deepEqual(words, ["select", "subject"]);
  const synthetic = deriveCommitteeClassWords(
    [
      { heading: "Widget committee notes", path: ["Widget committees", "Widget committee notes"] },
      { heading: "Notes", path: ["Gadget widget committees", "Notes"] },
    ],
    ["Harbor Committee"],
  );
  assert.deepEqual(synthetic, ["gadget", "widget"]);
});

test("a made-up name matches none of the 445 standing-order paths that do not name it", () => {
  const sections = pack.sections.filter((section) => section.section_type === "standing_order");
  assert.equal(sections.length, 445);
  let matches = 0;
  for (const section of sections) {
    const path = Array.isArray(section.path) ? section.path.map((segment) => String(segment)) : [];
    const named = path.some((segment) => /\bzorvath\b/i.test(segment)) || /\bzorvath\b/i.test(String(section.heading ?? ""));
    if (named) continue;
    if (forumIdentityOutcome("the Zorvath", path.length > 0 ? path : [String(section.heading ?? "")]) === "match") matches += 1;
  }
  assert.equal(matches, 0);
});

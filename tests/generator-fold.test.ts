import assert from "node:assert/strict";
import test from "node:test";
import { CLOSED_CLASS } from "../lib/closed-class.js";
import { foldPlural } from "../lib/plural-fold.js";
import { deriveCorpusProceedings, deriveWholeHouseAliases } from "../scripts/gen-corpus-proceedings";

const FORUM = new Set(["committee", "committees", "house", "chamber"]);
const CANONICAL = [["committee", "of", "the", "whole", "house"]];

function debateRows(heading: string) {
  return [
    { heading, path: ["Part", heading] },
    { heading, path: ["Other", heading] },
  ];
}

test("generator checks closed-class words before plural folding", () => {
  for (const heading of ["this debate", "whereas debate"]) {
    const phrases = deriveCorpusProceedings(debateRows(heading)).phrases.map((phrase) => phrase.join(" "));
    assert.deepEqual(phrases, [], heading);
  }
  for (const word of CLOSED_CLASS) {
    const folded = foldPlural(word);
    const phrases = deriveCorpusProceedings(debateRows(`${word} debate`)).phrases;
    assert.deepEqual(phrases, [], word);
    const aliases = deriveWholeHouseAliases(
      [{ heading: `house ${word} committee`, path: ["Part", `house ${word} committee`] }],
      CANONICAL,
    );
    for (const alias of aliases) {
      for (const token of alias) {
        assert.ok(FORUM.has(token) || CLOSED_CLASS.has(token), `${word}: ${token}`);
      }
      if (folded !== word) assert.equal(alias.includes(folded), false, word);
    }
  }
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { forumIdentityOutcome } from "../lib/procedural-mechanisms.js";
import { deriveWholeHousePhrases, PINNED_WHOLE_HOUSE_PHRASE } from "../scripts/gen-corpus-proceedings";

test("a singular committee with a content word is a named body", () => {
  assert.equal(
    forumIdentityOutcome("the Pellam debate", ["WHOLE OF GOVERNMENT COMMITTEE", "SO 5", "Pellam debate"]),
    "uncertain",
  );
  assert.equal(
    forumIdentityOutcome("the Pellam debate", ["STANDING COMMITTEES", "SO 5", "Pellam debate"]),
    "match",
  );
  assert.equal(
    forumIdentityOutcome("the Pellam debate", ["SELECT COMMITTEES", "SO 5", "Pellam debate"]),
    "match",
  );
});

test("a whole-house setting under a bare shorter heading is qualified", () => {
  assert.equal(
    forumIdentityOutcome("Committee of the whole House", ["COMMITTEE OF THE WHOLE", "SO 5", "Committee of the whole House"]),
    "uncertain",
  );
});

test("a whole-house setting under a different listed committee is withheld", () => {
  assert.equal(
    forumIdentityOutcome("Committee of the whole House", ["BUSINESS COMMITTEE", "SO 5", "Committee of the whole House"]),
    "reject",
  );
});

test("a whole-house setting under a generic plural heading matches", () => {
  assert.equal(
    forumIdentityOutcome("Committee of the whole House", ["SELECT COMMITTEES", "SO 5", "Committee of the whole House"]),
    "match",
  );
});

test("the pinned pack yields exactly one whole-house phrase", () => {
  const pack = JSON.parse(readFileSync(new URL("./fixtures/so-pack.json", import.meta.url), "utf8")) as {
    sections: Array<{ section_type?: string; heading?: string; path?: string[] }>;
  };
  const rows = pack.sections.filter((section) => section.section_type === "standing_order");
  const phrases = deriveWholeHousePhrases(rows).map((phrase) => phrase.join(" "));
  assert.deepEqual(phrases, [PINNED_WHOLE_HOUSE_PHRASE]);
});

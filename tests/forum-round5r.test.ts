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

test("a corpus noun makes a singular committee a named body", () => {
  assert.equal(
    forumIdentityOutcome("the Merrow debate", ["Chapter 4", "DAY COMMITTEE", "SO 5", "Merrow debate"]),
    "uncertain",
  );
  assert.equal(
    forumIdentityOutcome("Committee of the whole House", ["DAY COMMITTEE", "SO 5", "Committee of the whole House"]),
    "uncertain",
  );
  assert.equal(
    forumIdentityOutcome("a committee", ["Chapter 4", "SPEAKER COMMITTEE", "SO 5", "Meetings"]),
    "uncertain",
  );
  assert.equal(
    forumIdentityOutcome("the Merrow debate", ["Chapter 4", "HEARTHLANE COMMITTEES", "SO 5", "Merrow debate"]),
    "match",
  );
});

test("a class word does not end a real committee name", () => {
  assert.equal(
    forumIdentityOutcome("the Merrow debate", ["Chapter 4", "HEARTHLANE SELECT COMMITTEE", "SO 5", "Merrow debate"]),
    "uncertain",
  );
  assert.equal(
    forumIdentityOutcome("Committee of the whole House", ["HEARTHLANE SELECT COMMITTEE", "SO 5", "Committee of the whole House"]),
    "uncertain",
  );
  assert.equal(
    forumIdentityOutcome("Hearthlane Select Committee", ["Select committees", "Marrowfen Select Committee"]),
    "uncertain",
  );
});

test("a singular class heading with a topic tail is named", () => {
  assert.equal(
    forumIdentityOutcome("the Merrow debate", ["Chapter 4", "SELECT COMMITTEE ON THE MEASURE", "SO 5", "Merrow debate"]),
    "uncertain",
  );
  assert.equal(
    forumIdentityOutcome("a committee", ["Chapter 4", "SELECT COMMITTEE ON THE MEASURE", "SO 5", "Meetings"]),
    "uncertain",
  );
  assert.equal(
    forumIdentityOutcome("the committee", ["Chapter 5", "SO 9", "Select committees on the measure"]),
    "match",
  );
});

test("a plural class heading with a name word stays generic", () => {
  assert.equal(
    forumIdentityOutcome("the Merrow debate", ["Chapter 4", "MERRON SELECT COMMITTEES", "SO 5", "Merrow debate"]),
    "match",
  );
  assert.equal(
    forumIdentityOutcome("the Merrow debate", ["Chapter 4", "MERRON SUBJECT COMMITTEES", "SO 5", "Merrow debate"]),
    "match",
  );
  assert.equal(
    forumIdentityOutcome("a committee", ["Chapter 4", "MERRON SELECT COMMITTEES", "SO 5", "Meetings"]),
    "match",
  );
  assert.equal(
    forumIdentityOutcome("Committee of the whole House", ["MERRON SELECT COMMITTEES", "SO 5", "Committee of the whole House"]),
    "match",
  );
  assert.equal(
    forumIdentityOutcome("the Merrow debate", ["Chapter 4", "MERRON SELECT COMMITTEE", "SO 5", "Merrow debate"]),
    "uncertain",
  );
});

test("a reference word does not name a committee", () => {
  for (const heading of ["RELEVANT COMMITTEE", "SAME COMMITTEE", "SIMILAR COMMITTEE"]) {
    assert.equal(
      forumIdentityOutcome("the Merrow debate", ["Chapter 4", heading, "SO 5", "Merrow debate"]),
      "match",
      heading,
    );
    assert.equal(
      forumIdentityOutcome("Committee of the whole House", [heading, "SO 5", "Committee of the whole House"]),
      "match",
      heading,
    );
  }
});

test("a word after committee is not a name unless of or on introduces it", () => {
  assert.equal(
    forumIdentityOutcome("the Merrow debate", ["Chapter 4", "SELECT COMMITTEE MINUTES", "SO 5", "Merrow debate"]),
    "match",
  );
  assert.equal(
    forumIdentityOutcome("a committee", ["Chapter 4", "SUBJECT COMMITTEE MINUTES", "SO 5", "Meetings"]),
    "match",
  );
  assert.equal(
    forumIdentityOutcome("the Merrow debate", ["Chapter 4", "SELECT COMMITTEE ON THE MINUTES", "SO 5", "Merrow debate"]),
    "uncertain",
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

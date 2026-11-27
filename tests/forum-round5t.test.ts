import assert from "node:assert/strict";
import test from "node:test";
import { forumIdentityOutcome } from "../lib/procedural-mechanisms.js";
import { corpusProceedingHeads } from "../lib/corpus-proceedings-data.js";
import { headingPrefixes } from "../lib/domain-vocabulary-data.js";

test("a generic setting under a named class committee is qualified", () => {
  assert.equal(
    forumIdentityOutcome("a committee", ["Select committees", "Merron Select Committee"]),
    "uncertain",
  );
  assert.equal(
    forumIdentityOutcome("a subject committee", ["Subject committees", "Merron Subject Committee"]),
    "uncertain",
  );
  assert.equal(
    forumIdentityOutcome("a committee", ["Select committees", "Merron Committee"]),
    "uncertain",
  );
});

test("a house word does not turn a named committee into the House", () => {
  assert.equal(
    forumIdentityOutcome("a committee", ["Chapter 4", "HOUSE LEDGER COMMITTEE", "SO 5", "Meetings"]),
    "uncertain",
  );
  assert.equal(
    forumIdentityOutcome("a committee", ["Chapter 4", "HOUSE COMMITTEE", "SO 5", "Meetings"]),
    "uncertain",
  );
  assert.equal(
    forumIdentityOutcome("House Committee", ["HOUSE COMMITTEE"]),
    "match",
  );
});

test("an unlisted committee matches its own heading", () => {
  assert.equal(forumIdentityOutcome("Quill Committee", ["QUILL COMMITTEE"]), "match");
  assert.equal(forumIdentityOutcome("Quill Committee", ["Chapter 4", "QUILL COMMITTEE", "SO 5", "Meetings"]), "match");
  assert.equal(forumIdentityOutcome("Quill Committee", ["Chapter 4", "MERRON COMMITTEE"]), "uncertain");
});

test("every emitted name seed before a class word names the committee", () => {
  const seeds = [...new Set([...corpusProceedingHeads, ...headingPrefixes])];
  assert.ok(seeds.length > 8);
  for (const seed of seeds) {
    const heading = `${seed.toUpperCase()} SELECT COMMITTEE`;
    const label = `${seed[0].toUpperCase()}${seed.slice(1)} Select Committee`;
    assert.equal(
      forumIdentityOutcome("a committee", ["Chapter 4", heading, "SO 5", "Meetings"]),
      "uncertain",
      heading,
    );
    assert.equal(
      forumIdentityOutcome(label, ["Chapter 4", heading, "SO 5", "Meetings"]),
      "match",
      label,
    );
  }
  assert.equal(
    forumIdentityOutcome("a committee", ["Chapter 4", "REPORT OF SELECT COMMITTEE", "SO 5", "Meetings"]),
    "match",
  );
  assert.equal(forumIdentityOutcome("a committee", ["HER COMMITTEE", "SO 5", "Meetings"]), "match");
  assert.equal(forumIdentityOutcome("a committee", ["HER SELECT COMMITTEE"]), "match");
});

test("a lone prefix word before a class word is the committee name", () => {
  assert.equal(
    forumIdentityOutcome("the committee", ["Question Subject Committee"]),
    "uncertain",
  );
  assert.equal(
    forumIdentityOutcome("the committee", ["Time Select Committee"]),
    "uncertain",
  );
});

test("house in committee is the whole-house forum", () => {
  const leaf = ["Chapter 2", "Sittings", "SO 9", "Pause while House in committee"];
  assert.equal(forumIdentityOutcome("Committee of the whole House", leaf), "match");
  assert.equal(forumIdentityOutcome("Business Committee", leaf), "reject");
  assert.equal(forumIdentityOutcome("Quill Committee", leaf), "reject");
  assert.equal(
    forumIdentityOutcome("Business Committee", ["HOUSE IN COMMITTEE", "SO 5", "Meetings"]),
    "uncertain",
  );
  assert.equal(
    forumIdentityOutcome("the House in committee", ["Chapter 2", "Sittings", "SO 9", "Committee of the whole House"]),
    "match",
  );
});

test("a possessive determiner does not name a committee", () => {
  for (const heading of ["ITS COMMITTEE", "THEIR COMMITTEE"]) {
    assert.equal(
      forumIdentityOutcome("the Merrow debate", ["Chapter 4", heading, "SO 5", "Merrow debate"]),
      "match",
      heading,
    );
  }
  assert.equal(
    forumIdentityOutcome("the Merrow debate", ["Chapter 4", "WE COMMITTEE", "SO 5", "Merrow debate"]),
    "uncertain",
  );
});

test("a modal names a committee and a numeral does not", () => {
  for (const heading of ["MAY COMMITTEE", "WILL COMMITTEE"]) {
    assert.equal(
      forumIdentityOutcome("the Merrow debate", ["Chapter 4", heading, "SO 5", "Merrow debate"]),
      "uncertain",
      heading,
    );
  }
  assert.equal(
    forumIdentityOutcome("the Merrow debate", ["Chapter 4", "ONE COMMITTEE", "SO 5", "Merrow debate"]),
    "match",
  );
});

test("a for-tail names the committee", () => {
  assert.equal(
    forumIdentityOutcome("the Merrow debate", ["Chapter 4", "COMMITTEE FOR MERRON", "SO 5", "Merrow debate"]),
    "uncertain",
  );
  assert.equal(
    forumIdentityOutcome("a committee", ["Chapter 4", "SELECT COMMITTEE FOR THE MINUTES", "SO 5", "Meetings"]),
    "uncertain",
  );
});

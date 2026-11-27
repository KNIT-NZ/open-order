import assert from "node:assert/strict";
import test from "node:test";
import { forumIdentityOutcome } from "../lib/procedural-mechanisms.js";

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
  assert.equal(forumIdentityOutcome("Quill Committee", ["Chapter 4", "QUILL COMMITTEE", "SO 5", "Quill Committee"]), "match");
  assert.equal(forumIdentityOutcome("Quill Committee", ["Chapter 4", "MERRON COMMITTEE"]), "uncertain");
});

test("house in committee is the whole-house forum", () => {
  const leaf = ["Chapter 2", "Sittings", "SO 9", "Pause while House in committee"];
  assert.equal(forumIdentityOutcome("Committee of the whole House", leaf), "match");
  assert.equal(forumIdentityOutcome("Business Committee", leaf), "reject");
  assert.equal(forumIdentityOutcome("Quill Committee", leaf), "uncertain");
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

import assert from "node:assert/strict";
import test from "node:test";
import { withCorpusCommitteeNames } from "../lib/committee-names-context";
import { forumIdentityOutcome } from "../lib/procedural-mechanisms";
import { deriveCommitteeClassWords } from "../scripts/gen-corpus-proceedings";

const NAMES = ["Vellum Affairs Committee", "Cinder Review Committee", "Mossglass Committee"];

test("exact affairs order matches, and a plural or a short form does not", () => {
  withCorpusCommitteeNames(NAMES, () => {
    assert.equal(forumIdentityOutcome("Committee on Vellum Affairs", ["Vellum Affairs Committee"]), "match");
    assert.equal(forumIdentityOutcome("Committee on Vellums", ["Vellum Affairs Committee"]), "uncertain");
    assert.equal(forumIdentityOutcome("the Vellum Committee", ["Vellum Affairs Committee"]), "uncertain");
    assert.equal(forumIdentityOutcome("the Vellum Committee", ["Cinder Review Committee"]), "uncertain");
    assert.equal(forumIdentityOutcome("Vellum Committee", ["Mossglass Committee"]), "uncertain");
    assert.equal(forumIdentityOutcome("a select committee", ["Cinder Review Committee"]), "uncertain");
    assert.equal(forumIdentityOutcome("a select committee", ["Procedure in committees"]), "match");
    assert.equal(forumIdentityOutcome("Committee on Vellum Affairs", ["Cinder Review Committee"]), "reject");
    assert.equal(forumIdentityOutcome("Vellums Affairs Committee", ["Vellum Affairs Committee"]), "uncertain");
    assert.equal(forumIdentityOutcome("the responsible committee", ["Mossglass Committee"]), "uncertain");
    assert.equal(forumIdentityOutcome("the responsible committee", ["Procedure in committees"]), "match");
  });
});

test("a leaf-equal classless setting is capped only by an identity signal", () => {
  withCorpusCommitteeNames(["Mossglass Committee"], () => {
    assert.equal(forumIdentityOutcome("the Cindervale", ["Chapter 4", "SECONDER", "Cindervale"]), "match");
    assert.equal(forumIdentityOutcome("the Cindervale", ["SECOND READING", "SO 5", "Cindervale"]), "uncertain");
    assert.equal(forumIdentityOutcome("the Cindervale", ["MOSS COMMITTEE", "SO 5", "Cindervale"]), "uncertain");
    assert.equal(forumIdentityOutcome("the Cindervale", ["Select Committees", "SO 5", "Cindervale"]), "uncertain");
    assert.equal(forumIdentityOutcome("the Cindervale", ["CINDERVALE AND MOSSGLASS", "SO 5", "Cindervale"]), "match");
    assert.equal(forumIdentityOutcome("Cinder drills", ["Chapter 9", "Cinder drills"]), "match");
  });
});

test("a plural committee head is unlisted, and a generic name passes a generic leaf", () => {
  withCorpusCommitteeNames(["Vellum Review Committee", "Mossglass Committee"], () => {
    assert.equal(forumIdentityOutcome("Vellum Review Committees", ["Vellum Review Committee"]), "uncertain");
    assert.equal(forumIdentityOutcome("Vellum Review Committees", ["Mossglass Committee"]), "uncertain");
    assert.equal(forumIdentityOutcome("the committee", ["Chapter 9", "Select committees", "Reports of select committees"]), "match");
    assert.equal(forumIdentityOutcome("a committee", ["HARBOUR COMMITTEE", "Meetings"]), "uncertain");
    assert.equal(forumIdentityOutcome("a committee", ["Select committees", "Meetings"]), "match");
    assert.equal(forumIdentityOutcome("the Brindlemoors", ["BRINDLEMOOR AND QUARRYSIDE", "Brindlemoors"]), "match");
  });
});

test("a class word used in a listed name is no longer generic", () => {
  const rows = [{ heading: "Rule", path: ["Chapter 4", "Select committees", "SO 1", "Rule"] }];
  assert.deepEqual(deriveCommitteeClassWords(rows, []), ["select"]);
  assert.deepEqual(deriveCommitteeClassWords(rows, ["Select Rules Committee"]), []);
});

import assert from "node:assert/strict";
import test from "node:test";
import { withCorpusCommitteeNames } from "../lib/committee-names-context.js";
import { forumIdentityOutcome } from "../lib/procedural-mechanisms.js";

test("a plural or reordered descriptive word qualifies, and the same form stays supported", () => {
  assert.equal(forumIdentityOutcome("committee policy", ["Committee policies"]), "uncertain");
  assert.equal(forumIdentityOutcome("committee party", ["Committee parties"]), "uncertain");
  assert.equal(forumIdentityOutcome("committee delivery", ["Deliveries of committees"]), "uncertain");
  assert.equal(forumIdentityOutcome("committee notice", ["Committee notices"]), "uncertain");
  assert.equal(forumIdentityOutcome("committee witness", ["Committee witnesses"]), "uncertain");
  assert.equal(forumIdentityOutcome("committee summary", ["Committee summaries"]), "uncertain");
  assert.equal(forumIdentityOutcome("committee hearing", ["Committee hearings"]), "uncertain");
  assert.equal(forumIdentityOutcome("committee policy", ["Committee policy"]), "match");
});

test("a class word does not drop the rest of a committee name", () => {
  withCorpusCommitteeNames(["Select Tarnwick Committee", "Subject Bramble Committee", "Bramble Review Committee"], () => {
    assert.equal(
      forumIdentityOutcome("Tarnwick Committee", ["Functions of Select Tarnwick Committee"]),
      "uncertain",
    );
    assert.equal(
      forumIdentityOutcome("the tarnwick committee", ["Functions of Select Tarnwick Committee"]),
      "uncertain",
    );
    assert.equal(
      forumIdentityOutcome("Select Tarnwick Committee", ["SELECT TARNWICK COMMITTEE", "SO 5", "Time limits"]),
      "match",
    );
    assert.equal(
      forumIdentityOutcome("Subject Bramble Committee", ["SUBJECT BRAMBLE COMMITTEE", "SO 5", "Meetings"]),
      "match",
    );
    assert.equal(
      forumIdentityOutcome("Select Tarnwick Committee", ["Functions of Bramble Review Committee"]),
      "reject",
    );
    assert.equal(
      forumIdentityOutcome("Select Tarnwick Committee", ["BRAMBLE REVIEW COMMITTEE", "SO 5", "Time limits"]),
      "reject",
    );
  });
});

test("a named committee that merely contains whole is not the whole-house forum", () => {
  assert.equal(
    forumIdentityOutcome("Withdrawal of motion", ["WHOLE OF GOVERNMENT COMMITTEE", "SO 5", "Withdrawal of motion"]),
    "uncertain",
  );
  assert.equal(
    forumIdentityOutcome("Committee of the whole House", ["WHOLE OF GOVERNMENT COMMITTEE", "SO 5", "Committee of the whole House"]),
    "uncertain",
  );
  assert.equal(
    forumIdentityOutcome("Debate in committee of the whole House", ["WHOLE OF GOVERNMENT COMMITTEE", "SO 5", "Debate in committee of the whole House"]),
    "uncertain",
  );
  assert.equal(
    forumIdentityOutcome("Debate in committee of the whole House", ["COMMITTEES OF THE WHOLE HOUSE", "SO 9", "Debate in committee of the whole House"]),
    "match",
  );
});

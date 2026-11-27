import assert from "node:assert/strict";
import test from "node:test";
import { committeeRecords } from "../lib/committee-names.js";
import { forumIdentityOutcome } from "../lib/procedural-mechanisms.js";

test("repeated-head and caption ancestors do not cap, and a name word does", () => {
  assert.equal(
    forumIdentityOutcome("Closure of the Tarn debate", ["Time limits for speeches and debates", "SO 950", "Closure of the Tarn debate"]),
    "match",
  );
  assert.equal(
    forumIdentityOutcome("Lapse of amendment", ["RULES FOR AMENDMENTS", "SO 951", "Lapse of amendment"]),
    "match",
  );
  assert.equal(
    forumIdentityOutcome("Adjournment of debate", ["RULES OF DEBATE", "SO 952", "Adjournment of debate"]),
    "match",
  );
  assert.equal(
    forumIdentityOutcome("the Wraxholt amendment", ["Chapter 3", "RULES FOR AMENDMENTS", "SO 5", "Wraxholt amendment"]),
    "match",
  );
  assert.equal(
    forumIdentityOutcome("the Wraxholt amendment", ["Chapter 3", "TECHNICAL AMENDMENTS", "SO 5", "Wraxholt amendment"]),
    "match",
  );
  assert.equal(
    forumIdentityOutcome("the Wraxholt debate", ["Appendix A", "Time limits for speeches and debates", "Wraxholt debate"]),
    "match",
  );
  assert.equal(
    forumIdentityOutcome("the Wraxholt amendment", ["Chapter 3", "SALLOWFERN AMENDMENTS", "SO 5", "Wraxholt amendment"]),
    "uncertain",
  );
});

test("a whole-house ancestor caps only when the setting does not name that proceeding", () => {
  assert.equal(
    forumIdentityOutcome("Debate in committee of the whole House", ["COMMITTEES OF THE WHOLE HOUSE", "SO 953", "Debate in committee of the whole House"]),
    "match",
  );
  assert.equal(
    forumIdentityOutcome("the Tarn debate", ["Deliberation of the committee as a whole", "SO 9", "Tarn debate"]),
    "match",
  );
  assert.equal(
    forumIdentityOutcome("Motion to report progress", ["COMMITTEES OF THE WHOLE HOUSE", "SO 182", "Motion to report progress"]),
    "uncertain",
  );
  assert.equal(
    forumIdentityOutcome("the House goes into committee", ["Chapter 3", "COMMITTEES OF THE WHOLE HOUSE", "SO 5", "House resolves into committee"]),
    "uncertain",
  );
});

test("a different leaf proceeding is qualified before an equal-leaf or name-bearing return", () => {
  assert.equal(forumIdentityOutcome("Seating arrangements", ["Seating arrangements for the debate"]), "uncertain");
  assert.equal(forumIdentityOutcome("the Pellingrove", ["Chapter 3", "SO 5", "Pellingrove amendment"]), "uncertain");
  assert.equal(forumIdentityOutcome("the Tarnwick motion", ["Tarnwick motion"]), "match");
});

test("a headed setting under a named unlisted committee is qualified", () => {
  assert.equal(
    forumIdentityOutcome("the Caddermere debate", ["Chapter 4", "SALLOWFERN COMMITTEE", "SO 5", "Caddermere debate"]),
    "uncertain",
  );
});

test("of stops a committee name; a listed reorder matches and an unlisted one does not", () => {
  assert.equal(forumIdentityOutcome("Membership of committees", ["Membership of committees"]), "match");
  assert.equal(forumIdentityOutcome("Proceedings of committees", ["Proceedings of committees"]), "match");
  assert.equal(forumIdentityOutcome("the Quillon Committee", ["Committee of Quillon"]), "uncertain");
  assert.equal(forumIdentityOutcome("the Quillon Committee", ["Quillon Committee"]), "match");
  for (const record of committeeRecords()) {
    const heading = [...(record.path ?? [])].reverse().find((segment) => /\bcommittees?\b/i.test(segment));
    if (!heading) throw new Error("committee record has no committee heading");
    assert.equal(forumIdentityOutcome(heading, [heading]), "match", heading);
  }
  assert.equal(forumIdentityOutcome("Business Committee", ["Committee of Business"]), "match");
  assert.equal(forumIdentityOutcome("Business Committee", ["Committee of the Business"]), "match");
  assert.equal(forumIdentityOutcome("Privileges Committee", ["Committee of Privileges"]), "match");
  assert.equal(forumIdentityOutcome("Privileges Committee", ["Committee of the Privileges"]), "match");
});

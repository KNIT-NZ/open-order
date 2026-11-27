import assert from "node:assert/strict";
import test from "node:test";
import { forumIdentityOutcome } from "../lib/procedural-mechanisms.js";

test("a combined heading is split before the name test, and a referent is not stripped", () => {
  assert.equal(
    forumIdentityOutcome("the Tarnwick", ["Proceedings", "TARNWICK AND HOLLINFORD", "SO 5", "Tarnwick"]),
    "match",
  );
  assert.equal(
    forumIdentityOutcome("the Cindervale", ["CINDERVALE AND MOSSGLASS", "SO 5", "Cindervale"]),
    "match",
  );
  assert.equal(forumIdentityOutcome("the Gloriana", ["Gloriana Speaker"]), "uncertain");
  assert.equal(forumIdentityOutcome("the Caddow", ["Chapter 2", "SO 7", "Caddow building"]), "match");
  assert.equal(forumIdentityOutcome("the Orrin", ["Chapter 2", "SO 7", "Orrin opening"]), "uncertain");
  assert.equal(forumIdentityOutcome("the state", ["Chapter 2", "STATEMENTS", "SO 7", "General rules"]), "uncertain");
  assert.equal(forumIdentityOutcome("the member", ["Chapter 2", "SO 7", "Membership"]), "uncertain");
  assert.equal(forumIdentityOutcome("the ballot", ["Chapter 2", "SO 7", "Clerk"]), "uncertain");
  assert.equal(forumIdentityOutcome("the Tarnwick", ["TARNWICK AND TARNWICKS", "Tarnwick"]), "match");
  assert.equal(forumIdentityOutcome("the Sandor", ["SANDOR"]), "match");
  assert.equal(forumIdentityOutcome("the Anderson", ["ANDERSON"]), "match");
  assert.equal(forumIdentityOutcome("the Quendle", ["QUENDLE&HARROWBY", "Quendle"]), "match");
  assert.equal(forumIdentityOutcome("the Quendle", ["Quendle order paper"]), "uncertain");
  assert.equal(forumIdentityOutcome("the Quendle order paper", ["Quendle order paper"]), "match");
  assert.equal(forumIdentityOutcome("the Brisault", ["Brisault Speaker"]), "uncertain");
  assert.equal(forumIdentityOutcome("the Quendle", ["QUENDLE OPENING AND HARROWBY", "Quendle"]), "uncertain");
  assert.equal(forumIdentityOutcome("the chair", ["Chapter 4", "Select committees", "SO 9", "Time limits"]), "uncertain");
  assert.equal(forumIdentityOutcome("the chair", ["Committee of the whole House", "SO 9", "Time limits"]), "uncertain");
  assert.equal(forumIdentityOutcome("the chair", ["Chapter 5", "THIRD READING", "SO 9", "Time limits"]), "uncertain");
  assert.equal(forumIdentityOutcome("the Oskendale", ["Chapter 4", "Select committees", "SO 9", "Oskendale member"]), "uncertain");
  assert.equal(forumIdentityOutcome("the Quorvane debate", ["Chapter 3", "QUORVANE", "SO 5", "Quorvane debate"]), "match");
  assert.equal(forumIdentityOutcome("the Kelvara debate", ["Chapter 3", "ORMSBY", "SO 5", "Kelvara debate"]), "uncertain");
  assert.equal(forumIdentityOutcome("a select committee", ["Chapter 5", "SO 9", "Transfer to select committee"]), "match");
  assert.equal(forumIdentityOutcome("a select committee", ["Motion to omit select committee consideration of bill under urgency"]), "match");
  assert.equal(forumIdentityOutcome("the relevant committee", ["Transfer of papers to select committee"]), "match");
  assert.equal(forumIdentityOutcome("the clerk", ["Clerk's roster"]), "uncertain");
  assert.equal(forumIdentityOutcome("a note", ["Notes of sittings"]), "uncertain");
  assert.equal(forumIdentityOutcome("the clerk", ["Clerk of the House"]), "uncertain");
  assert.equal(forumIdentityOutcome("the second", ["Ormond rules"]), "uncertain");
  assert.equal(forumIdentityOutcome("the chair", ["CHAIRPERSONS", "The chair"]), "match");
  assert.equal(forumIdentityOutcome("the division", ["Chapter 4", "SO 5", "Hollin division"]), "uncertain");
  assert.equal(forumIdentityOutcome("the ballot", ["Chapter 2", "SO 7", "Ballots"]), "uncertain");
  assert.equal(forumIdentityOutcome("the clerk", ["Chapter 2", "SO 7", "Clerk papers"]), "match");
  assert.equal(forumIdentityOutcome("the Velloran", ["Chapter 2", "SO 7", "Velloran and Dunmarrow"]), "match");
  assert.equal(forumIdentityOutcome("the Velloran", ["Chapter 2", "SO 7", "Velloran & Dunmarrow"]), "match");
  assert.equal(forumIdentityOutcome("the Velloran", ["Chapter 2", "SO 7", "Velloran, Dunmarrow"]), "match");
  assert.equal(forumIdentityOutcome("Conclusion of debate", ["Chapter 5", "Legislative procedures", "SECOND READING", "SO 306", "Conclusion of debate"]), "uncertain");
  assert.equal(forumIdentityOutcome("the Wraxholt debate", ["Chapter 5", "SECOND READING", "Wraxholt debate"]), "uncertain");
  assert.equal(forumIdentityOutcome("debate", ["Chapter 7", "URGENT DEBATE", "SO 400", "Announcement and debate"]), "uncertain");
  assert.equal(forumIdentityOutcome("Motion to report progress", ["Chapter 3", "COMMITTEES OF THE WHOLE HOUSE", "SO 182", "Motion to report progress"]), "uncertain");
  assert.equal(forumIdentityOutcome("Bills set down for first reading", ["Chapter 5", "FIRST READING", "SO 293", "Bills set down for first reading"]), "match");
  assert.equal(forumIdentityOutcome("General debate each Wednesday", ["Chapter 7", "GENERAL DEBATE", "SO 402", "General debate each Wednesday"]), "match");
  assert.equal(forumIdentityOutcome("the member", ["Member who has moved amendment may not move further amendment"]), "uncertain");
  assert.equal(forumIdentityOutcome("committee meeting", ["Committee meetings"]), "uncertain");
  assert.equal(forumIdentityOutcome("committee report", ["Reports of committees"]), "uncertain");
  assert.equal(forumIdentityOutcome("the committee stage", ["Committee stages"]), "uncertain");
  assert.equal(forumIdentityOutcome("the member", ["MOTIONS", "Time limits"]), "match");
  assert.equal(forumIdentityOutcome("the Velloran", ["VELLORANDS", "Velloran"]), "match");
  assert.equal(forumIdentityOutcome("the Velloran", ["VELLORAN AND HARROWBY", "Velloran"]), "match");
  assert.equal(forumIdentityOutcome("the ballot", ["Chapter 2", "SO 7", "Ballot budget"]), "uncertain");
  assert.equal(forumIdentityOutcome("the ballot", ["Chapter 2", "SO 7", "Ballot papers"]), "match");
});

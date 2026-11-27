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
});

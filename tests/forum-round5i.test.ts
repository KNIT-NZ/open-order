import assert from "node:assert/strict";
import test from "node:test";
import { withCorpusCommitteeNames } from "../lib/committee-names-context";
import { forumIdentityMismatch, forumIdentityOutcome } from "../lib/procedural-mechanisms";

const NAMES = ["Keel Oversight Committee", "Nimbus Review Committee", "Harborlight Committee"];

test("a short form or a prefix-only name does not match a different listed body", () => {
  withCorpusCommitteeNames(NAMES, () => {
    assert.equal(forumIdentityOutcome("the oversight committee", ["Functions of the Nimbus Review Committee"]), "uncertain");
    assert.equal(forumIdentityOutcome("the oversight committee", ["Functions of the Keel Oversight Committee"]), "uncertain");
    assert.equal(forumIdentityOutcome("Sable Committee", ["Nimbus Review Committee"]), "uncertain");
    assert.equal(forumIdentityOutcome("Sable Committee", ["Harborlight Committee"]), "uncertain");
    assert.equal(forumIdentityMismatch("the oversight committee", ["Nimbus Review Committee"]), null);
    assert.equal(forumIdentityOutcome("Committee on Harborlights", ["Harborlight Committee"]), "match");
    assert.equal(forumIdentityOutcome("Harborlight Committee", ["Committee on Harborlights"]), "match");
  });
});

test("a House-level leaf passes even when a listed body is only an ancestor", () => {
  withCorpusCommitteeNames(NAMES, () => {
    const path = ["Chapter 4", "KEEL OVERSIGHT COMMITTEE", "SO 12", "Sittings of the House"];
    assert.equal(forumIdentityOutcome("the House", path), "match");
    assert.equal(forumIdentityOutcome("the Chamber", path), "match");
    assert.equal(forumIdentityOutcome("Keel Oversight Committee", ["Chapter 2", "Sittings of the House", "Nimbus Review Committee", "Leave of absence"]), "reject");
  });
});

test("a classless self-match checks identity-bearing ancestors and ignores generic words", () => {
  assert.equal(forumIdentityOutcome("the Ivy", ["QUARRYSIDE", "SO 5", "Ivy"]), "uncertain");
  assert.equal(forumIdentityOutcome("the Ivy", ["General provisions", "INTRODUCTION", "Ivy"]), "match");
  assert.equal(forumIdentityOutcome("the Ivy", ["Chapter 3", "General procedures", "Ivy"]), "match");
});

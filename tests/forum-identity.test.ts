import assert from "node:assert/strict";
import test from "node:test";
import { validateV40Proposal, type V40Authority, type V40ProposedWitness } from "../lib/ai/scenario-adjudication";
import { withCorpusCommitteeNames } from "../lib/committee-names-context";
import { extractCommitteeTokens } from "../lib/committee-names";
import { forumIdentityMismatch, forumIdentityOutcome } from "../lib/procedural-mechanisms";

const NAMED = [
  "Widget Oversight Committee",
  "Gadget Review Committee",
  "Committee on Quillon Affairs",
  "Committee on Marrow Affairs",
  "Quillon Review Committee",
  "Marrow Review Committee",
  "Standing Committee on Quillon",
  "Standing Committee on Marrow",
  "Joint Quillon Committee",
  "Joint Marrow Committee",
  "Quillon Oversight Committee",
  "Procedure Committee",
  "Whānau Committee",
];

function reject(setting: string, path: string): void {
  assert.equal(forumIdentityOutcome(setting, [path]), "reject", `${setting} / ${path}`);
  assert.equal(forumIdentityMismatch(setting, [path]), "forum-identity");
}

function match(setting: string, path: string): void {
  assert.equal(forumIdentityOutcome(setting, [path]), "match", `${setting} / ${path}`);
  assert.equal(forumIdentityMismatch(setting, [path]), null);
}

test("committee on X keeps the phrase after on, of, or for", () => {
  assert.deepEqual(extractCommitteeTokens("Committee on Quillon Affairs"), ["quillon", "affair"]);
  assert.deepEqual(extractCommitteeTokens("Widgets, Gadgets and Trade Committee"), ["widget", "gadget", "trade"]);
  assert.deepEqual(extractCommitteeTokens("Whānau Committee"), extractCommitteeTokens("Whanau Committee"));
});

test("named committees match only the same body", () => {
  withCorpusCommitteeNames(NAMED, () => {
    const different = [
      ["Committee on Quillon Affairs", "Committee on Marrow Affairs"],
      ["Quillon Review Committee", "Marrow Review Committee"],
      ["Standing Committee on Quillon", "Standing Committee on Marrow"],
      ["Joint Quillon Committee", "Joint Marrow Committee"],
      ["Quillon Oversight Committee", "Committee on Marrow Affairs"],
      ["Widget Oversight Committee", "Gadget Review Committee"],
      ["Procedure Committee", "Gadget Review Committee"],
      ["Whānau Committee", "Gadget Review Committee"],
    ];
    for (const [setting, path] of different) reject(setting, path);

    match("COMMITTEE ON QUILLON AFFAIRS", "committee on quillon affairs");
    match("procedure committee", "PROCEDURE COMMITTEE");
    match("Whanau Committee", "Whānau Committee");
    assert.equal(forumIdentityOutcome("the House", ["Committee of the whole House"]), "uncertain");
    match("House of Representatives", "Sittings of the House");
    assert.equal(forumIdentityOutcome("committee meeting", ["Procedure in committees"]), "uncertain");
    assert.equal(forumIdentityOutcome("the House", ["Widget Oversight Committee"]), "uncertain");
    assert.equal(forumIdentityOutcome("committee of the whole", ["select committees"]), "uncertain");
  });
});

test("the same body in another form matches, and a shared word does not", () => {
  withCorpusCommitteeNames(["Widget Committee", "Gadget Review Committee"], () => {
    assert.equal(forumIdentityOutcome("Widget Committee", ["Committee on Widgets"]), "uncertain");
    assert.equal(forumIdentityOutcome("committee on widgets", ["WIDGET COMMITTEE"]), "uncertain");
    assert.equal(forumIdentityOutcome("Committee on Widgets", ["Gadget Review Committee"]), "uncertain");
  });
  withCorpusCommitteeNames([
    "Widgets, Gadgets and Trade Committee",
    "Gadgets Affairs Committee",
  ], () => {
    assert.equal(forumIdentityOutcome("Widgets and Gadgets Committee", ["Widgets, Gadgets and Trade Committee"]), "uncertain");
    reject("Gadgets Affairs Committee", "Widgets, Gadgets and Trade Committee");
    assert.equal(forumIdentityOutcome("Widgets Committee", ["Widgets, Gadgets and Trade Committee"]), "uncertain");
    assert.equal(forumIdentityOutcome("Gadgets Committee", ["Widgets, Gadgets and Trade Committee"]), "uncertain");
  });
});

test("a longer unlisted name does not collapse onto a listed body", () => {
  withCorpusCommitteeNames(["Widget Committee"], () => {
    for (const setting of [
      "Tarn Widget Committee",
      "Widget Tarn Committee",
      "Widget and Tarn Committee",
      "Committee on Widgets and Tarns",
    ]) {
      assert.equal(forumIdentityOutcome(setting, ["Widget Committee"]), "uncertain", setting);
      assert.equal(forumIdentityMismatch(setting, ["Widget Committee"]), null, setting);
    }
  });
});

test("one shared word does not resolve to a listed body", () => {
  withCorpusCommitteeNames([
    "Standing Orders Committee",
    "Regulations Review Committee",
  ], () => {
    assert.equal(forumIdentityOutcome("a standing committee", ["Regulations Review Committee"]), "uncertain");
    assert.equal(forumIdentityOutcome("a standing committee", ["Standing Orders Committee"]), "uncertain");
    assert.equal(forumIdentityOutcome("the review committee", ["Regulations Review Committee"]), "uncertain");
    assert.equal(forumIdentityOutcome("the review committee", ["Standing Orders Committee"]), "uncertain");
    assert.equal(forumIdentityOutcome("Standing Committee", ["Standing Orders Committee"]), "uncertain");
    assert.equal(forumIdentityOutcome("a committee of the Assembly", ["Regulations Review Committee"]), "uncertain");
    match("this committee", "Standing Orders Committee");
  });
});

test("a committee's own multi-segment path matches, and a different body does not", () => {
  const own = ["Chapter 2", "Sittings of the House", "Functions of the Widget Oversight Committee"];
  const financial = ["Chapter 6", "Financial procedures", "SELECT COMMITTEE SCRUTINY", "Functions of the Widget Oversight Committee"];
  withCorpusCommitteeNames(["Widget Oversight Committee", "Gadget Review Committee"], () => {
    assert.equal(forumIdentityOutcome("Widget Oversight Committee", own), "match");
    assert.equal(forumIdentityOutcome("Widget Oversight Committee", financial), "match");
    assert.equal(forumIdentityOutcome("Functions of the Widget Oversight Committee", own), "match");
    assert.equal(forumIdentityOutcome("Gadget Review Committee", own), "reject");
    assert.equal(forumIdentityOutcome("Tarn Widget Committee", own), "uncertain");
    assert.equal(forumIdentityOutcome("Widget Committee", ["Chapter 2", "Sittings of the House", "Widget Trade Committee"]), "uncertain");
  });
});

test("a different proceeding name is qualified and is not withheld", () => {
  assert.equal(forumIdentityOutcome("the Tarn debate", ["Marrow debate"]), "uncertain");
  assert.equal(forumIdentityOutcome("the Tarn debate", ["Chapter 2", "Sittings of the House", "Marrow debate"]), "uncertain");
  assert.equal(forumIdentityOutcome("Tarn reading debate", ["Marrow reading debate"]), "uncertain");
  assert.equal(forumIdentityOutcome("general debate", ["Tarn debate"]), "uncertain");
  assert.equal(forumIdentityOutcome("the Tarn stage", ["Marrow stage"]), "uncertain");
  assert.equal(forumIdentityOutcome("urgency motion", ["Motion for adjournment"]), "uncertain");
  assert.equal(forumIdentityMismatch("the Tarn debate", ["Marrow debate"]), null);
  assert.equal(forumIdentityOutcome("the chamber", ["rules of debate"]), "match");
});

test("a setting with no forum class is ambiguous against a named body", () => {
  withCorpusCommitteeNames(["Widget Oversight Committee"], () => {
    assert.equal(forumIdentityOutcome("the Tarn Subcommittee", ["Widget Oversight Committee"]), "uncertain");
    assert.equal(forumIdentityMismatch("the Tarn Subcommittee", ["Widget Oversight Committee"]), null);
    assert.equal(forumIdentityOutcome("the Tarn Subcommittee", ["select committees"]), "uncertain");
    assert.equal(forumIdentityOutcome("the Tarn Subcommittee", ["Marrow Oversight Committee"]), "uncertain");
  });
});

test("generic phrases match, and an ambiguous parse does not", () => {
  withCorpusCommitteeNames(["Procedure Committee", "Gadget Review Committee"], () => {
    for (const phrase of [
      "this committee",
      "This committee",
      "any committee",
      "ANY COMMITTEE",
      "the relevant committee",
      "select committee",
    ]) {
      match(phrase, "Procedure Committee");
    }
    for (const phrase of ["the specialist committee", "the parliamentary committee"]) {
      assert.equal(forumIdentityOutcome(phrase, ["Procedure Committee"]), "uncertain", phrase);
    }
  });
  withCorpusCommitteeNames(["Widget Trade Committee", "Widget Review Committee"], () => {
    assert.equal(forumIdentityOutcome("Widget Committee", ["Widget Trade Committee"]), "uncertain");
    assert.equal(forumIdentityMismatch("Widget Committee", ["Widget Trade Committee"]), null);
    assert.equal(forumIdentityOutcome("widget committee", ["WIDGET TRADE COMMITTEE"]), "uncertain");
  });
});

test("an ambiguous forum parse is admitted and qualified", () => {
  const quote = "The House may suspend the sitting when the Speaker so decides.";
  const source: V40Authority = {
    sectionId: "syn-forum",
    citationLabel: "QX 1",
    documentCorpus: "standing_orders",
    heading: "Synthetic rule",
    path: ["Widget Trade Committee"],
    sectionContent: quote,
  };
  const proposal = {
    selected: [{
      citationLabel: "QX 1",
      role: "governing",
      exactQuote: quote,
      actorMatches: true,
      settingMatches: true,
      actionMatches: true,
      stageMatches: true,
      rationale: "synthetic",
    } satisfies V40ProposedWitness],
    remainingUncertainties: [],
    explanation: "",
  };
  withCorpusCommitteeNames(["Widget Trade Committee", "Widget Review Committee"], () => {
    const review = validateV40Proposal({
      question: "May the Widget Committee suspend the sitting?",
      action: "suspend the sitting",
      setting: "Widget Committee",
      candidates: [source],
      proposal,
    });
    assert.equal(review.authorities.length, 1);
    assert.equal(review.reason, "v40_quoted_source_adjudication");
    assert.ok(review.qualifications.includes("forum_identity_unconfirmed"));
    assert.equal(review.rejected.some((line) => line.includes("forum-identity")), false);
  });
});

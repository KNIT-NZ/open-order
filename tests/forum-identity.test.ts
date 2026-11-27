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
    match("the House", "Committee of the whole House");
    match("House of Representatives", "Sittings of the House");
    match("committee meeting", "Procedure in committees");
    reject("the House", "Widget Oversight Committee");
    reject("committee of the whole", "select committees");
  });
});

test("the same body in another form matches, and a shared word does not", () => {
  withCorpusCommitteeNames(["Widget Committee", "Gadget Review Committee"], () => {
    match("Widget Committee", "Committee on Widgets");
    match("committee on widgets", "WIDGET COMMITTEE");
    reject("Committee on Widgets", "Gadget Review Committee");
  });
  withCorpusCommitteeNames([
    "Widgets, Gadgets and Trade Committee",
    "Gadgets Affairs Committee",
  ], () => {
    match("Widgets and Gadgets Committee", "Widgets, Gadgets and Trade Committee");
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
    for (const phrase of ["a standing committee", "Standing Committee", "the review committee", "a committee of the Assembly"]) {
      assert.equal(forumIdentityOutcome(phrase, ["Regulations Review Committee"]), "uncertain", phrase);
      assert.equal(forumIdentityOutcome(phrase, ["Standing Orders Committee"]), "uncertain", phrase);
      assert.equal(forumIdentityMismatch(phrase, ["Standing Orders Committee"]), null, phrase);
    }
    match("this committee", "Standing Orders Committee");
  });
});

test("a setting with no forum class is ambiguous against a named body", () => {
  withCorpusCommitteeNames(["Widget Oversight Committee"], () => {
    assert.equal(forumIdentityOutcome("the Tarn Subcommittee", ["Widget Oversight Committee"]), "uncertain");
    assert.equal(forumIdentityMismatch("the Tarn Subcommittee", ["Widget Oversight Committee"]), null);
    match("the Tarn Subcommittee", "select committees");
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
      "the specialist committee",
      "the parliamentary committee",
      "select committee",
    ]) {
      match(phrase, "Procedure Committee");
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

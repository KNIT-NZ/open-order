import assert from "node:assert/strict";
import test from "node:test";
import { AiProviderError } from "../lib/ai/errors";
import { providerAttemptOutcome } from "../lib/ai/gemini";
import {
  adjudicationRouting,
  plannerRecordsEvent,
  validateV40Proposal,
  type V40Authority,
  type V40ProposedWitness,
} from "../lib/ai/scenario-adjudication";
import { withCorpusCommitteeNames } from "../lib/committee-names";
import { publicScenarioAdjudication } from "../lib/open-order/client-check-note";
import { buildFallbackAnswer, withholdingStage } from "../lib/procedural-reasoning";
import { actAttestation, forumIdentityMismatch, quoteAttestsActAndObject, suffixStem } from "../lib/procedural-mechanisms";

const suspension = "A suspension of the sitting is permitted when the presiding officer so decides.";
const device = "Carrying a device is permitted when it does not disrupt the forum.";

function source(partial: Partial<V40Authority> & Pick<V40Authority, "sectionId" | "citationLabel" | "sectionContent">): V40Authority {
  return {
    documentCorpus: "standing_orders",
    heading: "Synthetic rule",
    path: ["Debate"],
    ...partial,
  };
}

function governing(label: string, quote: string): V40ProposedWitness {
  return {
    citationLabel: label,
    role: "governing",
    exactQuote: quote,
    actorMatches: true,
    settingMatches: true,
    actionMatches: true,
    stageMatches: true,
    rationale: "synthetic",
  };
}

test("a noun form of the asked act is attested and admitted cleanly", () => {
  assert.equal(quoteAttestsActAndObject(suspension, "suspend the sitting"), true);
  const body = source({ sectionId: "syn-1", citationLabel: "QX 1", sectionContent: suspension });
  const review = validateV40Proposal({
    question: "May the sitting be suspended?",
    action: "suspend the sitting",
    candidates: [body],
    proposal: { selected: [governing("QX 1", suspension)], remainingUncertainties: [], explanation: "" },
  });
  assert.equal(review.authorities.length, 1);
  assert.deepEqual(review.qualifications, []);
  assert.equal(review.reason, "v40_quoted_source_adjudication");
});

test("different act words are admitted with a qualification instead of withheld", () => {
  assert.equal(quoteAttestsActAndObject(device, "emit a beacon"), false);
  const body = source({ sectionId: "syn-2", citationLabel: "QX 2", sectionContent: device, path: ["Forum conduct"] });
  const review = validateV40Proposal({
    question: "May the actor emit a beacon?",
    action: "emit a beacon",
    candidates: [body],
    proposal: { selected: [governing("QX 2", device)], remainingUncertainties: [], explanation: "" },
  });
  assert.equal(review.authorities.length, 1);
  assert.deepEqual(review.qualifications, ["act_attestation_unconfirmed"]);
  assert.equal(review.reason, "v40_quoted_source_adjudication");
  assert.equal(review.rejectedGoverning.length, 0);
});

test("forum type matches a generic body and rejects two different names", () => {
  withCorpusCommitteeNames(["Widget Oversight Committee", "Gadget Review Committee"], () => {
  assert.equal(forumIdentityMismatch("select committee", ["Widget Oversight Committee"]), null);
  assert.equal(forumIdentityMismatch("Widget Oversight Committee", ["Select committees"]), null);
  assert.equal(forumIdentityMismatch("House of Representatives", ["Sittings of the House"]), null);
  assert.equal(forumIdentityMismatch("committee meeting", ["Procedure in committees"]), null);
  assert.equal(forumIdentityMismatch("select committee hearing", ["Widget Oversight Committee"]), null);
  assert.equal(forumIdentityMismatch("Widget Oversight Committee", ["Gadget Review Committee"]), "forum-identity");
  assert.equal(forumIdentityMismatch("the House", ["Widget Oversight Committee"]), "forum-identity");
  assert.equal(forumIdentityMismatch("the House", ["Committee of the whole House"]), null);
  assert.equal(forumIdentityMismatch("committee of the whole", ["select committees"]), "forum-identity");
  const named = source({
    sectionId: "syn-3",
    citationLabel: "QX 3",
    sectionContent: suspension,
    path: ["Widget Oversight Committee"],
  });
  const admitted = validateV40Proposal({
    question: "May a select committee suspend its sitting?",
    action: "suspend the sitting",
    setting: "select committee",
    candidates: [named],
    proposal: { selected: [governing("QX 3", suspension)], remainingUncertainties: [], explanation: "" },
  });
  assert.equal(admitted.authorities.length, 1);
  assert.deepEqual(admitted.qualifications, []);
  const other = source({
    sectionId: "syn-4",
    citationLabel: "QX 4",
    sectionContent: suspension,
    path: ["Gadget Review Committee"],
  });
  const rejected = validateV40Proposal({
    question: "May the Widget Oversight Committee suspend its sitting?",
    action: "suspend the sitting",
    setting: "Widget Oversight Committee",
    candidates: [other],
    proposal: { selected: [governing("QX 4", suspension)], remainingUncertainties: [], explanation: "" },
  });
  assert.equal(rejected.authorities.length, 0);
  assert.ok(rejected.rejected.some((line) => line.includes("forum-identity")));
  const house = validateV40Proposal({
    question: "May the House suspend its sitting?",
    action: "suspend the sitting",
    setting: "the House",
    candidates: [source({
      sectionId: "syn-house",
      citationLabel: "QX 8",
      sectionContent: suspension,
      path: ["Committee of the whole House"],
    })],
    proposal: { selected: [governing("QX 8", suspension)], remainingUncertainties: [], explanation: "" },
  });
  assert.equal(house.authorities.length, 1);
  assert.deepEqual(house.qualifications, []);
  });
});

test("an unverifiable quote is still a hard rejection", () => {
  const body = source({ sectionId: "syn-5", citationLabel: "QX 5", sectionContent: suspension });
  const review = validateV40Proposal({
    question: "May the sitting be suspended?",
    action: "suspend the sitting",
    candidates: [body],
    proposal: {
      selected: [governing("QX 5", "This sentence was never in the retrieved source text.")],
      remainingUncertainties: [],
      explanation: "",
    },
  });
  assert.equal(review.authorities.length, 0);
  assert.ok(review.rejected.some((line) => line.includes("unverified-verbatim-witness")));
});

test("the stemmer keeps report and notice intact and requires verb and object", () => {
  assert.notEqual(suffixStem("report"), "repor");
  assert.notEqual(suffixStem("notice"), "not");
  assert.equal(suffixStem("report"), "report");
  assert.equal(suffixStem("notice"), "notice");
  const misses = [
    ["The House may suspend business of a committee when its chair so decides.", "suspend the sitting"],
    ["The Speaker may order a member to withdraw.", "speak in the debate"],
    ["Standing Orders apply to every sitting of the forum.", "order a member to leave"],
    ["A member may do so.", "may"],
    ["Carrying a device is permitted when it does not disrupt the forum.", "emit a beacon"],
    ["The member moved a motion on the paper.", "move an amendment"],
  ] as const;
  for (const [quote, action] of misses) {
    assert.equal(actAttestation(quote, action), "unconfirmed", action);
    assert.equal(quoteAttestsActAndObject(quote, action), false);
  }
  assert.equal(quoteAttestsActAndObject("The actor may emit a beacon.", "may"), false);
});

test("incident routing uses the planner event slot, not question openings", () => {
  const question = "When is the House sitting?";
  assert.equal(plannerRecordsEvent({ materialFacts: [], affectedPerson: "" }), false);
  assert.deepEqual(adjudicationRouting(question, "incident", true, { materialFacts: [] }), {
    adjudicate: false,
    reason: "incident_uncorroborated",
  });
  assert.deepEqual(adjudicationRouting("A member shouted. What can be done?", "incident", true, {
    materialFacts: ["a member shouted"],
  }), {
    adjudicate: true,
    reason: "incident_corroborated",
  });
  assert.equal(adjudicationRouting(question, "procedure", true, { materialFacts: ["ignored"] }).reason, "planner_procedure");
  assert.equal(adjudicationRouting(question, undefined, true, { affectedPerson: "a visitor" }).reason, "narrative_corroborated");
  assert.equal(adjudicationRouting(question, undefined, true, {}).reason, "kind_absent");
});

test("withholding stage follows the recovery that actually ran", () => {
  const cases = [
    { status: "not_needed", ran: false, stage: "adjudication" },
    { status: "no_eligible_sources", ran: false, stage: "adjudication" },
    { status: "time_budget_exhausted", ran: false, stage: "adjudication" },
    { status: "provider_unavailable", ran: true, stage: "recovery" },
    { status: "invalid_structured_result", ran: true, stage: "recovery" },
    { status: "ran_nothing_admitted", ran: true, stage: "recovery" },
  ] as const;
  assert.equal(withholdingStage({ adjudicated: false, recoveryRan: false }), "selection");
  for (const item of cases) {
    const stage = withholdingStage({ adjudicated: true, recoveryRan: item.ran });
    assert.equal(stage, item.stage, item.status);
    const text = buildFallbackAnswer({
      question: "synthetic",
      planIntent: "explain_rule",
      authorities: [],
      effectiveCorpus: null,
      fallbackReason: "Retrieved evidence did not satisfy the semantic authority-selection requirements.",
      failureClass: "selection",
      retrievedEvidenceCount: 2,
      withheldStage: stage,
    });
    assert.match(text, new RegExp(`withheld at ${item.stage}`), item.status);
    if (item.stage !== "recovery") assert.equal(text.includes("withheld at recovery"), false, item.status);
  }
});

test("withholding text matches the stage that withheld", () => {
  const selected = buildFallbackAnswer({
    question: "synthetic",
    planIntent: "explain_rule",
    authorities: [],
    effectiveCorpus: null,
    fallbackReason: "Retrieved evidence did not satisfy the semantic authority-selection requirements.",
    failureClass: "selection",
    retrievedEvidenceCount: 2,
  });
  assert.match(selected, /Retrieval found possible authorities/);
  assert.match(selected, /withheld at selection/);
  assert.equal(selected.includes("No authorities were retrieved"), false);
  assert.equal(selected.includes("not retrieved"), false);
  for (const stage of ["adjudication", "recovery"] as const) {
    const text = buildFallbackAnswer({
      question: "synthetic",
      planIntent: "explain_rule",
      authorities: [],
      effectiveCorpus: null,
      fallbackReason: "Retrieved evidence did not satisfy the semantic authority-selection requirements.",
      failureClass: "selection",
      retrievedEvidenceCount: 2,
      withheldStage: stage,
    });
    assert.match(text, new RegExp(`withheld at ${stage}`));
    assert.equal(text.includes("withheld at selection"), false);
  }
  const unconfirmed = buildFallbackAnswer({
    question: "synthetic",
    planIntent: "explain_rule",
    authorities: [],
    effectiveCorpus: null,
    fallbackReason: "The AI draft cited authorities that were not retrieved.",
    unconfirmedAuthorities: [{
      sectionId: "s1", sectionKey: "s1", citationLabel: "SO 1", heading: "Synthetic",
      path: ["House"], pathText: "House", documentSlug: "standing-orders",
      documentTitle: "Standing Orders", documentCorpus: "standing_orders",
      sourceUrl: null, sourceAnchor: null, rank: 1, sectionRank: 1, pathRank: 0,
      bodyRank: 0, chunkRank: null, clusterSupportCount: 1, sectionContent: "synthetic",
      matchSignals: {
        exactSectionKeyMatch: false, exactCitationMatch: false, exactHeadingMatch: false,
        headingPhraseMatch: false, bodyPhraseMatch: false, pathPhraseMatch: false,
      },
    }],
  });
  assert.match(unconfirmed, /none was confirmed to govern the act asked about/);
  assert.equal(unconfirmed.includes("No authorities were retrieved"), false);
  assert.equal(unconfirmed.includes("No sufficiently relevant authority was retrieved"), false);
  const empty = buildFallbackAnswer({
    question: "synthetic",
    planIntent: "explain_rule",
    authorities: [],
    effectiveCorpus: null,
    fallbackReason: "No relevant authorities were retrieved.",
    failureClass: "selection",
    retrievedEvidenceCount: 0,
  });
  assert.match(empty, /No authorities were retrieved/);
  assert.equal(empty.includes("Retrieval found possible authorities"), false);
});

test("rejected governing nominations are public only as counts", () => {
  const leaked = {
    status: "v40_no_governing_witness",
    candidateCount: 1,
    selected: [],
    rejected: ["QX 9:the model wrote a long private reason"],
    gaps: ["free text gap"],
    providerAttempts: 1,
    dossier: [],
    retrievedOutsideDossier: [],
    dispositions: [],
    unavailableNominations: 0,
    recovery: {
      status: "not_needed",
      candidates: [],
      dispositions: [],
      unavailableNominations: 0,
      selected: [],
      rejected: [],
    },
    rejectedGoverning: [
      { id: "syn-9", inDossier: true },
      { id: "SO 999", inDossier: false },
    ],
  };
  const once = publicScenarioAdjudication(leaked);
  const twice = publicScenarioAdjudication(once);
  assert.equal(once?.rejectedGoverning, 2);
  assert.equal(once?.rejectedInDossier, 1);
  assert.equal(once?.rejectedOutsideDossier, 1);
  assert.deepEqual(twice?.rejectedGoverning, once?.rejectedGoverning);
  assert.equal(JSON.stringify(once).includes("syn-9"), false);
  assert.equal(JSON.stringify(once).includes("SO 999"), false);
  assert.equal(JSON.stringify(once).includes("private"), false);
});

test("provider outcome other is the residual failure class", () => {
  const parsed = new AiProviderError({
    message: "schema",
    kind: "parse",
    statusCode: 400,
    retryable: false,
    provider: "gemini",
  });
  assert.equal(providerAttemptOutcome(parsed), "other");
  const rate = new AiProviderError({
    message: "rate",
    kind: "rate_limited",
    statusCode: 429,
    retryable: true,
    provider: "gemini",
  });
  assert.equal(providerAttemptOutcome(rate), "429");
});

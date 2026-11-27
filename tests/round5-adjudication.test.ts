import assert from "node:assert/strict";
import test from "node:test";
import { AiProviderError } from "../lib/ai/errors";
import { providerAttemptOutcome } from "../lib/ai/gemini";
import {
  adjudicationRouting,
  validateV40Proposal,
  type V40Authority,
  type V40ProposedWitness,
} from "../lib/ai/scenario-adjudication";
import { publicScenarioAdjudication } from "../lib/open-order/client-check-note";
import { buildFallbackAnswer } from "../lib/procedural-reasoning";
import { forumIdentityMismatch, quoteAttestsActAndObject } from "../lib/procedural-mechanisms";

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

test("a named committee matches a generic committee setting, and the House does not", () => {
  assert.equal(forumIdentityMismatch("select committee", ["Finance and Expenditure Committee"]), null);
  assert.equal(forumIdentityMismatch("the House", ["Finance and Expenditure Committee"]), "forum-identity");
  assert.equal(forumIdentityMismatch("committee of the whole", ["select committees"]), "forum-identity");
  const named = source({
    sectionId: "syn-3",
    citationLabel: "QX 3",
    sectionContent: suspension,
    path: ["Finance and Expenditure Committee"],
  });
  const admitted = validateV40Proposal({
    question: "May a select committee suspend its sitting?",
    action: "suspend the sitting",
    setting: "select committee",
    candidates: [named],
    proposal: { selected: [governing("QX 3", suspension)], remainingUncertainties: [], explanation: "" },
  });
  assert.equal(admitted.authorities.length, 1);
  const house = source({
    sectionId: "syn-4",
    citationLabel: "QX 4",
    sectionContent: suspension,
    path: ["Finance and Expenditure Committee"],
  });
  const rejected = validateV40Proposal({
    question: "May the House suspend its sitting?",
    action: "suspend the sitting",
    setting: "the House",
    candidates: [house],
    proposal: { selected: [governing("QX 4", suspension)], remainingUncertainties: [], explanation: "" },
  });
  assert.equal(rejected.authorities.length, 0);
  assert.ok(rejected.rejected.some((line) => line.includes("forum-identity")));
  assert.deepEqual(rejected.rejectedGoverning, [{ id: "syn-4", inDossier: true }]);
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

test("incident routing requires corroboration and reports a reason code", () => {
  const procedural = "May the House suspend the sitting?";
  assert.deepEqual(adjudicationRouting(procedural, "incident", true), {
    adjudicate: false,
    reason: "incident_uncorroborated",
  });
  const narrative = "While the sitting was underway, a member asked to suspend it.";
  assert.deepEqual(adjudicationRouting(narrative, "incident", true), {
    adjudicate: true,
    reason: "incident_corroborated",
  });
  assert.equal(adjudicationRouting(procedural, "procedure", true).reason, "planner_procedure");
  assert.equal(adjudicationRouting(procedural, "incident", false).reason, "no_legacy_pack");
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

test("rejected governing identifiers survive the public filter without prose", () => {
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
      { id: "the model quoted a private sentence", inDossier: true },
    ],
  };
  const once = publicScenarioAdjudication(leaked);
  const twice = publicScenarioAdjudication(once);
  assert.deepEqual(twice?.rejectedGoverning, once?.rejectedGoverning);
  assert.deepEqual(once?.rejectedGoverning, [{ id: "syn-9", inDossier: true }]);
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

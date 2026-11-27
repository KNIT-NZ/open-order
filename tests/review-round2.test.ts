import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { admitJudgedOverlooked } from "../lib/ai/scenario-adjudication";
import { pruneValidatedAnswerContent } from "../lib/procedural-reasoning";
import { selectV517AuthorityPack } from "../lib/v5-17-semantic-selector.js";
import {
  collectRejectionKeys,
  deriveAnswerState,
  followOperatorChain,
  operatorCitations,
  parseSettlement,
  selectOverlookedCandidates,
} from "../lib/procedural-mechanisms";

const quote = "The House may suspend the sitting when the Speaker so decides.";

test("settlement trailer uses answer states and uncertainty classes", () => {
  const parsed = parseSettlement([
    "Bottom line:",
    "The House may suspend the sitting. [SO 1]",
    "",
    "> **Settlement:** supported",
    "Settlement: partial",
    "*Unresolved:* corpus_silence: who decides; retrieval_uncertainty: cross-reference chain truncated; this is a long free-text sentence that must not pass.",
  ].join("\n"));
  assert.equal(parsed.settlement, "partial");
  assert.deepEqual(parsed.uncertainty, [
    { class: "retrieval_uncertainty", facet: "who decides" },
    { class: "retrieval_uncertainty", facet: "cross-reference chain truncated" },
  ]);
  assert.doesNotMatch(parsed.text, /Settlement:|Unresolved:/);
  assert.equal(parseSettlement("Bottom line:\nA rule. [SO 1]").settlement, null);
  assert.equal(deriveAnswerState({ settlement: "supported", uncertainty: parsed.uncertainty }), "partial");
  assert.equal(deriveAnswerState({ abstained: true, settlement: "supported" }), "not_answered");
  assert.equal(deriveAnswerState({ settlement: "not_answered" }), "not_answered");
  assert.equal(deriveAnswerState({ settlement: null }), "partial");
  const held = parseSettlement("Unresolved: corpus_silence: missing_practice", { sourcesNotHeld: true });
  assert.equal(held.uncertainty[0]?.class, "coverage_gap");
});

test("prune does not flag a trailer that was already removed", () => {
  const draft = [
    "Bottom line:",
    "The House may suspend the sitting. [SO 1]",
    "Settlement: partial",
    "Unresolved: retrieval_uncertainty:actor_scope",
  ].join("\n");
  const parsed = parseSettlement(draft);
  const pruned = pruneValidatedAnswerContent({
    answerText: parsed.text,
    authorities: [{ citationLabel: "SO 1" }],
  });
  assert.equal(pruned.removedLines.some((line) => /Settlement:|Unresolved:/.test(line)), false);
});

test("operator chains stop at three hops and ignore see also", () => {
  const unit = (sectionId: string, citationLabel: string, sectionContent: string, heading = "Rule") => ({
    sectionId, citationLabel, documentCorpus: "standing_orders", heading, path: ["House"], sectionContent,
  });
  const admitted = unit("1", "SO 1", "A member may speak subject to SO 2. See also SO 9.");
  const second = unit("2", "SO 2", "Leave is required notwithstanding SO 3.");
  const third = unit("3", "SO 3", "The Speaker decides despite SO 4.");
  const fourth = unit("4", "SO 4", "Time is extended in accordance with SO 5.");
  const fifth = unit("5", "SO 5", "No further operator is stated in this unit.");
  const topical = unit("9", "SO 9", "A note about a different subject.");
  const chain = followOperatorChain({
    admitted: [admitted],
    pool: [admitted, second, third, fourth, fifth, topical],
  });
  assert.deepEqual(chain.candidates.map((item) => item.citationLabel), ["SO 2", "SO 3", "SO 4"]);
  assert.equal(chain.truncated, true);
  assert.deepEqual(operatorCitations("See also SO 9 for another topic."), []);
  const definition = unit("8", "SO 8", "Sitting means a period the House is together.", "Interpretation");
  const defined = followOperatorChain({
    admitted: [unit("1", "SO 1", "A word is used as defined in SO 8.")],
    pool: [definition],
  });
  assert.deepEqual(defined.candidates.map((item) => item.citationLabel), ["SO 8"]);
});

test("overlooked admission requires a judge and drops a source the judge did not attest", async () => {
  const source = readFileSync(new URL("../lib/ai/scenario-adjudication.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /function adjudicateOverlooked|overlooked retrieved candidate/);
  const catering = {
    sectionId: "catering",
    citationLabel: "SO 9",
    documentCorpus: "standing_orders",
    heading: "Refreshments",
    path: ["House"],
    sectionContent: "Refreshments may be served in the lobby during a sitting of the House.",
  };
  const unavailable = await admitJudgedOverlooked({
    question: "May the House suspend the sitting?",
    action: "suspend the sitting",
    candidates: [catering],
    judge: async () => { throw new Error("provider unavailable"); },
  });
  assert.equal(unavailable.unavailable, true);
  assert.deepEqual(unavailable.authorities, []);
  const rubber = await admitJudgedOverlooked({
    question: "May the House suspend the sitting?",
    action: "suspend the sitting",
    candidates: [catering],
    judge: async () => ({
      selected: [{
        citationLabel: "SO 9",
        role: "governing",
        exactQuote: catering.sectionContent,
        actorMatches: true,
        settingMatches: true,
        actionMatches: true,
        stageMatches: true,
        rationale: "copied opening",
      }],
      remainingUncertainties: [],
      explanation: "",
    }),
  });
  assert.deepEqual(rubber.authorities, []);
  const governing = {
    ...catering,
    sectionId: "suspend",
    citationLabel: "SO 1",
    heading: "Suspension",
    sectionContent: quote,
  };
  const judged = await admitJudgedOverlooked({
    question: "May the House suspend the sitting?",
    action: "suspend the sitting",
    candidates: [governing],
    judge: async () => ({
      selected: [{
        citationLabel: "SO 1",
        role: "governing" as const,
        exactQuote: quote,
        actorMatches: true,
        settingMatches: true,
        actionMatches: true,
        stageMatches: true,
        rationale: "the quoted text states the power",
      }],
      remainingUncertainties: [],
      explanation: "",
    }),
  });
  assert.equal(judged.unavailable, false);
  assert.equal(judged.authorities[0]?.citationLabel, "SO 1");
});

test("a selector-rejected section cannot be recovered", async () => {
  const source = {
    sectionId: "sec-ask",
    sectionKey: "so-40",
    citationLabel: "SO 40",
    heading: "Leave",
    path: ["House"],
    pathText: "House",
    documentSlug: "standing-orders",
    documentTitle: "Standing Orders",
    documentCorpus: "standing_orders",
    sourceUrl: null,
    sourceAnchor: null,
    rank: 1,
    sectionRank: 1,
    pathRank: 0,
    bodyRank: 0,
    chunkRank: null,
    clusterSupportCount: 1,
    sectionContent: "A member may ask leave to withdraw from the chamber during a sitting.",
    matchSignals: {
      exactSectionKeyMatch: false,
      exactCitationMatch: false,
      exactHeadingMatch: false,
      headingPhraseMatch: false,
      bodyPhraseMatch: false,
      pathPhraseMatch: false,
    },
  };
  const selection = await selectV517AuthorityPack({
    question: "Can the Speaker compel a member to withdraw from the chamber?",
    plannerRelations: ["permission"],
    searches: [{ query: "withdrawal", corpus: "standing_orders", provenance: "planner", results: [] }],
    searchProceduralAuthorities: async () => ({ results: [source], total: 1 }),
    situation: {
      action: "compel withdrawal",
      materialFacts: ["tea was served in the lobby", "catering continued after the bell"],
      subQuestions: ["Can the Speaker compel withdrawal?"],
    },
  });
  assert.equal(selection.obligationDetails.length, 1);
  assert.equal(selection.finalAuthorities.some((item) => item.sectionId === "sec-ask"), false);
  assert.equal(selection.rejectedAuthorities?.some((item) => item.sectionId === "sec-ask" && item.reason === "compulsion"), true);
  const keys = collectRejectionKeys({ selectorRejections: selection.rejectedAuthorities });
  const overlooked = selectOverlookedCandidates({
    pool: [source],
    admittedIds: [],
    rejectedKeys: keys,
    action: "compel withdrawal",
  });
  assert.deepEqual(overlooked, []);
});

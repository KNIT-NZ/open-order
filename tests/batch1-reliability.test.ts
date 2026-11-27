import assert from "node:assert/strict";
import test from "node:test";
import { superviseAnswerStream } from "../lib/open-order/answer-stream";
import {
  actorClassDrift,
  authorisingRuleQueries,
  conditionalSubIssueGaps,
  deriveAnswerOutcome,
  describesStandingOrdersAsStatute,
  dropUnreferencedCitationEntries,
  dutyVersusDiscretion,
  errorCorrectionQueries,
  exceptionNamesAuthorisingBody,
  forumIdentityMismatch,
  freezeFirstDraft,
  insufficiencyFacets,
  isBoundedSearchFocus,
  isStructuredTableRow,
  labelBareRulings,
  mustAdjudicateFromPlanner,
  negativePowerWitnessScore,
  normaliseNumberWords,
  obligationPartialFacets,
  powerGrantedToDifferentBody,
  procedureHomonymMismatch,
  proceedingConsequenceQueries,
  quoteAttestsActAndObject,
  relationsFromPlanner,
  routeFromPlanner,
  stageReopeningQueries,
  tableVocabularyCovers,
  usableSourceAnchor,
} from "../lib/procedural-mechanisms";
import { geminiFreeTierChain, runGeminiChain } from "../lib/ai/gemini";
import { AiProviderError } from "../lib/ai/errors";
import { getAiCandidates } from "../lib/ai/routes";

test("hanging provider still yields one terminal error and a heartbeat", async () => {
  const chunks: string[] = [];
  const result = await superviseAnswerStream({
    deadlineMs: 40,
    heartbeatMs: 10,
    write: (chunk) => chunks.push(chunk),
    work: () => new Promise(() => undefined),
  });
  assert.equal(result.event, "error");
  assert.equal(result.data.reason, "deadline_exceeded");
  assert.ok(result.heartbeats >= 1);
  assert.equal(chunks.filter((chunk) => chunk.startsWith("event: error")).length, 1);
  assert.ok(chunks.some((chunk) => chunk.startsWith(": heartbeat")));
});

test("a completed stream is not followed by a second terminal", async () => {
  const chunks: string[] = [];
  const result = await superviseAnswerStream({
    deadlineMs: 500,
    heartbeatMs: 200,
    write: (chunk) => chunks.push(chunk),
    work: async (send) => { send("done", { ok: true }); },
  });
  assert.equal(result.event, "done");
  assert.equal(chunks.filter((chunk) => chunk.startsWith("event:")).length, 1);
});

test("outcome flags keep fallback separate from partial", () => {
  const partial = deriveAnswerOutcome({
    route: "semantic_selector", fallbackReason: "none", partial: ["sources_do_not_settle"], abstained: false,
  });
  assert.equal(partial.degraded, true);
  assert.equal(partial.fallbackReason, "none");
  const fallback = deriveAnswerOutcome({
    route: "incident_adjudication", fallbackReason: "no_authority_selected", partial: [], abstained: true,
  });
  assert.equal(fallback.degraded, true);
  assert.equal(fallback.abstained, true);
  assert.notEqual(fallback.fallbackReason, "none");
});

test("insufficiency and incomplete obligations are structural", () => {
  assert.deepEqual(insufficiencyFacets("Bottom line:\nThe retrieved sources do not settle the actor's power."), ["sources_do_not_settle"]);
  assert.deepEqual(obligationPartialFacets([{ coverage: 1, complete: true }, { coverage: 0.25, complete: false }]), ["obligation:2:coverage=0.25"]);
});

test("first draft record is frozen", () => {
  const draft = freezeFirstDraft({
    answerText: "Bottom line: Synthetic.", claimVerdicts: [{ id: "c1", supported: true, reason: "ok" }], citations: ["QX 1"],
  });
  assert.equal(Object.isFrozen(draft), true);
  assert.throws(() => { (draft as { answerText: string }).answerText = "changed"; });
});

test("free-tier chain is Gemini only unless a non-Gemini fallback is opted in", async () => {
  const previous = {
    mode: process.env.OPEN_ORDER_INFERENCE_MODE,
    models: process.env.GEMINI_FREE_TIER_MODELS,
    model: process.env.GEMINI_MODEL,
    allow: process.env.OPEN_ORDER_ALLOW_NON_GEMINI,
    override: process.env.AI_ROUTE_OVERRIDE,
  };
  process.env.OPEN_ORDER_INFERENCE_MODE = "";
  delete process.env.GEMINI_FREE_TIER_MODELS;
  delete process.env.GEMINI_MODEL;
  delete process.env.OPEN_ORDER_ALLOW_NON_GEMINI;
  delete process.env.AI_ROUTE_OVERRIDE;
  try {
    assert.deepEqual(getAiCandidates("answer.generate"), ["gemini"]);
    const chain = geminiFreeTierChain();
    assert.ok(chain.every((model) => model.startsWith("gemini-")));
    assert.ok(chain.includes("gemini-3.5-flash-lite"));
    process.env.OPEN_ORDER_ALLOW_NON_GEMINI = "1";
    assert.deepEqual(getAiCandidates("answer.generate"), ["gemini", "openai-compatible"]);
    delete process.env.OPEN_ORDER_ALLOW_NON_GEMINI;
    process.env.AI_ROUTE_OVERRIDE = "openai-compatible";
    assert.throws(() => getAiCandidates("query.plan"), /OPEN_ORDER_ALLOW_NON_GEMINI/);
    const calls: string[] = [];
    await assert.rejects(runGeminiChain(async (model) => {
      calls.push(model);
      throw new AiProviderError({ message: "limited", kind: "rate_limited", statusCode: 429, retryable: true, provider: "gemini" });
    }, { sleep: async () => undefined }));
    assert.ok(calls.length >= 2);
    assert.notEqual(calls[0], calls[calls.length - 1]);
  } finally {
    process.env.OPEN_ORDER_INFERENCE_MODE = previous.mode;
    if (previous.models === undefined) delete process.env.GEMINI_FREE_TIER_MODELS; else process.env.GEMINI_FREE_TIER_MODELS = previous.models;
    if (previous.model === undefined) delete process.env.GEMINI_MODEL; else process.env.GEMINI_MODEL = previous.model;
    if (previous.allow === undefined) delete process.env.OPEN_ORDER_ALLOW_NON_GEMINI; else process.env.OPEN_ORDER_ALLOW_NON_GEMINI = previous.allow;
    if (previous.override === undefined) delete process.env.AI_ROUTE_OVERRIDE; else process.env.AI_ROUTE_OVERRIDE = previous.override;
  }
});

test("planner route ignores opening words and relations come from the situation", () => {
  assert.equal(routeFromPlanner("incident"), "incident_adjudication");
  assert.equal(routeFromPlanner(undefined), "semantic_selector");
  assert.equal(mustAdjudicateFromPlanner(undefined, true), false);
  assert.equal(mustAdjudicateFromPlanner("incident", true), true);
  assert.deepEqual(relationsFromPlanner({
    intent: "admissibility",
    situation: { decisionQuestion: "May the actor do this after the stage closes?", action: "alter the record" },
  }).includes("permission"), true);
  assert.deepEqual(authorisingRuleQueries({ action: "emit a beacon", decisionQuestion: "May they emit a beacon?" }), ["emit a beacon"]);
  assert.deepEqual(stageReopeningQueries({ proceduralMoment: "after the stage closed", action: "alter the text", decisionQuestion: "" }), ["reopening a concluded stage"]);
  assert.deepEqual(proceedingConsequenceQueries({ decisionQuestion: "Is there immunity for the speech?", action: "", setting: "debate", proceduralMoment: "" }), ["privilege and immunity of proceedings"]);
  assert.deepEqual(errorCorrectionQueries({ decisionQuestion: "Can the recorded vote be corrected for error?", action: "correct" }), ["correction of an erroneous recorded outcome"]);
});

test("generic witnesses, anchors, tables and citation hygiene", () => {
  assert.equal(quoteAttestsActAndObject("The actor may emit a beacon.", "emit a beacon"), true);
  assert.equal(quoteAttestsActAndObject("Carrying a device is permitted.", "emit a beacon"), false);
  assert.equal(procedureHomonymMismatch("members cast a division", "dividing a bill"), "procedure-homonym");
  assert.equal(procedureHomonymMismatch("dividing a bill", "dividing a bill"), null);
  assert.equal(forumIdentityMismatch("committee of the whole", ["select committees"]), "forum-identity");
  assert.equal(forumIdentityMismatch("the chamber", ["rules of debate"]), null);
  assert.equal(usableSourceAnchor("None"), null);
  assert.equal(usableSourceAnchor("  "), null);
  assert.equal(usableSourceAnchor("so-12"), "so-12");
  assert.equal(isStructuredTableRow("Each participant: 10 minutes"), true);
  assert.equal(tableVocabularyCovers("speaking time limits", "Debates", ["Time limits for speeches"], "Each member: 10 minutes"), true);
  assert.equal(normaliseNumberWords("twenty eight"), "28");
  assert.equal(dutyVersusDiscretion("The officer must act."), "duty");
  assert.equal(negativePowerWitnessScore({
    actor: "presiding officer", act: "compel a reply",
    source: "The presiding officer cannot compel a reply.",
  }) > 0, true);
  assert.notEqual(negativePowerWitnessScore({
    actor: "presiding officer", act: "compel a reply",
    source: "The presiding officer cannot compel a reply.",
  }), 0.96);
  assert.equal(powerGrantedToDifferentBody("the primary body", "The other committee may call for views."), true);
  assert.equal(exceptionNamesAuthorisingBody("unless the presiding officer authorises it"), true);
  assert.equal(describesStandingOrdersAsStatute("Standing Orders are a statute."), true);
  assert.equal(labelBareRulings("See 49/5 for the limit."), "See Speakers' ruling 49/5 for the limit.");
  assert.equal(labelBareRulings("See [49/5]."), "See [49/5].");
  const dropped = dropUnreferencedCitationEntries("Bottom line:\nThe rule applies. [QX 1]\n\nBest authorities to inspect or cite:\n- [QX 1] governing\n- [QX 9] unused");
  assert.ok(dropped.dropped.includes("QX 9"));
  assert.ok(!dropped.text.includes("QX 9"));
  assert.deepEqual(conditionalSubIssueGaps("Bottom line:\nIf the condition holds, the step follows."), ["who_decides", "discretion", "consequence"]);
  assert.equal(actorClassDrift("The visitor may enter.", "The member may enter."), true);
  assert.equal(isBoundedSearchFocus("so-12"), true);
  assert.equal(isBoundedSearchFocus("../so-12"), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { openGovernedAnswerStream } from "../lib/open-order/answer-stream";
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
  servedModelFromAttempts,
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
  const stream = openGovernedAnswerStream({
    deadlineMs: 40,
    heartbeatMs: 10,
    bindSend: (raw) => (event, data) => raw(event, data),
    work: () => new Promise<void>(() => undefined),
  });
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    const next = await reader.read();
    if (next.done) break;
    buffer += decoder.decode(next.value);
  }
  chunks.push(...buffer.split("\n\n"));
  assert.equal(chunks.filter((chunk) => chunk.includes("event: error")).length, 1);
  assert.ok(chunks.some((chunk) => chunk.startsWith(": heartbeat")));
  assert.match(buffer, /deadline_exceeded/);
});

test("a completed stream is not followed by a second terminal", async () => {
  const stream = openGovernedAnswerStream({
    deadlineMs: 500,
    heartbeatMs: 200,
    bindSend: (raw) => (event, data) => raw(event, data),
    work: async (send) => { send("done", { ok: true }); },
  });
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    buffer += decoder.decode(next.value);
  }
  assert.equal(buffer.split("event:").length - 1, 1);
});

test("outcome flags keep fallback separate from partial", () => {
  const partial = deriveAnswerOutcome({
    route: "semantic_selector", fallbackReason: "none", partial: ["sources_do_not_settle"], abstained: false,
  });
  assert.equal(partial.degraded, false);
  const gap = deriveAnswerOutcome({
    route: "semantic_selector", fallbackReason: "none", partial: ["evidence_gap"], abstained: false,
  });
  assert.equal(gap.degraded, true);
  const withheld = deriveAnswerOutcome({
    route: "semantic_selector", fallbackReason: "none", partial: ["partial"], abstained: false,
  });
  assert.equal(withheld.degraded, true);
  assert.equal(partial.fallbackReason, "none");
  assert.deepEqual(partial.partial, ["sources_do_not_settle"]);
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
    assert.equal(chain[0], "gemini-3.6-flash");
    assert.equal(chain[1], "gemini-3.5-flash-lite");
    process.env.OPEN_ORDER_ALLOW_NON_GEMINI = "1";
    assert.deepEqual(getAiCandidates("answer.generate"), ["gemini", "openai-compatible"]);
    delete process.env.OPEN_ORDER_ALLOW_NON_GEMINI;
    process.env.AI_ROUTE_OVERRIDE = "openai-compatible";
    assert.throws(() => getAiCandidates("query.plan"), /OPEN_ORDER_ALLOW_NON_GEMINI/);
    const attempts: Array<{ model: string; outcome: string }> = [];
    const answered = await runGeminiChain(async (model) => {
      if (model === "gemini-3.6-flash") {
        throw new AiProviderError({ message: "limited", kind: "rate_limited", statusCode: 429, retryable: true, provider: "gemini" });
      }
      return "answered";
    }, { sleep: async () => undefined, onAttempt: (attempt) => attempts.push(attempt) });
    assert.equal(answered, "answered");
    assert.equal(attempts[0]?.model, "gemini-3.6-flash");
    assert.equal(attempts[0]?.outcome, "429");
    assert.equal(attempts.at(-1)?.model, "gemini-3.5-flash-lite");
    assert.equal(attempts.at(-1)?.outcome, "ok");
    assert.ok(attempts.slice(0, -1).every((attempt) => attempt.outcome === "429"));
    assert.equal(servedModelFromAttempts(attempts), "gemini-3.5-flash-lite");
  } finally {
    process.env.OPEN_ORDER_INFERENCE_MODE = previous.mode;
    if (previous.models === undefined) delete process.env.GEMINI_FREE_TIER_MODELS; else process.env.GEMINI_FREE_TIER_MODELS = previous.models;
    if (previous.model === undefined) delete process.env.GEMINI_MODEL; else process.env.GEMINI_MODEL = previous.model;
    if (previous.allow === undefined) delete process.env.OPEN_ORDER_ALLOW_NON_GEMINI; else process.env.OPEN_ORDER_ALLOW_NON_GEMINI = previous.allow;
    if (previous.override === undefined) delete process.env.AI_ROUTE_OVERRIDE; else process.env.AI_ROUTE_OVERRIDE = previous.override;
  }
});

test("a non-retryable primary error falls back once to flash-lite", async () => {
  const previous = process.env.OPEN_ORDER_INFERENCE_MODE;
  const previousModel = process.env.GEMINI_MODEL;
  process.env.OPEN_ORDER_INFERENCE_MODE = "";
  delete process.env.GEMINI_MODEL;
  try {
    const attempts: Array<{ model: string; outcome: string }> = [];
    const answered = await runGeminiChain(async (model) => {
      if (model === "gemini-3.6-flash") {
        throw new AiProviderError({ message: "bad request", kind: "upstream", statusCode: 400, retryable: false, provider: "gemini" });
      }
      return "answered";
    }, { sleep: async () => undefined, onAttempt: (attempt) => attempts.push(attempt) });
    assert.equal(answered, "answered");
    assert.deepEqual(attempts.map((attempt) => attempt.outcome), ["other", "ok"]);
    assert.equal(attempts[0]?.model, "gemini-3.6-flash");
    assert.equal(attempts[1]?.model, "gemini-3.5-flash-lite");
  } finally {
    if (previous === undefined) delete process.env.OPEN_ORDER_INFERENCE_MODE;
    else process.env.OPEN_ORDER_INFERENCE_MODE = previous;
    if (previousModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = previousModel;
  }
});

test("auth and missing-model errors do not fall through to another model", async () => {
  const previous = process.env.OPEN_ORDER_INFERENCE_MODE;
  const previousModel = process.env.GEMINI_MODEL;
  process.env.OPEN_ORDER_INFERENCE_MODE = "";
  delete process.env.GEMINI_MODEL;
  try {
    for (const statusCode of [401, 403, 404]) {
      const attempts: Array<{ model: string; outcome: string }> = [];
      await assert.rejects(() => runGeminiChain(async () => {
        throw new AiProviderError({ message: "denied", kind: "upstream", statusCode, retryable: false, provider: "gemini" });
      }, { sleep: async () => undefined, onAttempt: (attempt) => attempts.push(attempt) }));
      assert.deepEqual(attempts.map((attempt) => attempt.model), ["gemini-3.6-flash"]);
      assert.deepEqual(attempts.map((attempt) => attempt.outcome), ["other"]);
    }
  } finally {
    if (previous === undefined) delete process.env.OPEN_ORDER_INFERENCE_MODE;
    else process.env.OPEN_ORDER_INFERENCE_MODE = previous;
    if (previousModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = previousModel;
  }
});

test("servedModel on a failed path is the last model started, not a success", () => {
  const attempts = [{ model: "gemini-3.6-flash", outcome: "other" }];
  assert.equal(servedModelFromAttempts(attempts), "gemini-3.6-flash");
  assert.notEqual(attempts[0]?.outcome, "ok");
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
  assert.deepEqual(stageReopeningQueries({ relations: ["stage_reopening"] }), ["reopening a concluded stage"]);
  assert.deepEqual(proceedingConsequenceQueries({ relations: ["proceeding_consequence"] }), ["privilege and immunity of proceedings"]);
  assert.deepEqual(errorCorrectionQueries({ relations: ["error_correction"] }), ["correction of an erroneous recorded outcome"]);
  assert.deepEqual(stageReopeningQueries({ relations: [] }), []);
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
  assert.equal(labelBareRulings("A 2/3 majority is required.", [{ citationLabel: "2/3", documentCorpus: "speakers_rulings" }]), "A 2/3 majority is required.");
  assert.equal(labelBareRulings("The limit is 49/5.", [{ citationLabel: "49/5", documentCorpus: "speakers_rulings" }]), "The limit is Speakers' ruling 49/5.");
  assert.equal(labelBareRulings("See [49/5].", [{ citationLabel: "49/5", documentCorpus: "speakers_rulings" }]), "See [49/5].");
  const dropped = dropUnreferencedCitationEntries("Bottom line:\nThe rule applies. [QX 1]\n\nBest authorities to inspect or cite:\n- [QX 1] governing\n- [QX 9] unused");
  assert.ok(dropped.dropped.includes("QX 9"));
  assert.ok(!dropped.text.includes("QX 9"));
  assert.deepEqual(conditionalSubIssueGaps("Bottom line:\nIf the condition holds, the step follows."), ["who_decides", "discretion", "consequence"]);
  assert.equal(actorClassDrift("The visitor may enter.", "The member may enter."), true);
  assert.equal(isBoundedSearchFocus("so-12"), true);
  assert.equal(isBoundedSearchFocus("../so-12"), false);
});

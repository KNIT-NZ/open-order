import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NextRequest } from "next/server";
import type { AiGenerateJsonRequest, AiStreamTextRequest } from "../lib/ai/types";
import type { ProceduralSearchResponse, ProceduralSearchResult } from "../lib/procedural-search";
import { EMPTY_AI_DIAGNOSTICS } from "../lib/open-order/types";
import { formatAiDebugSnapshot } from "../lib/open-order/format";
import { publicFailureReason } from "../lib/ai/provider-resilience";
import {
  attachClaimQualifications,
  firstDraftDebugEnabled,
  pruneValidatedAnswerContent,
  validateAnswerCitations,
  mentionRewriteEdit,
  rewriteForbiddenAuthorityMentions,
  validateAnswerAuthorityMentions,
  withholdingStage,
  buildFallbackAnswer,
} from "../lib/procedural-reasoning";

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgresql://localhost/open_order_route_test?sslmode=disable";
}

const QUOTE = "The House may suspend the sitting when the Speaker so decides.";

test("an unretrieved subsection is rewritten without a dangling fragment", () => {
  const rewritten = rewriteForbiddenAuthorityMentions({
    answerText: "The motion is subject to Standing Order 39(1) [SO 146].",
    authorities: [{ citationLabel: "SO 146" }],
  });
  assert.match(rewritten.rewrittenText, /a provision that was not retrieved/);
  assert.equal(rewritten.rewrittenText.includes("39"), false);
  assert.equal(rewritten.rewrittenText.includes("(1)"), false);
  assert.equal(rewritten.rewrittenText.includes("the retrieved authority"), false);
  assert.equal(rewritten.rewrittenText.includes("referred to in"), false);
  assert.equal(validateAnswerAuthorityMentions({
    answerText: rewritten.rewrittenText,
    authorities: [{ citationLabel: "SO 146" }],
  }).ok, true);
});

test("a model-written cross-reference suffix does not make an unretrieved provision valid", () => {
  const text = "Standing Order 99 (referred to in SO 1; not retrieved) lets the Speaker adjourn the House [SO 1]";
  const checked = validateAnswerAuthorityMentions({
    answerText: text,
    authorities: [{ citationLabel: "SO 1" }],
  });
  assert.equal(checked.ok, false);
  const rewritten = rewriteForbiddenAuthorityMentions({
    answerText: text,
    authorities: [{ citationLabel: "SO 1" }],
  });
  assert.equal(rewritten.rewrittenText.includes("Standing Order 99"), false);
  assert.equal(rewritten.rewrittenText.includes("referred to in SO 1"), false);
  assert.match(rewritten.rewrittenText, /a provision that was not retrieved/);
});

test("tolerant provision forms are detected and a range is rewritten as one unit", () => {
  const admitted = [{ citationLabel: "SO 1" }];
  for (const text of [
    "S.O. 99",
    "Standing  Order 99",
    "SO99",
    "Standing\u00a0Order 99",
    "Standing Orders 39 and 40",
    "Standing Orders 39 to 41",
  ]) {
    assert.equal(validateAnswerAuthorityMentions({ answerText: text, authorities: admitted }).ok, false, text);
  }
  const range = rewriteForbiddenAuthorityMentions({
    answerText: "See SO 39-41 before the House sits [SO 1].",
    authorities: admitted,
  });
  assert.equal(range.rewrittenText.includes("-41"), false);
  assert.equal(range.rewrittenText.includes("SO 39"), false);
  assert.match(range.rewrittenText, /a provision that was not retrieved/);
  const labelled = rewriteForbiddenAuthorityMentions({
    answerText: "Apply SR 2/3 to the sitting.",
    authorities: [{ citationLabel: "SR 2/3" }],
  });
  assert.equal(labelled.removedMentions.length, 0);
  assert.match(labelled.rewrittenText, /SR 2\/3/);
  const bare = rewriteForbiddenAuthorityMentions({
    answerText: "Apply 2/3 to the sitting.",
    authorities: [{ citationLabel: "2/3" }],
  });
  assert.equal(bare.removedMentions.length, 0);
  assert.match(bare.rewrittenText, /2\/3/);
  for (const text of ["SO 1-99", "SO 1–99", "Standing Orders 1 and 99", "Standing Orders 1, 99, and 100", "Standing Orders 1 or 99", "Standing Orders 1 & 99", "Standing Orders 1 through 99", "Standing Order No. 99", "Standing-Order 99"]) {
    const gap = rewriteForbiddenAuthorityMentions({ answerText: `See ${text} [SO 1].`, authorities: admitted });
    assert.equal(gap.rewrittenText.includes("99"), false, text);
    assert.match(gap.rewrittenText, /a provision that was not retrieved/, text);
  }
  for (const text of [
    "Under SO 1 and 2 members",
    "Under SO 1, 40 members must be present",
    "Under SO 1 to 3 days notice",
    "under SO 1 [SO 1] and 2 members may object",
    "under SO 1 [SO 1] - 2 members may object",
    "under SO 1 [SO 1] to 3 members may object",
  ]) {
    const kept = rewriteForbiddenAuthorityMentions({ answerText: text, authorities: admitted });
    assert.equal(kept.removedMentions.length, 0, text);
    assert.equal(kept.rewrittenText, text, text);
    assert.equal(validateAnswerAuthorityMentions({ answerText: text, authorities: admitted }).ok, true, text);
  }
  for (const gap of ["\n", "\u2009", "\u202f", "\u200b"]) {
    assert.equal(validateAnswerAuthorityMentions({
      answerText: `Read SO${gap}99 before sitting.`,
      authorities: admitted,
    }).ok, false, JSON.stringify(gap));
  }
  const ruling = rewriteForbiddenAuthorityMentions({
    answerText: "Speakers' ruling 2/9 lets the House sit [SO 2].",
    authorities: [{ citationLabel: "SO 2" }],
  });
  assert.equal(ruling.rewrittenText.includes("2/9"), false);
  assert.match(ruling.rewrittenText, /a provision that was not retrieved/);
});

test("a fraction after a standing-order number is still checked as a ruling", () => {
  const admitted = [{ citationLabel: "SO 1" }, { citationLabel: "SO 2" }];
  for (const text of ["S.O. 2/9", "Standing Order 2/9", "Standing Orders 1/99", "SO 1, 2/3"]) {
    const checked = validateAnswerAuthorityMentions({ answerText: text, authorities: admitted });
    assert.equal(checked.ok, false, text);
    assert.ok(checked.ok === false && checked.invalidAuthorityMentions.some((mention) => /\d\/\d/.test(mention)), text);
  }
});

test("a range is rewritten without attaching its first admitted label", () => {
  const rewritten = rewriteForbiddenAuthorityMentions({
    answerText: "Under SO 1-99",
    authorities: [{ citationLabel: "SO 1" }],
  });
  assert.match(rewritten.rewrittenText, /a provision that was not retrieved/);
  assert.equal(rewritten.rewrittenText.includes("[SO 1]"), false);
  assert.equal(rewritten.rewrittenText.includes("SO 1"), false);
  const labelled = pruneValidatedAnswerContent({
    answerText: "Bottom line:\nStanding Orders 1 and 2 both apply.",
    authorities: [{ citationLabel: "SO 1" }, { citationLabel: "SO 2" }],
  }).prunedText;
  assert.match(labelled, /Standing Orders 1 and 2/);
  assert.match(labelled, /\[SO 1\]/);
  assert.match(labelled, /\[SO 2\]/);
});

test("a mixed citation bracket does not treat the unadmitted label as cited", () => {
  const authorities = [{ citationLabel: "SO 1" }];
  for (const text of ["[SO 1 and SO 99]", "[SO 1, SO 99]", "[SO 1; SR 2/9]"]) {
    const checked = validateAnswerCitations({ answerText: `The House may sit ${text}.`, authorities });
    assert.equal(checked.ok, false, text);
  }
});

test("stripping a model suffix from an admitted label is counted", () => {
  const rewritten = rewriteForbiddenAuthorityMentions({
    answerText: "Apply SO 1 (referred to in SO 99; not retrieved).",
    authorities: [{ citationLabel: "SO 1" }],
  });
  assert.equal(rewritten.removedMentions.length, 1);
  assert.equal(rewritten.rewrittenText.includes("referred to in"), false);
  assert.match(rewritten.rewrittenText, /\bSO 1\b/);
  assert.equal(mentionRewriteEdit(100), "removed_mentions=99");
});

test("a long digit run after SO stays linear", () => {
  const started = performance.now();
  validateAnswerAuthorityMentions({
    answerText: `SO ${"1".repeat(100_000)}`,
    authorities: [{ citationLabel: "SO 1" }],
  });
  validateAnswerAuthorityMentions({
    answerText: "9".repeat(100_000),
    authorities: [{ citationLabel: "SO 1" }],
  });
  assert.ok(performance.now() - started < 500);
});

test("mention checks stay linear in the number of mentions", () => {
  const authorities = Array.from({ length: 8 }, (_, index) => ({
    citationLabel: `SO ${index + 1}`,
  }));
  const answerText = Array.from({ length: 4000 }, (_, index) => `See Standing Order ${1000 + index}.`).join(" ");
  const started = performance.now();
  const checked = validateAnswerAuthorityMentions({ answerText, authorities });
  rewriteForbiddenAuthorityMentions({ answerText, authorities });
  assert.equal(checked.ok, false);
  assert.ok(performance.now() - started < 500);
});

test("a bare number in an admitted source is not a provision reference", () => {
  const rewritten = rewriteForbiddenAuthorityMentions({
    answerText: "The motion is subject to Standing Order 39 [SO 1].",
    authorities: [{ citationLabel: "SO 1" }],
  });
  assert.equal(rewritten.rewrittenText.includes("Standing Order 39"), false);
  assert.equal(rewritten.rewrittenText.includes("referred to in SO 1"), false);
  assert.match(rewritten.rewrittenText, /a provision that was not retrieved/);
});

test("an invented authority number is named as a gap and is not counted as question text", () => {
  const rewritten = rewriteForbiddenAuthorityMentions({
    answerText: "Unlike Standing Order 99(2), the House may sit [SO 1].",
    authorities: [{ citationLabel: "SO 1" }],
  });
  assert.equal(rewritten.rewrittenText.includes("99"), false);
  assert.equal(rewritten.rewrittenText.includes("(2)"), false);
  assert.equal(rewritten.rewrittenText.includes("the retrieved authority"), false);
  assert.match(rewritten.rewrittenText, /a provision that was not retrieved/);
  assert.equal(rewritten.removedMentions.length, 1);
});

test("only an exact provision form attaches an admitted label", () => {
  const labels = new Set(["SO 1", "2/3"]);
  const kept = (line: string) => pruneValidatedAnswerContent({
    answerText: `Bottom line:\n${line}`,
    authorities: [...labels].map((citationLabel) => ({ citationLabel })),
  }).prunedText;
  assert.match(kept("The House may suspend the sitting under Standing Order 1."), /\[SO 1\]/);
  assert.match(kept("The House may suspend the sitting under SO 1."), /\[SO 1\]/);
  assert.match(kept("The Speaker applied Speakers' ruling 2/3."), /\[2\/3\]/);
  assert.match(kept("The Speaker applied SR 2/3."), /\[2\/3\]/);
  assert.match(kept("The member may act under SO 1(2)."), /\[SO 1\]/);
  assert.match(kept("The member may act under Standing Order 1(2)."), /\[SO 1\]/);
  assert.equal(kept("and so 1 member may object").includes("[SO 1]"), false);
  assert.equal(kept("a 2/3 majority is required").includes("[2/3]"), false);
  assert.equal(kept("Standing Order 99 (referred to in SO 1; not retrieved) lets the Speaker adjourn.").includes("[SO 1]"), false);
  assert.equal(kept("Speakers' ruling 2/9 applies to the sitting.").includes("[SO 2]"), false);
});

test("an uncited uncertain source is named in the qualification section", () => {
  const attached = attachClaimQualifications([
    "Bottom line:",
    "The House must publish the order paper [SO 1].",
  ].join("\n"), { actLabels: ["SO 2"] });
  const bottom = attached.split("\n").find((line) => line.includes("order paper")) ?? "";
  assert.equal(bottom.includes("has not been confirmed"), false);
  assert.match(attached, /Qualification:\n\[SO 2\] has not been confirmed to govern the specific act asked about/);
});

test("a qualification stays on the uncertain claim and off the settled provision", () => {
  const attached = attachClaimQualifications([
    "Bottom line:",
    "The House must publish the order paper [SO 1].",
    "",
    "What this means:",
    "The member may suspend the sitting [SO 2].",
  ].join("\n"), { actLabels: ["SO 2"] });
  assert.match(attached, /\[SO 2\] has not been confirmed to govern the specific act asked about/);
  assert.equal(attached.includes("Qualification:"), false);
  const settled = attached.split("\n").find((line) => line.includes("[SO 1]")) ?? "";
  assert.equal(settled.includes("has not been confirmed"), false);
});

test("the first-draft debug flag is off in every production environment", () => {
  assert.equal(firstDraftDebugEnabled({ OPEN_ORDER_DEBUG_FIRST_DRAFT: "1", NODE_ENV: "test" }), true);
  assert.equal(firstDraftDebugEnabled({ OPEN_ORDER_DEBUG_FIRST_DRAFT: "1", NODE_ENV: "production" }), false);
  assert.equal(firstDraftDebugEnabled({ OPEN_ORDER_DEBUG_FIRST_DRAFT: "1", NODE_ENV: "test", VERCEL_ENV: "production" }), false);
  assert.equal(firstDraftDebugEnabled({ NODE_ENV: "test" }), false);
});

test("a provider failure reason is a code and the fallback names the draft", () => {
  const reason = publicFailureReason({
    phase: "post_validation",
    kind: "provider_transient",
    httpStatus: 500,
    code: null,
    provider: "gemini",
    upstreamErrorName: null,
    retryable: true,
    attempts: 2,
    elapsedMs: 10,
  });
  assert.equal(reason, "validation_unavailable");
  assert.equal(reason.includes("HTTP"), false);
  assert.equal(reason.includes("attempts"), false);
  const text = buildFallbackAnswer({
    question: "synthetic",
    planIntent: "explain_rule",
    authorities: [{
      sectionId: "s1", sectionKey: "s1", citationLabel: "SO 1", heading: "Suspension",
      path: ["House"], pathText: "House", documentSlug: "standing-orders",
      documentTitle: "Standing Orders", documentCorpus: "standing_orders",
      sourceUrl: null, sourceAnchor: null, rank: 1, sectionRank: 1, pathRank: 0,
      bodyRank: 0, chunkRank: null, clusterSupportCount: 1, sectionContent: QUOTE,
      matchSignals: {
        exactSectionKeyMatch: false, exactCitationMatch: false, exactHeadingMatch: false,
        bodyPhraseMatch: false, pathPhraseMatch: false, headingPhraseMatch: false,
      },
    }],
    effectiveCorpus: null,
    fallbackReason: "validation_unavailable",
  });
  assert.match(text, /drafted answer did not pass the checks/);
  assert.equal(text.includes("do not support a fuller"), false);
});

test("the shown list, not every admitted source, is the final authority count", () => {
  const authority = {
    sectionId: "s1", sectionKey: "s1", citationLabel: "SO 1", heading: null, path: ["House"],
    documentSlug: "standing-orders", documentTitle: "Standing Orders", documentCorpus: "standing_orders",
    sourceUrl: null, sourceAnchor: null, sourceHref: null, rank: 1,
  };
  const snapshot = formatAiDebugSnapshot({
    ...EMPTY_AI_DIAGNOSTICS,
    authorities: [authority],
    selectorSummary: {
      candidateCount: 2,
      minObligationCoverage: 1,
      allObligationsComplete: true,
      obligationDetails: [],
      prePruneCount: 2,
      selectedLabels: ["SO 1", "SO 2"],
    },
  });
  assert.match(snapshot, /Final authorities selected: SO 1\n/);
  const none = formatAiDebugSnapshot({
    ...EMPTY_AI_DIAGNOSTICS,
    authorities: [],
    selectorSummary: {
      candidateCount: 1,
      minObligationCoverage: 1,
      allObligationsComplete: true,
      obligationDetails: [],
      prePruneCount: 1,
      selectedLabels: ["SO 1"],
    },
  });
  assert.match(none, /Final authorities selected: None/);
  const panel = readFileSync(new URL("../components/open-order/AssistantPanel.tsx", import.meta.url), "utf8");
  assert.match(panel, /Final authorities:[\s\S]{0,120}assistant\.authorities\.length/);
});

test("a failed recovery witness is named as recovery, not selection", () => {
  assert.equal(withholdingStage({
    adjudicated: true,
    recoveryRan: false,
    recoveryStatus: "v40_no_governing_witness",
  }), "recovery");
});

type RunAnswerRoute = typeof import("../app/api/ai/answer/route").runAnswerRoute;
let runAnswerRoute: RunAnswerRoute | undefined;
async function loadAnswerRoute(): Promise<RunAnswerRoute> {
  runAnswerRoute ??= (await import("../app/api/ai/answer/route")).runAnswerRoute;
  return runAnswerRoute;
}

function source(sectionContent = QUOTE, citationLabel = "SO 1"): ProceduralSearchResult {
  return {
    sectionId: "s1",
    sectionKey: "s1",
    citationLabel,
    heading: "Suspension",
    path: ["Chapter 2", "Sittings of the House"],
    pathText: "Chapter 2 / Sittings of the House",
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
    sectionContent,
    matchSignals: {
      exactSectionKeyMatch: false, exactCitationMatch: false, exactHeadingMatch: false,
      bodyPhraseMatch: false, pathPhraseMatch: false, headingPhraseMatch: false,
    },
  };
}

async function probe(
  mode: "no_grounded_claims" | "no_authority_selected" | "named_admitted_source" | "forged_suffix",
  options?: { sectionContent?: string; draft?: string; repairText?: string; bottomLine?: string; admit?: boolean; citationLabel?: string },
) {
  const admitted = source(options?.sectionContent, options?.citationLabel);
  const draft = options?.draft ?? (mode === "forged_suffix"
    ? "Bottom line:\nStanding Order 99 (referred to in SO 1; not retrieved) lets the Speaker adjourn the House [SO 1].\n\nWhat this means:\nThe House may suspend the sitting [SO 1].\n\nSettlement: supported"
    : mode === "named_admitted_source"
    ? "Bottom line:\nThe House may suspend the sitting under Standing Order 1.\n\nSettlement: supported"
    : mode === "no_grounded_claims"
    ? "Bottom line:\nThe House may suspend the sitting.\n\nBest authorities to inspect or cite:\n- [SO 1] Suspension\n\nSettlement: supported"
    : `Bottom line:\n${QUOTE} [SO 1]\n\nSettlement: supported`);
  const generateJson = async <T,>(request: AiGenerateJsonRequest): Promise<T> => {
    request.onProviderAttemptStart?.("gemini-3.5-flash-lite");
    if (request.systemInstruction.includes("ONLY planning targeted retrieval")) {
      const value = {
        intent: "explain_rule",
        preferredCorpus: null,
        searchQueries: ["suspension of the sitting"],
        salientTerms: ["suspension"],
        notes: "synthetic",
        situation: {
          kind: mode === "no_authority_selected" || options?.admit ? "incident" : "procedure",
          actor: "member",
          setting: "the House",
          action: "suspend the sitting",
          affectedPerson: "",
          proceduralMoment: "debate",
          decisionQuestion: "May the House suspend the sitting?",
          materialFacts: mode === "no_authority_selected" || options?.admit ? ["an occurrence was recorded"] : [],
          verb: "suspend",
          object: "sitting",
        },
      };
      request.validate?.(value);
      request.onProviderAttempt?.({ model: "gemini-3.5-flash-lite", outcome: "ok" });
      return value as T;
    }
    if (options?.bottomLine && request.systemInstruction.includes("repair a missing Bottom line")) {
      const value = { bottomLine: options.bottomLine };
      request.validate?.(value);
      request.onProviderAttempt?.({ model: "gemini-3.5-flash-lite", outcome: "ok" });
      return value as T;
    }
    if (request.systemInstruction.includes("PROCEDURAL SOURCE adjudicator")) {
      const value = options?.admit
        ? {
          selected: [{
            citationLabel: options?.citationLabel ?? "SO 1", role: "governing", exactQuote: QUOTE,
            actorMatches: true, settingMatches: true, actionMatches: true, stageMatches: true,
            rationale: "governs the sitting",
          }],
          remainingUncertainties: [], explanation: "quoted",
        }
        : { selected: [], remainingUncertainties: [], explanation: "none nominated" };
      request.validate?.(value);
      request.onProviderAttempt?.({ model: "gemini-3.5-flash-lite", outcome: "ok" });
      return value as T;
    }
    const found = [...request.prompt.matchAll(/^(claim-\d+)\nClaim: (.+)$/gm)];
    const value = {
      claims: found.map((match) => ({ id: match[1], supported: true, reason: "checked" })),
      responsiveness: { answersUserQuestion: true, reason: "fits", unaddressedParts: [] as string[] },
    };
    request.validate?.(value);
    request.onProviderAttempt?.({ model: "gemini-3.5-flash-lite", outcome: "ok" });
    return value as T;
  };
  const streamText = async (request: AiStreamTextRequest): Promise<string> => {
    request.onProviderAttemptStart?.("gemini-3.5-flash-lite");
    request.onProviderAttempt?.({ model: "gemini-3.5-flash-lite", outcome: "ok" });
    if (options?.repairText && request.systemInstruction.includes("repairing an incomplete")) return options.repairText;
    return draft;
  };
  const response = await (await loadAnswerRoute())(
    new NextRequest("http://localhost/api/ai/answer", {
      method: "POST",
      body: JSON.stringify({ question: "May the House suspend the sitting?" }),
    }),
    {
      generateJson,
      streamText,
      searchProceduralAuthorities: async (): Promise<ProceduralSearchResponse> => ({
        query: "suspension", corpus: null, limit: 10, offset: 0, total: 1, hasMore: false, results: [admitted],
      }),
      loadHeadings: async () => [],
      selectV517ProductionAuthorities: async () => ({
        finalAuthorities: [admitted],
        prePruneLabels: [], selectedLabels: [], prunedRedundant: [],
        minObligationCoverage: 1, allObligationsComplete: true,
        obligationDetails: [{ coverage: 1, complete: true }],
        candidateCount: 1, evidenceAdmission: "synthetic", rejectedAuthorities: [],
      }),
    },
  );
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  for (const block of (await response.text()).split("\n\n")) {
    let event = "";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) event = line.slice(7).trim();
      else if (line.startsWith("data: ")) data.push(line.slice(6));
    }
    if (event && data.length > 0) events.push({ event, data: JSON.parse(data.join("\n")) as Record<string, unknown> });
  }
  const done = events.find((item) => item.event === "done");
  assert.ok(done, "sent a done event");
  return done.data;
}

test("no_grounded_claims records why every uncited claim was removed", async () => {
  const done = await probe("no_grounded_claims");
  assert.equal(done.fallbackCode, "no_grounded_claims");
  assert.equal(done.fallbackReason, "no_grounded_claims");
  assert.equal(done.answerState, "not_answered");
  assert.equal(done.firstDraft, undefined);
  const trace = done.trace as {
    claimRemovalCounts?: Record<string, number>;
    shownAuthorities?: { count: number; unconfirmed: number };
  };
  assert.ok((trace.claimRemovalCounts?.no_citation ?? 0) >= 1);
  assert.equal(JSON.stringify(trace).includes("The House may suspend the sitting."), false);
  const shown = (done.authorities as unknown[]).length;
  assert.equal(trace.shownAuthorities?.count, shown);
});

test("an unretrieved provision is rewritten even when the source text names it", async () => {
  const meaning = `What this means:\n${QUOTE} [SO 1].\n\nSettlement: supported`;
  const quoted = await probe("named_admitted_source", {
    draft: `Bottom line:\nStanding Order 39(1) lets the House sit [SO 1].\n\n${meaning}`,
  });
  assert.notEqual(quoted.answerState, "supported");
  assert.equal(String(quoted.answerText).includes("Standing Order 39"), false);
  assert.match(String(quoted.answerText), /a provision that was not retrieved/);
  assert.equal(String(quoted.answerText).includes("referred to in"), false);
});

test("a ruling number is not treated as the standing order with the same first digit", async () => {
  const done = await probe("named_admitted_source", {
    citationLabel: "SO 2",
    draft: `Bottom line:\nSpeakers' ruling 2/9 lets the House sit [SO 2].\n\nWhat this means:\n${QUOTE} [SO 2].\n\nSettlement: supported`,
  });
  assert.notEqual(done.answerState, "supported");
  assert.equal(String(done.answerText).includes("2/9"), false);
});

test("repair text and a reconstructed bottom line rewrite an unretrieved standing order", async () => {
  const repaired = await probe("named_admitted_source", {
    admit: true,
    draft: `What this means:\n${QUOTE} [SO 1].\n\nSettlement: supported`,
    repairText: `Bottom line:\nStanding Order 39 lets the House sit [SO 1].\n\nWhat this means:\n${QUOTE} [SO 1].\n\nSettlement: supported`,
  });
  assert.notEqual(repaired.answerState, "not_answered");
  assert.equal(String(repaired.answerText).includes("Standing Order 39"), false);
  assert.match(String(repaired.answerText), /a provision that was not retrieved/);
  assert.ok((repaired.answerEdits as string[]).includes("removed_mentions=1"));
  assert.match(String(repaired.rewriteNote), /rewritten_mentions=1/);
  const rebuilt = await probe("named_admitted_source", {
    draft: `What this means:\n${QUOTE} [SO 1].\n\nSettlement: supported`,
    bottomLine: "Standing Order 39 lets the House sit [SO 1].",
  });
  assert.notEqual(rebuilt.answerState, "not_answered");
  assert.equal(String(rebuilt.answerText).includes("Standing Order 39"), false);
  assert.match(String(rebuilt.answerText), /a provision that was not retrieved/);
  assert.ok((rebuilt.answerEdits as string[]).includes("removed_mentions=1"));
  assert.match(String(rebuilt.rewriteNote), /rewritten_mentions=1/);
  const refused = await probe("named_admitted_source", {
    admit: true,
    draft: `What this means:\n${QUOTE} [SO 1].\n\nSettlement: supported`,
    repairText: "Bottom line:\nStanding Order 39 lets the House sit [SO 99].\n\nWhat this means:\nThe House may suspend the sitting [SO 1].",
  });
  assert.equal(String(refused.answerText).includes("a provision that was not retrieved"), false);
  assert.equal(((refused.answerEdits as string[] | undefined) ?? []).some((item) => item.startsWith("removed_mentions")), false);
  const multiline = await probe("named_admitted_source", {
    draft: `What this means:\n${QUOTE} [SO 1].\n\nSettlement: supported`,
    bottomLine: "Standing Order 39 lets the House sit [SO 1].\nA second line [SO 1].",
  });
  assert.equal(multiline.answerState, "not_answered");
  assert.equal(String(multiline.answerText).includes("a provision that was not retrieved"), false);
});

test("a singular standing-order name followed by ordinary words is served unchanged", async () => {
  const sentence = "Under SO 1, 40 members may demand a vote [SO 1].";
  const done = await probe("named_admitted_source", {
    draft: `Bottom line:\n${sentence}\n\nWhat this means:\n${QUOTE} [SO 1].\n\nSettlement: supported`,
  });
  assert.equal(done.answerState, "supported");
  assert.match(String(done.answerText), /Under SO 1, 40 members may demand a vote \[SO 1\]\./);
  assert.equal(((done.answerEdits as string[] | undefined) ?? []).some((item) => item.startsWith("removed_mentions")), false);
});

test("a bracket that names an unadmitted label is not a supported citation", async () => {
  const done = await probe("named_admitted_source", {
    draft: "Bottom line:\nThe House may suspend the sitting [SO 1 and SO 99].\n\nWhat this means:\nThe House may suspend the sitting [SO 1, SO 99].\n\nSettlement: supported",
  });
  assert.equal(done.answerState, "not_answered");
  assert.equal(done.fallbackCode, "prune_emptied_draft");
  const listed = (done.authorities as Array<{ citationLabel?: string }>).map((item) => item.citationLabel);
  assert.equal(listed.includes("SO 99"), false);
});

test("a forged cross-reference suffix does not come back as supported", async () => {
  const done = await probe("forged_suffix");
  assert.notEqual(done.answerState, "supported");
  assert.equal(String(done.answerText).includes("Standing Order 99"), false);
  assert.equal(String(done.answerText).includes("referred to in SO 1"), false);
});

test("a claim that names an admitted source reaches validation", async () => {
  const done = await probe("named_admitted_source");
  assert.notEqual(done.fallbackCode, "no_grounded_claims");
  assert.notEqual(done.fallbackCode, "prune_emptied_draft");
  assert.equal(done.answerState, "supported");
  assert.match(String(done.answerText), /\[SO 1\]/);
});

test("no_authority_selected records a zero nomination as codes", async () => {
  const done = await probe("no_authority_selected");
  assert.equal(done.fallbackCode, "no_authority_selected");
  assert.equal(done.answerState, "not_answered");
  const stages = done.stageModels as Array<{ task?: string }>;
  assert.ok(stages.some((item) => item.task === "scenario.adjudication"));
  assert.equal(stages.some((item) => item.task === "answer.validate"), false);
  const trace = done.trace as {
    adjudication?: { nominationCount: number; dossierOutcomes: string[] };
  };
  assert.equal(trace.adjudication?.nominationCount, 0);
  assert.ok((trace.adjudication?.dossierOutcomes.length ?? 0) >= 1);
  assert.ok(trace.adjudication?.dossierOutcomes.every((code) => code.startsWith("not_nominated:")));
  assert.equal(trace.adjudication?.dossierOutcomes.join(" ").includes("SO 1"), false);
  assert.equal(JSON.stringify(trace).includes(QUOTE), false);
});

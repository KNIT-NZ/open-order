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

test("a multi-digit ruling after an SO name is not read as a shorter standing order", () => {
  const cases = [
    { text: "SO 12/9", labels: ["SO 1"] },
    { text: "S.O. 22/9", labels: ["SO 2"] },
    { text: "Standing Order 19/5", labels: ["SO 1"] },
    { text: "S.O. 12/34", labels: ["SO 1", "SO 12"] },
    { text: "SO 12/3", labels: ["SO 1", "SO 12"] },
    { text: "SO 123/4", labels: ["SO 12"] },
    { text: "Standing Orders 1, 23/4", labels: ["SO 1", "SO 2"] },
  ];
  for (const { text, labels } of cases) {
    const authorities = labels.map((citationLabel) => ({ citationLabel }));
    const checked = validateAnswerAuthorityMentions({ answerText: text, authorities });
    assert.equal(checked.ok, false, text);
    const rewritten = rewriteForbiddenAuthorityMentions({ answerText: `${text} applies.`, authorities });
    assert.equal(rewritten.rewrittenText.includes("Standing Order a provision"), false, text);
    assert.equal(rewritten.rewrittenText.includes("/"), false, text);
  }
});

test("a joined number after one name is a provision unless a quantity word follows", () => {
  const admitted = [{ citationLabel: "SO 1" }];
  for (const text of ["SO 1 & 99", "Standing Order 1 and 99", "SO 1, 99", "SO 1 or 99", "SO 1 to 99", "SO 1 through 99"]) {
    const rewritten = rewriteForbiddenAuthorityMentions({ answerText: text, authorities: admitted });
    assert.equal(rewritten.rewrittenText.includes("99"), false, text);
    assert.equal(rewritten.rewrittenText.includes("Standing Order a provision"), false, text);
    assert.match(rewritten.rewrittenText, /a provision that was not retrieved/, text);
  }
  for (const text of [
    "Under SO 1, 40 members must be present",
    "Under SO 1 and 2 members",
    "Under SO 1 to 3 days notice",
    "SO 1, 40 minutes",
    "SO 1 or 5 votes",
    "Standing Orders 1 and 2 members",
    "SOs 1, 40 minutes",
    "SO 1, 40 MPs",
    "SO 1, 40 people",
    "SO 1, 20 per cent",
    "SO 1, 3 calendar days",
    "SO 1, 2 working days",
    "SO 1, 5 pm",
    "SO 1, 2 hrs",
    "SO 1, 2 or more members",
    "SO 1, 2 or fewer persons",
    "SO 1, 2 or less hours",
    "SO 1, 5 a.m.",
    "SO 1, 5 p.m.",
    "SO 1, 5 o'clock",
    "SO 1 and 2 or more Bills",
    "SO 1, 2 or fewer questions",
    "SO 1, 1 hour",
    "SO 1, 1 day",
    "SO 1, 1 minute",
    "SO 1, 1 vote",
    "SO 1, 1 week",
    "SO 1, 1 year",
    "SO 1, 1 second",
    "SO 1, 1 time",
    "SO 1, 1 member",
    "SO 1, 1 MP",
    "SO 1, 1 person",
    "SO 1, 12 noon",
    "SO 1, 1 speaker",
    "SO 1, 2 speakers",
    "SO 1, 1 party",
    "SO 1, 2 parties",
    "SO 1, 1 month",
  ]) {
    const kept = rewriteForbiddenAuthorityMentions({ answerText: text, authorities: admitted });
    assert.equal(kept.removedMentions.length, 0, text);
    assert.equal(kept.rewrittenText, text, text);
  }
  const speaker = "Under SO 1 and 99 the Speaker may sit [SO 1].";
  const flagged = rewriteForbiddenAuthorityMentions({
    answerText: speaker,
    authorities: admitted,
  });
  assert.equal(flagged.rewrittenText.includes("99"), false);
  assert.notEqual(flagged.rewrittenText, speaker);
  // "speaker" is a follower, but the article keeps "the Speaker" a real joined number.
  const article = rewriteForbiddenAuthorityMentions({
    answerText: "SO 1 and 99 the Speaker",
    authorities: admitted,
  });
  assert.equal(article.rewrittenText.includes("99"), false);
  for (const procedural of [
    "SO 1 and 99 Bills are introduced",
    "SO 1 and 99 questions",
    "SO 1 and 99 motions",
    "SO 1 and 99 amendments",
    "SO 1 and 99 readings",
    "SO 1 and 99 or more",
  ]) {
    const flaggedProcedural = rewriteForbiddenAuthorityMentions({ answerText: procedural, authorities: admitted });
    assert.equal(flaggedProcedural.rewrittenText.includes("99"), false, procedural);
  }
  for (const possessive of ["SO 1 and 99 Members' bills", "SO 1 and 99 days' notice"]) {
    const keptNumber = rewriteForbiddenAuthorityMentions({ answerText: possessive, authorities: admitted });
    assert.equal(keptNumber.rewrittenText.includes("99"), false, possessive);
  }
  const bracket = validateAnswerCitations({
    answerText: "The House sits [SO 1 and 2 members].",
    authorities: admitted,
  });
  assert.equal(bracket.ok, true);
  const possessiveBracket = validateAnswerCitations({
    answerText: "The House sits [SO 1 and 99 Members' bills].",
    authorities: admitted,
  });
  assert.equal(possessiveBracket.ok, false);
});

test("an appendix note inside a standing-order bracket is not grounded", () => {
  const admitted = [{ citationLabel: "SO 1" }];
  for (const form of [
    "[SO 1 (Appendix B note)]",
    "[SO 1 with Appendix B note]",
    "[SO 1: see Appendix B note]",
    "[SO 1 cf. Appendix C note]",
    "[SO 1 Appendix A note]",
  ]) {
    const checked = validateAnswerCitations({
      answerText: `The House sits ${form}.`,
      authorities: admitted,
    });
    assert.equal(checked.ok, false, form);
  }
});

test("an over-long standing-order number is consumed whole", () => {
  const rewritten = rewriteForbiddenAuthorityMentions({
    answerText: "Standing Order 1234567 applies, and SO 12345678 too.",
    authorities: [{ citationLabel: "SO 1" }],
  });
  assert.equal(rewritten.rewrittenText.includes("Standing Order"), false);
  assert.equal(/\d/.test(rewritten.rewrittenText), false);
  assert.equal(rewritten.rewrittenText.includes("not retrieved7"), false);
  assert.match(rewritten.rewrittenText, /a provision that was not retrieved/);
});

test("a citation bracket is grounded only when every provision in it is admitted", () => {
  const both = [{ citationLabel: "SO 1" }, { citationLabel: "SO 2" }];
  const one = [{ citationLabel: "SO 1" }];
  for (const text of ["[SO 1(2) and (3)]", "[SO 1(2)(a) and (b)]", "[SO 1 and 2]"]) {
    const checked = validateAnswerCitations({ answerText: `The House sits ${text}.`, authorities: both });
    assert.equal(checked.ok, true, text);
  }
  for (const text of ["[SO 1: see SO 99]", "[SO 1 (SO 99)]", "[SO 1 & SO 99]", "[SO 1 or SO 99]", "[SO 1 with SO 99]", "[SO 1 cf. SO 99]"]) {
    const checked = validateAnswerCitations({ answerText: `The House sits ${text}.`, authorities: one });
    assert.equal(checked.ok, false, text);
  }
  const kept = pruneValidatedAnswerContent({
    answerText: "Bottom line:\nBoth orders apply [SO 1 and 2].",
    authorities: both,
  }).prunedText;
  assert.match(kept, /\[SO 1 and 2\]/);
  const oneLine = pruneValidatedAnswerContent({
    answerText: "Bottom line:\nThe House sits [SO 1].\n\nWhat this means:\nSee the note [SO 1 cf. SO 99].",
    authorities: one,
  }).prunedText;
  assert.match(oneLine, /The House sits \[SO 1\]/);
  assert.equal(oneLine.includes("SO 99"), false);
  const none = pruneValidatedAnswerContent({
    answerText: "Bottom line:\nSee the note [SO 1: see SO 99].",
    authorities: one,
  }).prunedText;
  assert.equal(none.includes("SO 99"), false);
  assert.equal(none.includes("See the note"), false);
});

test("an attacher does not label a mention that is not wholly admitted", () => {
  const pruned = pruneValidatedAnswerContent({
    answerText: "Bottom line:\nUnder SO 1-99 the House sits.",
    authorities: [{ citationLabel: "SO 1" }],
  }).prunedText;
  assert.equal(pruned.includes("[SO 1]"), false);
  assert.equal(pruned.includes("SO 1-99"), false);
});

test("a suffix on an admitted label is still an unretrieved mention", () => {
  const text = "Apply SO 1 (referred to in SO 99; not retrieved).";
  const checked = validateAnswerAuthorityMentions({
    answerText: text,
    authorities: [{ citationLabel: "SO 1" }],
  });
  assert.equal(checked.ok, false);
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

test("a fully grounded answer has no blanket hedge", () => {
  const attached = attachClaimQualifications([
    "Bottom line:",
    "The House may sit [SO 1]. [SO 1] has not been confirmed to govern the specific act asked about.",
  ].join("\n"), { actLabels: ["SO 1"], groundedLabels: ["SO 1"] });
  assert.equal(attached.includes("has not been confirmed"), false);
});

test("a mixed answer hedges only the ungrounded claim", () => {
  const attached = attachClaimQualifications([
    "Bottom line:",
    "The House may sit [SO 1].",
    "",
    "What this means:",
    "A different step applies [SO 2].",
  ].join("\n"), { actLabels: ["SO 1", "SO 2"], groundedLabels: ["SO 1"] });
  const bottom = attached.split("\n").find((line) => line.includes("[SO 1]")) ?? "";
  const other = attached.split("\n").find((line) => line.includes("[SO 2]")) ?? "";
  assert.equal(bottom.includes("has not been confirmed"), false);
  assert.match(other, /\[SO 2\] has not been confirmed to govern the specific act asked about/);
});

test("a discretionary provision keeps its qualification", () => {
  const attached = attachClaimQualifications(
    "Bottom line:\nThe Speaker may suspend the sitting [SO 1].",
    { actLabels: ["SO 1"], groundedLabels: ["SO 1"], discretionaryLabels: ["SO 1"] },
  );
  assert.match(attached, /\[SO 1\] has not been confirmed to govern the specific act asked about/);
});

test("an ungrounded claim does not lose an existing hedge", () => {
  const text = "What this means:\nThe other step applies [SO 99]. [SO 99] has not been confirmed to govern the specific act asked about.";
  const attached = attachClaimQualifications(text, { groundedLabels: ["SO 1"] });
  assert.match(attached, /\[SO 99\] has not been confirmed to govern the specific act asked about/);
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
  options?: { sectionContent?: string; draft?: string; repairText?: string; bottomLine?: string; admit?: boolean; citationLabel?: string; labels?: string[]; support?: boolean },
) {
  const labels = options?.labels ?? [options?.citationLabel ?? "SO 1"];
  const pack = labels.map((label, index) => ({
    ...source(options?.sectionContent, label),
    sectionId: `s${index + 1}`,
    sectionKey: `s${index + 1}`,
  }));
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
      claims: found.map((match) => ({ id: match[1], supported: options?.support !== false, reason: "checked" })),
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
        query: "suspension", corpus: null, limit: 10, offset: 0, total: pack.length, hasMore: false, results: pack,
      }),
      loadHeadings: async () => [],
      selectV517ProductionAuthorities: async () => ({
        finalAuthorities: pack,
        prePruneLabels: [], selectedLabels: [], prunedRedundant: [],
        minObligationCoverage: 1, allObligationsComplete: true,
        obligationDetails: [{ coverage: 1, complete: true }],
        candidateCount: pack.length, evidenceAdmission: "synthetic", rejectedAuthorities: [],
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
  assert.equal(String(quoted.answerText).includes("Standing Order a provision"), false);
  assert.match(String(quoted.answerText), /a provision that was not retrieved/);
  assert.equal(String(quoted.answerText).includes("referred to in"), false);
  assert.ok((quoted.answerEdits as string[]).includes("removed_mentions=1"));
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

test("a quantity follower is served unchanged, and a bare joined number is not", async () => {
  const served = [
    "SO 1, 40 MPs may attend [SO 1].",
    "SO 1, 40 people may attend [SO 1].",
    "SO 1 and 2 or more Bills may be introduced [SO 1].",
    "SO 1, 20 per cent may object [SO 1].",
    "SO 1, 3 calendar days notice is given [SO 1].",
    "SO 1, 2 working days notice is given [SO 1].",
    "SO 1, 5 pm is the deadline [SO 1].",
    "SO 1, 2 hrs notice is given [SO 1].",
    "SO 1, 2 or more members may object [SO 1].",
  ];
  for (const sentence of served) {
    const done = await probe("named_admitted_source", {
      draft: `Bottom line:\n${sentence}\n\nWhat this means:\n${QUOTE} [SO 1].\n\nSettlement: supported`,
    });
    assert.equal(done.answerState, "supported", sentence);
    assert.equal(String(done.answerText).includes(sentence), true, sentence);
    assert.equal(((done.answerEdits as string[] | undefined) ?? []).some((item) => item.startsWith("removed_mentions")), false, sentence);
  }
  const joined = "Under SO 1 and 99 the Speaker may sit [SO 1].";
  const flagged = await probe("named_admitted_source", {
    draft: `Bottom line:\n${joined}\n\nWhat this means:\n${QUOTE} [SO 1].\n\nSettlement: supported`,
  });
  assert.equal(String(flagged.answerText).includes("99"), false);
  assert.equal(String(flagged.answerText).includes(joined), false);
  const bills = "SO 1 and 99 Bills are introduced [SO 1].";
  const flaggedBills = await probe("named_admitted_source", {
    draft: `Bottom line:\n${bills}\n\nWhat this means:\n${QUOTE} [SO 1].\n\nSettlement: supported`,
  });
  assert.equal(String(flaggedBills.answerText).includes("99"), false);
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

test("an appendix note inside a standing-order bracket is withheld", async () => {
  for (const form of [
    "[SO 1 (Appendix B note)]",
    "[SO 1 with Appendix B note]",
    "[SO 1: see Appendix B note]",
    "[SO 1 cf. Appendix C note]",
    "[SO 1 Appendix A note]",
  ]) {
    const done = await probe("named_admitted_source", {
      draft: `Bottom line:\nThe House sits ${form}.\n\nSettlement: supported`,
    });
    assert.equal(done.answerState, "not_answered", form);
    assert.notEqual(done.answerState, "supported", form);
    assert.equal(String(done.answerText).includes("Appendix"), false, form);
  }
});

test("a quantity-only bracket is not a citation", () => {
  const admitted = [{ citationLabel: "SO 1" }];
  for (const form of ["[40 members]", "[2 days]", "[99 MPs]", "[99 Bills]"]) {
    const checked = validateAnswerCitations({
      answerText: `The House sits ${form}.`,
      authorities: admitted,
    });
    assert.equal(checked.ok, false, form);
  }
  const continued = validateAnswerCitations({
    answerText: "The House sits [SO 1 and 2 members].",
    authorities: admitted,
  });
  assert.equal(continued.ok, true);
});

test("a quantity-only citation is not served", async () => {
  const only = await probe("named_admitted_source", {
    draft: "Bottom line:\nThe Speaker may adjourn the House at will [40 members].\n\nSettlement: supported",
  });
  assert.equal(only.answerState, "not_answered");
  assert.notEqual(only.answerState, "supported");
  const bottom = await probe("named_admitted_source", {
    draft: `Bottom line:\nThe House sits [2 days].\n\nWhat this means:\n${QUOTE} [SO 1].\n\nSettlement: supported`,
  });
  assert.notEqual(bottom.answerState, "supported");
  assert.equal(String(bottom.answerText).includes("[2 days]"), false);
  const meaning = await probe("named_admitted_source", {
    draft: `Bottom line:\n${QUOTE} [SO 1].\n\nWhat this means:\nMembers may demand a vote [99 members].\n\nSettlement: supported`,
  });
  assert.equal(String(meaning.answerText).includes("[99 members]"), false);
  assert.equal(String(meaning.answerText).includes("Members may demand a vote"), false);
  assert.match(String(meaning.answerText), /\[SO 1\]/);
});

test("a claim-check rejection after a rewrite still records the removed mention", async () => {
  const done = await probe("named_admitted_source", {
    support: false,
    draft: `Bottom line:\nStanding Order 39 lets the House sit [SO 1].\n\nWhat this means:\n${QUOTE} [SO 1].\n\nSettlement: supported`,
  });
  assert.equal(done.answerState, "not_answered");
  assert.ok(done.fallbackCode === "validation_rejected" || done.fallbackCode === "bottom_line_lost");
  assert.ok((done.answerEdits as string[]).includes("removed_mentions=1"));
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

test("a multi-digit ruling cited as a standing order is not served", async () => {
  const meaning = `What this means:\n${QUOTE} [SO 2].\n\nSettlement: supported`;
  for (const sentence of ["S.O. 22/9 lets the House sit [SO 2].", "Under SO 12/9 the House sits [SO 2].", "SO 12/3 lets the House sit [SO 2].", "SO 123/4 lets the House sit [SO 2]."]) {
    const done = await probe("named_admitted_source", {
      citationLabel: "SO 2",
      labels: ["SO 2"],
      draft: `Bottom line:\n${sentence}\n\n${meaning}`,
    });
    assert.equal(String(done.answerText).includes("22/9"), false, sentence);
    assert.equal(String(done.answerText).includes("12/9"), false, sentence);
    assert.equal(String(done.answerText).includes("12/3"), false, sentence);
    assert.equal(String(done.answerText).includes("123/4"), false, sentence);
    assert.notEqual(done.answerText, `Bottom line:\n${sentence}\n\n${meaning}`.replace(/\n\nSettlement: supported/, ""), sentence);
  }
});

test("one ungrounded bracket removes its line, and only that line", async () => {
  const kept = await probe("named_admitted_source", {
    draft: `Bottom line:\nThe House may suspend the sitting [SO 1].\n\nWhat this means:\nSee the note [SO 1 cf. SO 99].\n\nSettlement: supported`,
  });
  assert.notEqual(kept.answerState, "not_answered");
  assert.notEqual(kept.fallbackCode, "prune_emptied_draft");
  assert.match(String(kept.answerText), /The House may suspend the sitting \[SO 1\]/);
  assert.equal(String(kept.answerText).includes("SO 99"), false);
  const emptied = await probe("named_admitted_source", {
    draft: "Bottom line:\nSee the note [SO 1: see SO 99].\n\nWhat this means:\nAlso [SO 1 with SO 99].",
  });
  assert.equal(emptied.answerState, "not_answered");
  assert.equal(emptied.fallbackCode, "prune_emptied_draft");
});

test("an admitted pair written as one bracket is served", async () => {
  const done = await probe("named_admitted_source", {
    labels: ["SO 1", "SO 2"],
    draft: `Bottom line:\nBoth orders apply [SO 1 and 2].\n\nWhat this means:\n${QUOTE} [SO 1].\n\nSettlement: supported`,
  });
  assert.notEqual(done.answerState, "not_answered");
  assert.match(String(done.answerText), /\[SO 1 and 2\]/);
});

test("a suffix that survives the mention check withholds the answer", async () => {
  const done = await probe("named_admitted_source", {
    draft: "Bottom line:\nStanding Order 99 (referred to in [SO 1]; not retrieved) lets the House sit.",
  });
  assert.equal(done.fallbackCode, "ungrounded_mentions");
  assert.equal(done.answerState, "not_answered");
  assert.equal(String(done.answerText).includes("referred to in"), false);
  assert.equal(String(done.answerText).includes("Standing Order 99"), false);
});

test("the main-path rewrite note saturates at 99", async () => {
  const mentions = Array.from({ length: 100 }, (_, index) => `Standing Order ${1000 + index}`).join(". ");
  const done = await probe("named_admitted_source", {
    draft: `Bottom line:\n${mentions} [SO 1].\n\nWhat this means:\n${QUOTE} [SO 1].\n\nSettlement: supported`,
  });
  assert.notEqual(done.answerState, "not_answered");
  assert.match(String(done.rewriteNote), /rewritten_mentions=99/);
  assert.ok((done.answerEdits as string[]).includes("removed_mentions=99"));
  assert.equal(String(done.answerText).includes("Standing Order 1"), false);
});

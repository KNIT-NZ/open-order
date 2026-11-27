import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { AiProviderError } from "../lib/ai/errors";
import type { AiGenerateJsonRequest, AiStreamTextRequest } from "../lib/ai/types";
import type { ProceduralSearchResponse, ProceduralSearchResult } from "../lib/procedural-search";
import { runAnswerRoute } from "../app/api/ai/answer/route";

const QUOTE = "The House may suspend the sitting when the Speaker so decides.";
const PRUNED_LABEL = "SO 404";
const LEGACY_LABEL = "SO 77";

type Scenario =
  | "supported"
  | "prune"
  | "semantic_prune"
  | "rewrite"
  | "repair"
  | "answer_edits"
  | "failed_adjudication"
  | "no_bodies"
  | "reconstruction"
  | "fallback";

function authority(label: string, sectionId: string): ProceduralSearchResult {
  return {
    sectionId,
    sectionKey: sectionId,
    citationLabel: label,
    heading: "Suspension",
    path: ["Debate"],
    pathText: "Debate",
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
    sectionContent: QUOTE,
    matchSignals: {
      exactSectionKeyMatch: false,
      exactCitationMatch: false,
      exactHeadingMatch: false,
      headingPhraseMatch: false,
      bodyPhraseMatch: false,
      pathPhraseMatch: false,
    },
  };
}

function plan(kind: "incident" | "procedure") {
  return {
    intent: "explain_rule",
    preferredCorpus: null,
    searchQueries: ["suspension of the sitting"],
    salientTerms: ["suspension"],
    notes: "synthetic",
    situation: {
      kind,
      actor: "member",
      setting: "Chamber",
      action: "suspend the sitting",
      affectedPerson: "",
      proceduralMoment: "debate",
      decisionQuestion: "May the House suspend the sitting?",
      materialFacts: [],
      verb: "suspend",
      object: "sitting",
    },
  };
}

function cited(label: string): string {
  return `${QUOTE} [${label}]`;
}

function draftFor(scenario: Scenario): string {
  const bottom = `Bottom line:\n${cited("SO 1")}`;
  const meaning = `What this means:\n${cited("SO 1")}`;
  const settlement = "Settlement: supported";
  if (scenario === "prune") {
    return `${bottom}\n\n${meaning}\nAn uncited aside should leave the draft.\n\n${settlement}`;
  }
  if (scenario === "semantic_prune") {
    return `${bottom}\n\nWhat this means:\n${cited("SO 1")}\nSECOND CLAIM about the sitting remains unsupported. [SO 1]\n\n${settlement}`;
  }
  if (scenario === "rewrite") {
    return `${bottom}\n\nWhat this means:\n${QUOTE}, unlike SO 99. [SO 1]\n\n${settlement}`;
  }
  if (scenario === "answer_edits") {
    return `${bottom}\n\n${meaning}\n\nBest authorities to inspect or cite:\n- [SO 1] Suspension\n- [SO 2] Another rule\n\n${settlement}`;
  }
  if (scenario === "reconstruction" || scenario === "repair") {
    return `${meaning}\n\n${settlement}`;
  }
  if (scenario === "fallback") {
    return `${bottom}\n\n${meaning}\n\nBest authorities to inspect or cite:\n- [SO 99] Not retrieved\n\n${settlement}`;
  }
  return `${bottom}\n\n${meaning}\n\n${settlement}`;
}

function claimsIn(prompt: string): Array<{ id: string; text: string }> {
  return [...prompt.matchAll(/^(claim-\d+)\nClaim: (.+)$/gm)].map((match) => ({
    id: match[1],
    text: match[2],
  }));
}

async function ask(scenario: Scenario): Promise<Array<{ event: string; data: Record<string, unknown> }>> {
  const incident = scenario === "repair" || scenario === "failed_adjudication" || scenario === "no_bodies";
  const pack = scenario === "no_bodies"
    ? []
    : scenario === "answer_edits"
      ? [authority("SO 1", "s1"), authority("SO 2", "s2")]
      : [authority("SO 1", "s1")];
  const generateJson = async <T,>(request: AiGenerateJsonRequest): Promise<T> => {
    request.onProviderAttemptStart?.("gemini-3.5-flash-lite");
    if (request.systemInstruction.includes("PROCEDURAL SOURCE adjudicator")) {
      if (scenario === "failed_adjudication") {
        throw new AiProviderError({
          message: "synthetic adjudicator outage",
          kind: "unknown",
          statusCode: 401,
          retryable: false,
          provider: "gemini",
        });
      }
      const value = {
        selected: [{
          citationLabel: "SO 1",
          role: "governing",
          exactQuote: QUOTE,
          actorMatches: true,
          settingMatches: true,
          actionMatches: true,
          stageMatches: true,
          rationale: "governs the sitting",
        }],
        remainingUncertainties: [],
        explanation: "quoted",
      };
      request.validate?.(value);
      request.onProviderAttempt?.({ model: "gemini-3.5-flash-lite", outcome: "ok" });
      return value as T;
    }
    if (request.systemInstruction.includes("repair a missing Bottom line")) {
      const value = { bottomLine: cited("SO 1") };
      request.validate?.(value);
      request.onProviderAttempt?.({ model: "gemini-3.5-flash-lite", outcome: "ok" });
      return value as T;
    }
    if (request.systemInstruction.includes("ONLY planning targeted retrieval")) {
      const value = plan(incident ? "incident" : "procedure");
      request.validate?.(value);
      request.onProviderAttempt?.({ model: "gemini-3.5-flash-lite", outcome: "ok" });
      return value as T;
    }
    const found = claimsIn(request.prompt);
    const responsive = scenario === "repair" && !request.prompt.includes("Bottom line:")
      ? { answersUserQuestion: false, reason: "withheld", unaddressedParts: ["decision"] }
      : { answersUserQuestion: true, reason: "fits", unaddressedParts: [] as string[] };
    const value = {
      claims: found.map((claim) => ({
        id: claim.id,
        supported: !claim.text.includes("SECOND CLAIM"),
        reason: "checked",
      })),
      responsiveness: responsive,
    };
    request.validate?.(value);
    request.onProviderAttempt?.({ model: "gemini-3.5-flash-lite", outcome: "ok" });
    return value as T;
  };
  const streamText = async (request: AiStreamTextRequest): Promise<string> => {
    request.onProviderAttemptStart?.("gemini-3.5-flash-lite");
    request.onProviderAttempt?.({ model: "gemini-3.5-flash-lite", outcome: "ok" });
    if (request.systemInstruction.includes("repairing an incomplete")) return draftFor("supported");
    return draftFor(scenario);
  };
  const search = async (): Promise<ProceduralSearchResponse> => ({
    query: "suspension",
    corpus: null,
    limit: 10,
    offset: 0,
    total: pack.length,
    hasMore: false,
    results: pack,
  });
  const response = await runAnswerRoute(
    new NextRequest("http://localhost/api/ai/answer", {
      method: "POST",
      body: JSON.stringify({ question: "May the House suspend the sitting?" }),
    }),
    {
      generateJson,
      streamText,
      searchProceduralAuthorities: search,
      loadHeadings: async () => [],
      selectV517ProductionAuthorities: async () => ({
        finalAuthorities: pack,
        prePruneLabels: [PRUNED_LABEL],
        selectedLabels: [LEGACY_LABEL],
        prunedRedundant: [],
        minObligationCoverage: 1,
        allObligationsComplete: true,
        obligationDetails: [{ coverage: 1, complete: true }],
        candidateCount: pack.length,
        evidenceAdmission: "synthetic",
        rejectedAuthorities: [],
      }),
    },
  );
  const text = await response.text();
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  for (const block of text.split("\n\n")) {
    let event = "";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) event = line.slice(7).trim();
      else if (line.startsWith("data: ")) data.push(line.slice(6));
    }
    if (!event || data.length === 0) continue;
    events.push({ event, data: JSON.parse(data.join("\n")) as Record<string, unknown> });
  }
  return events;
}

function doneOf(events: Array<{ event: string; data: Record<string, unknown> }>): Record<string, unknown> {
  const done = events.find((item) => item.event === "done");
  assert.ok(done, "the route sent a done event");
  return done.data;
}

test("a fully checked draft is supported", async () => {
  const events = await ask("supported");
  const done = doneOf(events);
  assert.equal(done.answerState, "supported");
  assert.equal(done.abstained, false);
  const diagnostics = events.find((item) => item.event === "diagnostics");
  const selector = diagnostics?.data.selectorSummary as {
    prePruneCount?: number;
    legacySelectedCount?: number;
    prePruneLabels?: unknown;
    legacySelectedLabels?: unknown;
  };
  assert.equal(selector.prePruneCount, 1);
  assert.equal(selector.legacySelectedCount, 1);
  assert.equal(selector.prePruneLabels, undefined);
  assert.equal(selector.legacySelectedLabels, undefined);
  assert.equal(JSON.stringify(events).includes(PRUNED_LABEL), false);
  assert.equal(JSON.stringify(events).includes(LEGACY_LABEL), false);
});

test("pruning an uncited line caps the done answer at partial", async () => {
  const done = doneOf(await ask("prune"));
  assert.equal(done.answerState, "partial");
  assert.match(String(done.pruneNote), /pruned_lines=1/);
});

test("pruning an unsupported claim caps the done answer at partial", async () => {
  const done = doneOf(await ask("semantic_prune"));
  assert.equal(done.answerState, "partial");
  assert.match(String(done.claimValidationNote), /pruned_unsupported_claims=1/);
});

test("rewriting an unretrieved mention caps the done answer at partial", async () => {
  const done = doneOf(await ask("rewrite"));
  assert.equal(done.answerState, "partial");
  assert.match(String(done.rewriteNote), /rewritten_mentions=1/);
});

test("an accepted incident repair caps the done answer at partial", async () => {
  const done = doneOf(await ask("repair"));
  assert.equal(done.answerState, "partial");
  assert.equal(done.repairAccepted, true);
  assert.match(String(done.claimValidationNote), /repair=accepted/);
});

test("dropping an unreferenced authority list entry caps the done answer at partial", async () => {
  const done = doneOf(await ask("answer_edits"));
  assert.equal(done.answerState, "partial");
  assert.deepEqual(done.answerEdits, ["SO 2"]);
});

test("a failed adjudication caps the done answer at partial", async () => {
  const done = doneOf(await ask("failed_adjudication"));
  assert.equal(done.answerState, "partial");
  assert.equal(done.abstained, false);
  assert.ok(Array.isArray(done.partial) && done.partial.includes("evidence_gap"));
  const facets = done.uncertainty as Array<{ facet?: string }>;
  assert.ok(facets.some((item) => item.facet === "adjudication unavailable"));
});

test("no retrieved source bodies abstain, so the done answer is not supported", async () => {
  const events = await ask("no_bodies");
  const done = doneOf(events);
  assert.equal(done.answerState, "not_answered");
  assert.equal(done.abstained, true);
  assert.equal(done.fallbackCode, "no_authority_selected");
  assert.ok(Array.isArray(done.partial) && done.partial.includes("evidence_gap"));
  const diagnostics = events.find((item) => item.event === "diagnostics");
  const selector = diagnostics?.data.selectorSummary as { scenarioAdjudication?: { status?: string } };
  assert.equal(selector.scenarioAdjudication?.status, "no_retrieved_source_bodies");
});

test("an accepted Bottom-line reconstruction caps the done answer at partial", async () => {
  const done = doneOf(await ask("reconstruction"));
  assert.equal(done.answerState, "partial");
  assert.equal(done.repairAccepted, true);
  assert.match(String(done.claimValidationNote), /bottom_line_recovery=accepted_after_recheck/);
});

test("an unretrieved citation falls back and the done answer is not answered", async () => {
  const done = doneOf(await ask("fallback"));
  assert.equal(done.answerState, "not_answered");
  assert.equal(done.fallbackCode, "invalid_citations");
  assert.deepEqual(done.invalidCitations, []);
  assert.match(String(done.claimValidationNote), /invalid_citations=1/);
  assert.equal(String(done.claimValidationNote).includes("SO 99"), false);
});

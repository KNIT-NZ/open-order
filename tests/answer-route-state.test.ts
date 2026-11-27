import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NextRequest } from "next/server";
import { AiProviderError } from "../lib/ai/errors";
import { withCorpusCommitteeNames } from "../lib/committee-names-context";
import type { AiGenerateJsonRequest, AiStreamTextRequest } from "../lib/ai/types";
import type { ProceduralSearchResponse, ProceduralSearchResult } from "../lib/procedural-search";
import { formatAiDebugSnapshot } from "../lib/open-order/format";
import { EMPTY_AI_DIAGNOSTICS } from "../lib/open-order/types";

// The route module constructs the corpus pool on import. CI has no database.
// A loopback URL satisfies that check; the stubs below never open a connection.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgresql://localhost/open_order_route_test?sslmode=disable";
}

type RunAnswerRoute = typeof import("../app/api/ai/answer/route").runAnswerRoute;
let runAnswerRoute: RunAnswerRoute | undefined;
async function loadAnswerRoute(): Promise<RunAnswerRoute> {
  runAnswerRoute ??= (await import("../app/api/ai/answer/route")).runAnswerRoute;
  return runAnswerRoute;
}

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
  | "fallback"
  | "qualified_act"
  | "wrong_object"
  | "qualified_fallback"
  | "overlooked_soft"
  | "forum_codes"
  | "forum_same"
  | "forum_reject"
  | "forum_generic"
  | "forum_ambiguous"
  | "forum_longer"
  | "forum_subclass"
  | "forum_own"
  | "forum_own_incident"
  | "forum_debate"
  | "forum_debate_incident"
  | "forum_stage"
  | "forum_stage_incident"
  | "forum_motion"
  | "forum_motion_incident"
  | "planner_leak"
  | "planner_leak_incident";

const forumCase: Partial<Record<Scenario, { setting: string; path: string | string[]; kind?: "incident" | "procedure" }>> = {
  forum_same: { setting: "Widget Committee", path: "Widget Committee" },
  forum_reject: { setting: "Gadget Review Committee", path: "Widget Committee" },
  forum_generic: { setting: "select committee", path: "Widget Oversight Committee" },
  forum_longer: { setting: "Tarn Widget Committee", path: "Widget Committee" },
  forum_subclass: { setting: "the Tarn Subcommittee", path: "Widget Oversight Committee" },
  forum_ambiguous: { setting: "Widget Committee", path: "Widget Trade Committee" },
  forum_own: {
    setting: "Widget Oversight Committee",
    path: ["Chapter 2", "Sittings of the House", "Financial procedures", "Functions of the Widget Oversight Committee"],
  },
  forum_own_incident: {
    setting: "Widget Oversight Committee",
    path: ["Chapter 2", "Sittings of the House", "Financial procedures", "Functions of the Widget Oversight Committee"],
    kind: "incident",
  },
  forum_debate: { setting: "the Tarn debate", path: ["Chapter 2", "Sittings of the House", "Marrow debate"] },
  forum_debate_incident: { setting: "the Tarn debate", path: ["Chapter 2", "Sittings of the House", "Marrow debate"], kind: "incident" },
  forum_stage: { setting: "the Tarn stage", path: ["Part 4", "Marrow stage"] },
  forum_stage_incident: { setting: "the Tarn stage", path: ["Part 4", "Marrow stage"], kind: "incident" },
  forum_motion: { setting: "urgency motion", path: ["Chapter 3", "Motion for adjournment"] },
  forum_motion_incident: { setting: "urgency motion", path: ["Chapter 3", "Motion for adjournment"], kind: "incident" },
};

const DEVICE = "Carrying a device is permitted when it does not disrupt the forum.";
const WRONG_OBJECT = "The House may suspend business of a committee when its chair so decides.";

function authority(label: string, sectionId: string, sectionContent = QUOTE, path = ["Debate"]): ProceduralSearchResult {
  return {
    sectionId,
    sectionKey: sectionId,
    citationLabel: label,
    heading: "Suspension",
    path,
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
    sectionContent,
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

function plan(kind: "incident" | "procedure", setting = "Chamber", affectedPerson = "") {
  return {
    intent: "explain_rule",
    preferredCorpus: null,
    searchQueries: ["suspension of the sitting"],
    salientTerms: ["suspension"],
    notes: "synthetic",
    situation: {
      kind,
      actor: "member",
      setting,
      action: "suspend the sitting",
      affectedPerson,
      proceduralMoment: "debate",
      decisionQuestion: "May the House suspend the sitting?",
      materialFacts: kind === "incident" ? ["an occurrence was recorded"] : [],
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
  if (scenario === "fallback" || scenario === "qualified_fallback") {
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
  const incident = scenario === "repair" || scenario === "failed_adjudication" || scenario === "no_bodies"
    || scenario === "planner_leak_incident"
    || scenario === "qualified_act" || scenario === "wrong_object" || scenario === "qualified_fallback"
    || forumCase[scenario]?.kind === "incident";
  const overlookedBody = `${QUOTE} The House may suspend business of a committee when its chair so decides.`;
  const primaryForOverlooked = authority("SO 1", "s1", `${QUOTE} subject to SO 2.`);
  const overlookedSource = authority("SO 2", "s2", overlookedBody);
  const forumPrimary = authority("SO 1", "s1", `${QUOTE} subject to SO 2. subject to SO 3.`, ["Widget Oversight Committee"]);
  const forumMismatch = authority("SO 2", "s2", QUOTE, ["Gadget Review Committee"]);
  const forumShort = authority("SO 3", "s3", QUOTE, ["Widget Committee"]);
  const forumPath = forumCase[scenario];
  const pack = scenario === "no_bodies"
    ? []
    : scenario === "answer_edits"
      ? [authority("SO 1", "s1"), authority("SO 2", "s2")]
      : scenario === "qualified_act" || scenario === "qualified_fallback"
        ? [authority("SO 1", "s1", DEVICE)]
        : scenario === "wrong_object"
          ? [authority("SO 1", "s1", WRONG_OBJECT)]
          : scenario === "overlooked_soft"
            ? [primaryForOverlooked, overlookedSource]
            : scenario === "forum_codes"
              ? [forumPrimary, forumMismatch, forumShort]
              : forumPath
                ? [authority("SO 1", "s1", QUOTE, Array.isArray(forumPath.path) ? forumPath.path : [forumPath.path])]
                : [authority("SO 1", "s1")];
  const selectedPack = scenario === "overlooked_soft" ? [primaryForOverlooked]
    : scenario === "forum_codes" ? [forumPrimary]
      : pack;
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
          citationLabel: scenario === "overlooked_soft" ? "SO 2" : "SO 1",
          role: "governing",
          exactQuote: scenario === "qualified_act" || scenario === "qualified_fallback"
            ? DEVICE
            : scenario === "wrong_object" || scenario === "overlooked_soft"
              ? WRONG_OBJECT
              : QUOTE,
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
      const planted = {
        searchQueries: ["SO 999ZZ suspension", "99/999"],
        salientTerms: ["Gloriana Ceremonial Rule"],
        notes: "SO 999ZZ; 99/999; Gloriana Ceremonial Rule",
      };
      const value = scenario === "planner_leak"
        ? { ...plan("procedure"), ...planted }
        : scenario === "planner_leak_incident"
          ? { ...plan("incident"), ...planted }
        : scenario === "forum_codes"
        ? plan("procedure", "Widget Oversight Committee", "a delegate")
        : forumPath
          ? plan(forumPath.kind ?? "procedure", forumPath.setting)
          : plan(incident ? "incident" : "procedure");
      request.validate?.(value);
      request.onProviderAttempt?.({ model: "gemini-3.5-flash-lite", outcome: "ok" });
      return value as T;
    }
    const found = claimsIn(request.prompt);
    const responsive = scenario === "planner_leak_incident" || (scenario === "repair" && !request.prompt.includes("Bottom line:"))
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
    const repair = request.systemInstruction.includes("repairing an incomplete");
    const model = repair ? "gemini-repair-model" : "gemini-3.5-flash-lite";
    request.onProviderAttemptStart?.(model);
    request.onProviderAttempt?.({ model, outcome: "ok" });
    if (repair) return draftFor("supported");
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
  const response = await (await loadAnswerRoute())(
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
        finalAuthorities: selectedPack,
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
  assert.equal(done.route, "semantic_selector");
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
  assert.equal(done.mixedModels, false);
  const stages = done.stageModels as Array<{ task?: string; model?: string; outcome?: string }>;
  assert.equal(stages.find((item) => item.task === "query.plan")?.model, "gemini-3.5-flash-lite");
  assert.equal(stages.find((item) => item.task === "query.plan")?.outcome, "ok");
  assert.equal(diagnostics?.data.routingReason, "planner_procedure");
  const planner = diagnostics?.data.planner as { hasMaterialFacts?: boolean; hasAffectedPerson?: boolean };
  assert.equal(planner.hasMaterialFacts, false);
  assert.equal(planner.hasAffectedPerson, false);
  assert.equal(JSON.stringify(planner).includes("suspend"), false);
  const listed = done.authorities as Array<{ unconfirmed?: boolean }>;
  assert.ok(listed.length > 0);
  assert.ok(listed.every((item) => typeof item.unconfirmed === "boolean"));
  assert.ok(listed.every((item) => item.unconfirmed === false));
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
  assert.ok((done.answerEdits as string[]).includes("removed_mentions=1"));
});

test("an accepted incident repair caps the done answer at partial", async () => {
  const done = doneOf(await ask("repair"));
  assert.equal(done.answerState, "partial");
  assert.equal(done.repairAccepted, true);
  assert.match(String(done.claimValidationNote), /repair=accepted/);
  assert.equal(done.servedModel, "gemini-repair-model");
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

test("a lexical act miss stays a qualified partial answer", async () => {
  const events = await ask("qualified_act");
  const done = doneOf(events);
  assert.equal(done.answerState, "partial");
  assert.equal(done.abstained, false);
  assert.match(String(done.answerText), /\[SO 1\] has not been confirmed to govern the specific act asked about/);
  const facets = done.uncertainty as Array<{ class?: string; facet?: string }>;
  assert.ok(facets.some((item) => item.class === "retrieval_uncertainty" && item.facet === "act_attestation_unconfirmed"));
  const planner = events.find((item) => item.event === "diagnostics")?.data.planner as {
    hasMaterialFacts?: boolean;
    hasAffectedPerson?: boolean;
  };
  assert.equal(planner.hasMaterialFacts, true);
  assert.equal(planner.hasAffectedPerson, false);
  assert.equal(JSON.stringify(planner).includes("occurrence"), false);
});

test("the same verb with a different object stays partial and names the authority", async () => {
  const done = doneOf(await ask("wrong_object"));
  assert.equal(done.answerState, "partial");
  assert.notEqual(done.answerState, "supported");
  assert.match(String(done.answerText), /\[SO 1\] has not been confirmed to govern the specific act asked about/);
});

test("an overlooked soft act miss is qualified and is not the sole authority", async () => {
  const events = await ask("overlooked_soft");
  const done = doneOf(events);
  assert.equal(done.answerState, "partial");
  assert.notEqual(done.answerState, "supported");
  assert.match(String(done.answerText), /\[SO 2\] has not been confirmed to govern the specific act asked about/);
  assert.deepEqual(done.recoveredAuthorities, ["SO 2"]);
  const listed = events.find((item) => item.event === "authorities")?.data.authorities as Array<{
    citationLabel?: string;
    unconfirmed?: boolean;
  }>;
  const labels = listed.map((item) => item.citationLabel);
  assert.ok(labels.includes("SO 1"));
  assert.equal(listed.find((item) => item.citationLabel === "SO 2")?.unconfirmed, true);
  assert.equal(listed.find((item) => item.citationLabel === "SO 1")?.unconfirmed, false);
  const doneAuthorities = done.authorities as Array<{ citationLabel?: string; unconfirmed?: boolean }>;
  assert.equal(doneAuthorities.find((item) => item.citationLabel === "SO 2")?.unconfirmed, true);
  assert.equal(doneAuthorities.find((item) => item.citationLabel === "SO 1")?.unconfirmed, false);
});

test("a qualified source is not listed as an authority when the answer is withheld", async () => {
  const done = doneOf(await ask("qualified_fallback"));
  assert.equal(done.answerState, "not_answered");
  assert.match(String(done.answerText), /Possibly relevant, not confirmed to apply/);
  assert.match(String(done.answerText), /\[SO 1\] has not been confirmed to govern the specific act asked about/);
  assert.equal(String(done.answerText).includes("Best authorities to inspect or cite:\n- [SO 1]"), false);
  assert.deepEqual(done.authorities, []);
  const facets = done.uncertainty as Array<{ facet?: string }>;
  assert.ok(facets.some((item) => item.facet === "act_attestation_unconfirmed"));
});

const FORUM_CODE = /^(?:selector_forum|overlooked_forum)=forum-(?:identity|ambiguous):\d+$|^selector_forum_withheld=forum-identity:\d+$/;

test("forum codes are counts and planner diagnostics are booleans", async () => {
  const events = await withCorpusCommitteeNames([
    "Widget Oversight Committee",
    "Gadget Review Committee",
    "Widget Trade Committee",
    "Widget Review Committee",
  ], () => ask("forum_codes"));
  const diagnostics = events.find((item) => item.event === "diagnostics");
  const selector = diagnostics?.data.selectorSummary as { forumCodes?: string[] };
  const codes = selector.forumCodes ?? [];
  assert.ok(codes.some((code) => code.startsWith("selector_forum=forum-identity:") && !code.endsWith(":0")));
  assert.ok(codes.some((code) => code.startsWith("selector_forum=forum-ambiguous:") && !code.endsWith(":0")));
  assert.ok(codes.some((code) => code.startsWith("overlooked_forum=forum-identity:") && !code.endsWith(":0")));
  assert.ok(codes.some((code) => code.startsWith("overlooked_forum=forum-ambiguous:") && !code.endsWith(":0")));
  const joined = codes.join(";");
  assert.ok(codes.every((code) => FORUM_CODE.test(code)));
  assert.equal(/\s/.test(joined), false);
  assert.equal(joined.includes("Widget"), false);
  assert.equal(joined.includes("Gadget"), false);
  assert.equal(joined.includes("SO"), false);
  const planner = diagnostics?.data.planner as { hasMaterialFacts?: unknown; hasAffectedPerson?: unknown };
  assert.equal(planner.hasMaterialFacts, false);
  assert.equal(planner.hasAffectedPerson, true);
  assert.equal(Object.keys(planner).length, 2);
  assert.equal(JSON.stringify(planner).includes("delegate"), false);
  const adjudication = (diagnostics?.data.selectorSummary as { scenarioAdjudication?: unknown }).scenarioAdjudication;
  assert.ok(adjudication);
});

test("an ambiguous committee parse is never a supported answer", async () => {
  const events = await withCorpusCommitteeNames([
    "Widget Trade Committee",
    "Widget Review Committee",
  ], () => ask("forum_ambiguous"));
  const done = doneOf(events);
  assert.equal(done.answerState, "partial");
  assert.notEqual(done.answerState, "supported");
  assert.match(String(done.answerText), /\[SO 1\] has not been confirmed to be the body the question is about/);
  const listed = done.authorities as Array<{ citationLabel?: string; unconfirmed?: boolean }>;
  assert.equal(listed.find((item) => item.citationLabel === "SO 1")?.unconfirmed, true);
  const panel = events.find((item) => item.event === "authorities")?.data.authorities as Array<{ citationLabel?: string; unconfirmed?: boolean }>;
  assert.equal(panel.find((item) => item.citationLabel === "SO 1")?.unconfirmed, true);
  const facets = done.uncertainty as Array<{ class?: string; facet?: string }>;
  assert.ok(facets.some((item) => item.class === "retrieval_uncertainty" && item.facet === "forum_identity_unconfirmed"));
  const codes = ((events.find((item) => item.event === "diagnostics")?.data.selectorSummary as { forumCodes?: string[] }).forumCodes) ?? [];
  assert.ok(codes.some((code) => code === "selector_forum=forum-ambiguous:1"));
  assert.ok(codes.every((code) => FORUM_CODE.test(code)));
  assert.equal(codes.join(";").includes("Widget"), false);
});

test("the selector route applies all four forum outcomes", async () => {
  const same = doneOf(await withCorpusCommitteeNames(["Widget Committee"], () => ask("forum_same")));
  assert.equal(same.answerState, "supported");
  assert.equal(same.route, "semantic_selector");
  const sameAuthorities = same.authorities as Array<{ citationLabel?: string; unconfirmed?: boolean }>;
  assert.equal(sameAuthorities.find((item) => item.citationLabel === "SO 1")?.unconfirmed, false);

  const generic = doneOf(await withCorpusCommitteeNames(["Widget Oversight Committee"], () => ask("forum_generic")));
  assert.equal(generic.answerState, "partial");
  assert.equal((generic.authorities as Array<{ citationLabel?: string; unconfirmed?: boolean }>).find((item) => item.citationLabel === "SO 1")?.unconfirmed, true);

  const rejectedEvents = await withCorpusCommitteeNames(
    ["Widget Committee", "Gadget Review Committee"],
    () => ask("forum_reject"),
  );
  const rejected = doneOf(rejectedEvents);
  assert.equal(rejected.answerState, "not_answered");
  assert.notEqual(rejected.answerState, "supported");
  assert.deepEqual(rejected.authorities, []);
  const rejectedCodes = ((rejectedEvents.find((item) => item.event === "diagnostics")?.data.selectorSummary as { forumCodes?: string[] }).forumCodes) ?? [];
  assert.ok(rejectedCodes.includes("selector_forum_withheld=forum-identity:1"));

  const longer = doneOf(await withCorpusCommitteeNames(["Widget Committee"], () => ask("forum_longer")));
  assert.equal(longer.answerState, "partial");
  assert.notEqual(longer.answerState, "supported");
  assert.match(String(longer.answerText), /has not been confirmed to be the body the question is about/);
  assert.equal((longer.authorities as Array<{ citationLabel?: string; unconfirmed?: boolean }>).find((item) => item.citationLabel === "SO 1")?.unconfirmed, true);

  const subclass = doneOf(await withCorpusCommitteeNames(["Widget Oversight Committee"], () => ask("forum_subclass")));
  assert.equal(subclass.answerState, "partial");
  assert.notEqual(subclass.answerState, "supported");
  assert.equal((subclass.authorities as Array<{ citationLabel?: string; unconfirmed?: boolean }>).find((item) => item.citationLabel === "SO 1")?.unconfirmed, true);
});

test("a body's own multi-segment path is admitted, and a different proceeding is qualified", async () => {
  const names = ["Widget Oversight Committee", "Gadget Review Committee"];
  for (const scenario of ["forum_own", "forum_own_incident"] as const) {
    const done = doneOf(await withCorpusCommitteeNames(names, () => ask(scenario)));
    assert.equal(done.answerState, "supported", scenario);
    assert.equal(done.route, scenario.endsWith("incident") ? "incident_adjudication" : "semantic_selector", scenario);
    const listed = done.authorities as Array<{ citationLabel?: string; unconfirmed?: boolean }>;
    assert.equal(listed.find((item) => item.citationLabel === "SO 1")?.unconfirmed, false, scenario);
  }
  for (const scenario of [
    "forum_debate", "forum_debate_incident",
    "forum_stage", "forum_stage_incident",
    "forum_motion", "forum_motion_incident",
  ] as const) {
    const done = doneOf(await ask(scenario));
    assert.equal(done.answerState, "partial", scenario);
    assert.notEqual(done.answerState, "supported", scenario);
    assert.equal((done.authorities as Array<{ citationLabel?: string; unconfirmed?: boolean }>).find((item) => item.citationLabel === "SO 1")?.unconfirmed, true, scenario);
  }
});

test("withholding paths leave unconfirmed sources out of the authority list", async () => {
  const cited = `Bottom line:\n${QUOTE} [SO 1]\n\nWhat this means:\n${QUOTE} [SO 1]\n\nSettlement: supported`;
  const sites = [
    { code: "no_authority_selected", draft: cited, kind: "procedure" as const, removed: true },
    { code: "empty_draft", draft: " ", kind: "procedure" as const },
    { code: "invalid_citations", draft: `Bottom line:\n${QUOTE} [SO 1]\n\nWhat this means:\n${QUOTE} [SO 1]\n\nBest authorities to inspect or cite:\n- [SO 99] Not retrieved`, kind: "procedure" as const },
    { code: "no_grounded_claims", draft: "A note outside the answer sections. [SO 1]", kind: "procedure" as const },
    { code: "not_responsive", draft: cited, kind: "incident" as const, responsive: false },
    { code: "bottom_line_lost", draft: cited, kind: "procedure" as const, support: false },
    { code: "drafting_unavailable", draft: cited, kind: "procedure" as const, throwDraft: true },
    { code: "prune_emptied_draft", draft: "What this means:\nAn uncited line only.", kind: "procedure" as const },
    {
      code: "ungrounded_mentions",
      draft: `Bottom line:\n${QUOTE} [SO 1]\n\nWhat this means:\nThe Speaker may act, and so [SO 1] 3 members may object.\n\nSettlement: supported`,
      kind: "procedure" as const,
    },
    {
      code: "ungrounded_mentions",
      draft: `Bottom line:\n${QUOTE} [SO 1]\n\nWhat this means:\nThe Speaker may act, and so [SO 1] 3 members may object.\n\nSettlement: supported`,
      kind: "incident" as const,
    },
  ];
  for (const site of sites) {
    const removed = "removed" in site && site.removed === true;
    const events = await withCorpusCommitteeNames(removed
      ? ["Widget Oversight Committee", "Gadget Review Committee"]
      : ["Widget Trade Committee", "Widget Review Committee"], async () => {
      const source = authority("SO 1", "s1", QUOTE, [removed ? "Widget Oversight Committee" : "Widget Trade Committee"]);
      const generateJson = async <T,>(request: AiGenerateJsonRequest): Promise<T> => {
        request.onProviderAttemptStart?.("gemini-3.5-flash-lite");
        if (request.systemInstruction.includes("PROCEDURAL SOURCE adjudicator")) {
          const value = {
            selected: [{
              citationLabel: "SO 1", role: "governing", exactQuote: QUOTE,
              actorMatches: true, settingMatches: true, actionMatches: true, stageMatches: true, rationale: "synthetic",
            }],
            remainingUncertainties: [], explanation: "quoted",
          };
          request.validate?.(value);
          request.onProviderAttempt?.({ model: "gemini-3.5-flash-lite", outcome: "ok" });
          return value as T;
        }
        if (request.systemInstruction.includes("ONLY planning targeted retrieval")) {
          const value = plan(site.kind, removed ? "Gadget Review Committee" : "Widget Committee");
          request.validate?.(value);
          request.onProviderAttempt?.({ model: "gemini-3.5-flash-lite", outcome: "ok" });
          return value as T;
        }
        const found = claimsIn(request.prompt);
        const value = {
          claims: found.map((claim) => ({ id: claim.id, supported: site.support !== false, reason: "checked" })),
          responsiveness: site.responsive === false
            ? { answersUserQuestion: false, reason: "withheld", unaddressedParts: ["decision"] }
            : { answersUserQuestion: true, reason: "fits", unaddressedParts: [] as string[] },
        };
        request.validate?.(value);
        request.onProviderAttempt?.({ model: "gemini-3.5-flash-lite", outcome: "ok" });
        return value as T;
      };
      const streamText = async (request: AiStreamTextRequest): Promise<string> => {
        request.onProviderAttemptStart?.("gemini-3.5-flash-lite");
        if (site.throwDraft && !request.systemInstruction.includes("repair")) {
          throw new AiProviderError({
            message: "synthetic draft failure", kind: "unknown", statusCode: 500, retryable: false, provider: "gemini",
          });
        }
        request.onProviderAttempt?.({ model: "gemini-3.5-flash-lite", outcome: "ok" });
        if (request.systemInstruction.includes("repair")) return " ";
        return site.draft;
      };
      const response = await (await loadAnswerRoute())(
        new NextRequest("http://localhost/api/ai/answer", {
          method: "POST",
          body: JSON.stringify({ question: "May the House suspend the sitting?" }),
        }),
        {
          generateJson, streamText,
          searchProceduralAuthorities: async (): Promise<ProceduralSearchResponse> => ({
            query: "suspension", corpus: null, limit: 10, offset: 0, total: 1, hasMore: false,
            results: [source],
          }),
          loadHeadings: async () => [],
          selectV517ProductionAuthorities: async () => ({
            finalAuthorities: [source],
            prePruneLabels: [], selectedLabels: [], prunedRedundant: [],
            minObligationCoverage: 1, allObligationsComplete: true,
            obligationDetails: [{ coverage: 1, complete: true }],
            candidateCount: 1,
            evidenceAdmission: "synthetic", rejectedAuthorities: [],
          }),
        },
      );
      const text = await response.text();
      const parsed: Array<{ event: string; data: Record<string, unknown> }> = [];
      for (const block of text.split("\n\n")) {
        let event = "";
        const data: string[] = [];
        for (const line of block.split("\n")) {
          if (line.startsWith("event: ")) event = line.slice(7).trim();
          else if (line.startsWith("data: ")) data.push(line.slice(6));
        }
        if (event && data.length > 0) parsed.push({ event, data: JSON.parse(data.join("\n")) as Record<string, unknown> });
      }
      return parsed;
    });
    const done = doneOf(events);
    assert.equal(done.fallbackCode, site.code, `${site.kind} ${site.code}`);
    const doneAuthorities = done.authorities as Array<{ citationLabel?: string; unconfirmed?: boolean }>;
    const panel = (events.find((item) => item.event === "authorities")?.data.authorities ?? []) as Array<{
      citationLabel?: string;
      unconfirmed?: boolean;
    }>;
    for (const list of [doneAuthorities, panel]) {
      assert.equal(list.some((item) => item.citationLabel === "SO 1"), false, site.code);
      assert.ok(list.every((item) => item.unconfirmed === false), site.code);
    }
  }
});

test("every client authority list is filtered before the flag is set", () => {
  const source = readFileSync(new URL("../app/api/ai/answer/route.ts", import.meta.url), "utf8");
  assert.equal(source.includes("withUnconfirmed("), false);
  assert.ok((source.match(/listedAuthorities\(/g) ?? []).length >= 10);
});

test("an unretrieved citation falls back and the done answer is not answered", async () => {
  const done = doneOf(await ask("fallback"));
  assert.equal(done.answerState, "not_answered");
  assert.equal(done.fallbackCode, "invalid_citations");
  assert.deepEqual(done.invalidCitations, []);
  assert.match(String(done.claimValidationNote), /invalid_citations=1/);
  assert.equal(String(done.claimValidationNote).includes("SO 99"), false);
});

test("planner text does not appear in any streamed event or the debug snapshot", async () => {
  const markers = ["SO 999ZZ", "99/999", "Gloriana Ceremonial Rule"];
  for (const scenario of ["planner_leak", "planner_leak_incident"] as const) {
    const events = await ask(scenario);
    const blob = JSON.stringify(events);
    for (const marker of markers) assert.equal(blob.includes(marker), false, `${scenario} ${marker}`);
    assert.equal(events.some((item) => item.event === "plan"), false, scenario);
    const done = events.find((item) => item.event === "done");
    assert.equal(Object.prototype.hasOwnProperty.call(done?.data ?? {}, "plan"), false, scenario);
    if (scenario === "planner_leak_incident") assert.equal(done?.data.fallbackCode, "not_responsive");
    const diagnostics = events.find((item) => item.event === "diagnostics")?.data ?? {};
    const snapshot = formatAiDebugSnapshot({
      ...EMPTY_AI_DIAGNOSTICS,
      ...(diagnostics as object),
      retrievals: (diagnostics as { retrievals?: never[] }).retrievals ?? [],
    });
    for (const marker of markers) assert.equal(snapshot.includes(marker), false, `${scenario} snapshot ${marker}`);
  }
});

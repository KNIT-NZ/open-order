import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { withCorpusCommitteeNames } from "../lib/committee-names-context";
import type { AiGenerateJsonRequest, AiStreamTextRequest } from "../lib/ai/types";
import type { ProceduralSearchResponse, ProceduralSearchResult } from "../lib/procedural-search";
import { forumIdentityOutcome } from "../lib/procedural-mechanisms";

// The route module constructs the corpus pool on import. CI has no database.
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
const NAMES = ["Bramble Oversight Committee", "Lumen Review Committee"];

type Cell = {
  id: string;
  setting: string;
  path: string[];
  outcome: "match" | "reject" | "uncertain";
};

/** One row per ruling. Names are synthetic and are not the reviewer's probes. */
const CELLS: Cell[] = [
  { id: "same-body", setting: "Bramble Oversight Committee", path: ["Chapter 2", "Sittings of the House", "Functions of the Bramble Oversight Committee"], outcome: "match" },
  { id: "different-body", setting: "Lumen Review Committee", path: ["Bramble Oversight Committee"], outcome: "reject" },
  { id: "generic-committee", setting: "a select committee", path: ["Bramble Oversight Committee"], outcome: "match" },
  { id: "house-specific-leaf", setting: "the House", path: ["Chapter 2", "Sittings of the House", "BRAMBLE OVERSIGHT COMMITTEE", "Bramble Oversight Committee"], outcome: "uncertain" },
  { id: "house-ancestor-committee", setting: "the House", path: ["Select committees", "SO 9", "Chairperson"], outcome: "uncertain" },
  { id: "house-generic-leaf", setting: "the House", path: ["Select committees"], outcome: "uncertain" },
  { id: "cotwh-specific-body", setting: "Committee of the whole House", path: ["Bramble Oversight Committee"], outcome: "reject" },
  { id: "house-level-leaf", setting: "the House", path: ["Chapter 2", "Sittings of the House"], outcome: "match" },
  { id: "chamber-is-house", setting: "the Chamber", path: ["Sittings of the House"], outcome: "match" },
  { id: "cotwh-house", setting: "Committee of the whole House", path: ["Sittings of the House"], outcome: "uncertain" },
  { id: "committee-house-ancestor", setting: "Bramble Oversight Committee", path: ["Chapter 2", "Sittings of the House", "ATTENDANCE", "Leave of absence"], outcome: "uncertain" },
  { id: "longer-unlisted", setting: "Harbor Bramble Committee", path: ["Bramble Oversight Committee"], outcome: "uncertain" },
  { id: "prefix-only-is-unlisted", setting: "Purpose Committee", path: ["Bramble Oversight Committee"], outcome: "uncertain" },
  { id: "proceeding-self", setting: "the Pylon address", path: ["Chapter 7", "ADDRESSES", "the Pylon address"], outcome: "match" },
  { id: "proceeding-ancestor-name", setting: "the Pylon address", path: ["Chapter 7", "QUILL ADDRESS", "the Pylon address"], outcome: "match" },
  { id: "proceeding-different-name", setting: "the Pylon address", path: ["Chapter 7", "PYLON ADDRESS", "the Quill address"], outcome: "uncertain" },
  { id: "proceeding-other-head", setting: "the Pylon address", path: ["Chapter 7", "PYLON ADDRESS", "Debate takes precedence"], outcome: "uncertain" },
  { id: "proceeding-specific-body", setting: "the Pylon address", path: ["Bramble Oversight Committee"], outcome: "uncertain" },
  { id: "multi-kind-stage", setting: "the committee stage", path: ["Chapter 5", "Bills", "the Copper reading stage"], outcome: "uncertain" },
  { id: "multi-kind-pass", setting: "debate on the Bramble Oversight Committee", path: ["Chapter 2", "Sittings of the House", "debate on the Bramble Oversight Committee"], outcome: "match" },
  { id: "debate-before-motion", setting: "urgency motion", path: ["debate on the urgency motion"], outcome: "uncertain" },
  { id: "house-proceeding-leaf", setting: "the House", path: ["Debate on committee reports"], outcome: "uncertain" },
  { id: "specific-house-proceeding", setting: "the House during oral questions", path: ["Bramble Oversight Committee"], outcome: "reject" },
  { id: "unlisted-house-phrase", setting: "the House during question time", path: ["Bramble Oversight Committee"], outcome: "uncertain" },
  { id: "bare-debate", setting: "the House", path: ["Chapter 2", "SITTINGS", "Debate"], outcome: "match" },
  { id: "classless-self", setting: "Asking a question", path: ["Chapter 3", "QUESTIONS", "Asking a question"], outcome: "match" },
  { id: "whole-word-not-prefix", setting: "the second", path: ["Chapter 4", "SECONDER", "a note"], outcome: "uncertain" },
  { id: "whole-word-self", setting: "the second", path: ["Chapter 4", "SECONDER", "the second"], outcome: "match" },
];

test("the forum decision table covers every ruling", () => {
  withCorpusCommitteeNames(NAMES, () => {
    for (const cell of CELLS) {
      assert.equal(forumIdentityOutcome(cell.setting, cell.path), cell.outcome, cell.id);
    }
    assert.notEqual(forumIdentityOutcome("the second", ["the seconder"]), "match");
  });
});

function authority(path: string[]): ProceduralSearchResult {
  return {
    sectionId: "s1",
    sectionKey: "s1",
    citationLabel: "SO 1",
    heading: path[path.length - 1] ?? "Suspension",
    path,
    pathText: path.join(" / "),
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
      bodyPhraseMatch: false,
      pathPhraseMatch: false,
      headingPhraseMatch: false,
    },
  };
}

async function askCell(cell: Cell, kind: "procedure" | "incident") {
  const source = authority(cell.path);
  const draft = `Bottom line:\n${QUOTE} [SO 1]\n\nWhat this means:\n${QUOTE} [SO 1]\n\nSettlement: supported`;
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
      const value = {
        intent: "explain_rule",
        preferredCorpus: null,
        searchQueries: ["suspension of the sitting"],
        salientTerms: ["suspension"],
        notes: "synthetic",
        situation: {
          kind,
          actor: "member",
          setting: cell.setting,
          action: "suspend the sitting",
          affectedPerson: "",
          proceduralMoment: "debate",
          decisionQuestion: "May the House suspend the sitting?",
          materialFacts: kind === "incident" ? ["an occurrence was recorded"] : [],
          verb: "suspend",
          object: "sitting",
        },
      };
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
        query: "suspension", corpus: null, limit: 10, offset: 0, total: 1, hasMore: false, results: [source],
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
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  for (const block of text.split("\n\n")) {
    let event = "";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) event = line.slice(7).trim();
      else if (line.startsWith("data: ")) data.push(line.slice(6));
    }
    if (event && data.length > 0) events.push({ event, data: JSON.parse(data.join("\n")) as Record<string, unknown> });
  }
  const done = events.find((item) => item.event === "done");
  assert.ok(done, `${cell.id} sent a done event`);
  return done.data;
}

test("every decision-table cell runs on both routes", async () => {
  await withCorpusCommitteeNames(NAMES, async () => {
    for (const cell of CELLS) {
      for (const kind of ["procedure", "incident"] as const) {
        const done = await askCell(cell, kind);
        const label = `${kind} ${cell.id}`;
        if (cell.outcome === "match") {
          assert.equal(done.answerState, "supported", label);
          assert.equal(done.route, kind === "incident" ? "incident_adjudication" : "semantic_selector", label);
          const listed = done.authorities as Array<{ citationLabel?: string; unconfirmed?: boolean }>;
          assert.equal(listed.find((item) => item.citationLabel === "SO 1")?.unconfirmed, false, label);
        } else if (cell.outcome === "reject") {
          assert.equal(done.answerState, "not_answered", label);
          assert.notEqual(done.answerState, "supported", label);
          assert.deepEqual(done.authorities, [], label);
        } else {
          assert.equal(done.answerState, "partial", label);
          assert.notEqual(done.answerState, "supported", label);
          assert.deepEqual(done.authorities, [], label);
        }
      }
    }
  });
});

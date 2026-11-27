import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { withCorpusCommitteeNames } from "../lib/committee-names-context";
import type { AiGenerateJsonRequest, AiStreamTextRequest } from "../lib/ai/types";
import type { ProceduralSearchResponse, ProceduralSearchResult } from "../lib/procedural-search";

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
const NAMES = ["Bramble Oversight Committee"];
const MATCH_PATH = ["Chapter 2", "Sittings of the House", "Functions of the Bramble Oversight Committee"];
const QUALIFIED_PATH = ["Chapter 2", "Sittings of the House", "ATTENDANCE", "Leave of absence"];

type Listed = { citationLabel?: string; unconfirmed?: boolean };

function source(label: string, id: string, path: string[]): ProceduralSearchResult {
  return {
    sectionId: id,
    sectionKey: id,
    citationLabel: label,
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

async function ask(results: ProceduralSearchResult[]) {
  const draft = `Bottom line:\n${QUOTE} [SO 1]\n\nWhat this means:\n${QUOTE} [SO 1]\n\nSettlement: supported`;
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
          kind: "procedure",
          actor: "member",
          setting: "Bramble Oversight Committee",
          action: "suspend the sitting",
          affectedPerson: "",
          proceduralMoment: "debate",
          decisionQuestion: "May the House suspend the sitting?",
          materialFacts: [],
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
        query: "suspension", corpus: null, limit: 10, offset: 0, total: results.length, hasMore: false, results,
      }),
      loadHeadings: async () => [],
      selectV517ProductionAuthorities: async () => ({
        finalAuthorities: results,
        prePruneLabels: [], selectedLabels: [], prunedRedundant: [],
        minObligationCoverage: 1, allObligationsComplete: true,
        obligationDetails: [{ coverage: 1, complete: true }],
        candidateCount: results.length,
        evidenceAdmission: "synthetic", rejectedAuthorities: [],
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
  const panel = (events.find((item) => item.event === "authorities")?.data.authorities ?? []) as Listed[];
  const done = events.find((item) => item.event === "done");
  assert.ok(done, "sent a done event");
  const listed = (done.data.authorities ?? []) as Listed[];
  return { panel, listed, state: String(done.data.answerState ?? "") };
}

function labels(list: Listed[]) {
  return list.map((item) => `${item.citationLabel}:${item.unconfirmed ? "qualified" : "supported"}`);
}

test("admitted sources stay in both citation lists", async () => {
  await withCorpusCommitteeNames(NAMES, async () => {
    const qualified = await ask([source("SO 1", "s1", QUALIFIED_PATH)]);
    assert.notEqual(qualified.state, "supported");
    assert.deepEqual(labels(qualified.panel), ["SO 1:qualified"]);
    assert.deepEqual(labels(qualified.listed), labels(qualified.panel));

    const mixed = await ask([
      source("SO 1", "s1", MATCH_PATH),
      source("SO 2", "s2", QUALIFIED_PATH),
    ]);
    assert.notEqual(mixed.state, "supported");
    assert.deepEqual(labels(mixed.panel), ["SO 1:supported", "SO 2:qualified"]);
    assert.deepEqual(labels(mixed.listed), labels(mixed.panel));

    const none = await ask([]);
    assert.equal(none.state, "not_answered");
    assert.deepEqual(none.panel, []);
    assert.deepEqual(none.listed, []);
  });
});

import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { withCorpusCommitteeNames } from "../lib/committee-names-context";
import type { AiGenerateJsonRequest, AiStreamTextRequest } from "../lib/ai/types";
import type { ProceduralSearchResponse, ProceduralSearchResult } from "../lib/procedural-search";
import { authoritiesReferencedByAnswer } from "../lib/procedural-mechanisms.js";

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

async function ask(input: { results: ProceduralSearchResult[]; draft?: string; rejectClaimIncluding?: string }) {
  const cited = input.results.map((item) => `[${item.citationLabel}]`).join(" ");
  const draft = input.draft ?? `Bottom line:\n${QUOTE} ${cited}\n\nWhat this means:\n${QUOTE} ${cited}\n\nSettlement: supported`;
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
      claims: found.map((match) => ({
        id: match[1],
        supported: input.rejectClaimIncluding ? !match[2].includes(input.rejectClaimIncluding) : true,
        reason: "checked",
      })),
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
        query: "suspension", corpus: null, limit: 10, offset: 0, total: input.results.length, hasMore: false,
        results: input.results,
      }),
      loadHeadings: async () => [],
      selectV517ProductionAuthorities: async () => ({
        finalAuthorities: input.results,
        prePruneLabels: [], selectedLabels: [], prunedRedundant: [],
        minObligationCoverage: 1, allObligationsComplete: true,
        obligationDetails: [{ coverage: 1, complete: true }],
        candidateCount: input.results.length,
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
  return { panel, listed, state: String(done.data.answerState ?? ""), text: String(done.data.answerText ?? "") };
}

function labels(list: Listed[]) {
  return list.map((item) => `${item.citationLabel}:${item.unconfirmed ? "qualified" : "supported"}`);
}

test("the citation filter recognises a qualified source", () => {
  const matched = authoritiesReferencedByAnswer(
    "The sitting may be suspended [SO 1].",
    [{ citationLabel: "SO 1", unconfirmed: true }, { citationLabel: "SO 2", unconfirmed: false }],
  );
  assert.deepEqual(matched.map((item) => item.citationLabel), ["SO 1"]);
});

test("a citation token matches the whole label, so SO 12 does not list SO 1", () => {
  const pack = [{ citationLabel: "SO 1" }, { citationLabel: "SO 12" }];
  assert.deepEqual(
    authoritiesReferencedByAnswer("See [SO 12].", pack).map((item) => item.citationLabel),
    ["SO 12"],
  );
  assert.deepEqual(
    authoritiesReferencedByAnswer("See [SO 1].", pack).map((item) => item.citationLabel),
    ["SO 1"],
  );
  assert.deepEqual(
    authoritiesReferencedByAnswer("See [SO 1(2)].", pack).map((item) => item.citationLabel),
    ["SO 1"],
  );
});

test("an answer that cites no admitted label lists nothing", () => {
  const pack = [{ citationLabel: "SO 1" }, { citationLabel: "SO 2" }];
  assert.deepEqual(authoritiesReferencedByAnswer("The House may sit.", pack), []);
  assert.deepEqual(authoritiesReferencedByAnswer("See [SO 99].", pack), []);
});

test("a qualified-only admission is listed as Qualified", async () => {
  await withCorpusCommitteeNames(NAMES, async () => {
    const result = await ask({ results: [source("SO 1", "s1", QUALIFIED_PATH)] });
    assert.notEqual(result.state, "supported");
    assert.match(result.text, /\[SO 1\]/);
    assert.deepEqual(labels(result.panel), ["SO 1:qualified"]);
    assert.deepEqual(labels(result.listed), labels(result.panel));
  });
});

test("a mixed admission lists the supported source and the qualified source", async () => {
  await withCorpusCommitteeNames(NAMES, async () => {
    const result = await ask({
      results: [source("SO 1", "s1", MATCH_PATH), source("SO 2", "s2", QUALIFIED_PATH)],
    });
    assert.notEqual(result.state, "supported");
    assert.deepEqual(labels(result.panel), ["SO 1:supported", "SO 2:qualified"]);
    assert.deepEqual(labels(result.listed), labels(result.panel));
  });
});

test("no admission leaves both citation lists empty", async () => {
  await withCorpusCommitteeNames(NAMES, async () => {
    const result = await ask({ results: [] });
    assert.equal(result.state, "not_answered");
    assert.deepEqual(result.panel, []);
    assert.deepEqual(result.listed, []);
  });
});

test("an answer that cites only SO 1 lists only SO 1", async () => {
  await withCorpusCommitteeNames(NAMES, async () => {
    const result = await ask({
      results: [source("SO 1", "s1", MATCH_PATH), source("SO 2", "s2", MATCH_PATH)],
      draft: `Bottom line:\n${QUOTE} [SO 1]\n\nWhat this means:\n${QUOTE} [SO 1]\n\nSettlement: supported`,
    });
    assert.deepEqual(labels(result.panel), ["SO 1:supported"]);
    assert.deepEqual(labels(result.listed), labels(result.panel));
  });
});

test("a source removed by claim validation is not listed", async () => {
  await withCorpusCommitteeNames(NAMES, async () => {
    const result = await ask({
      results: [source("SO 1", "s1", MATCH_PATH), source("SO 2", "s2", MATCH_PATH)],
      draft: `Bottom line:\n${QUOTE} [SO 1]\n\nWhat this means:\nA separate point [SO 2].\n\nSettlement: supported`,
      rejectClaimIncluding: "[SO 2]",
    });
    assert.equal(result.text.includes("[SO 2]"), false);
    assert.deepEqual(labels(result.panel), ["SO 1:supported"]);
    assert.deepEqual(labels(result.listed), labels(result.panel));
  });
});

test("a not_answered answer lists no qualified source", async () => {
  await withCorpusCommitteeNames(NAMES, async () => {
    const result = await ask({
      results: [source("SO 1", "s1", QUALIFIED_PATH)],
      draft: `Bottom line:\n${QUOTE} [SO 99]\n\nWhat this means:\n${QUOTE} [SO 99]\n\nSettlement: supported`,
    });
    assert.equal(result.state, "not_answered");
    assert.deepEqual(result.panel, []);
    assert.deepEqual(result.listed, []);
  });
});

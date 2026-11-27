import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NextRequest } from "next/server";
import { withCorpusCommitteeNames } from "../lib/committee-names-context";
import type { AiGenerateJsonRequest, AiStreamTextRequest } from "../lib/ai/types";
import type { ProceduralSearchResponse, ProceduralSearchResult } from "../lib/procedural-search";

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgresql://localhost/open_order_route_test?sslmode=disable";
}

const specBytes = readFileSync(new URL("./fixtures/forum-spec-v2.27.json", import.meta.url));
assert.equal(createHash("sha256").update(specBytes).digest("hex"), "83baf89ab236b77a9b532fa69b3f4d08bd3f80a8527075e8acb570e85f91c5df");
const spec = JSON.parse(specBytes.toString("utf8"));

type SpecRow = {
  id: string;
  setting: string;
  question: string;
  action: string;
  body: string;
  path: Array<{ text: string }>;
  committeeList: "fixture" | "empty" | "classLed";
  routes: string[];
  softActMiss: boolean;
  expected: Record<string, string>;
  deferred?: string | null;
  informationOnly?: string | null;
};

type RunAnswerRoute = typeof import("../app/api/ai/answer/route").runAnswerRoute;
let runAnswerRoute: RunAnswerRoute | undefined;
async function loadAnswerRoute(): Promise<RunAnswerRoute> {
  runAnswerRoute ??= (await import("../app/api/ai/answer/route")).runAnswerRoute;
  return runAnswerRoute;
}

function authority(row: SpecRow): ProceduralSearchResult {
  const path = row.path.map((segment) => segment.text);
  return {
    sectionId: "s1",
    sectionKey: "s1",
    citationLabel: "SO 1",
    heading: "Rule",
    path,
    pathText: path.join(" "),
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
    sectionContent: row.body,
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

async function ask(row: SpecRow, route: "selector" | "adjudication") {
  const source = authority(row);
  const kind = route === "selector" ? "procedure" : "incident";
  const draft = `Bottom line:\n${row.body} [SO 1]\n\nWhat this means:\n${row.body} [SO 1]\n\nSettlement: supported`;
  const generateJson = async <T,>(request: AiGenerateJsonRequest): Promise<T> => {
    request.onProviderAttemptStart?.("gemini-3.5-flash-lite");
    if (request.systemInstruction.includes("PROCEDURAL SOURCE adjudicator")) {
      const value = {
        selected: [{
          citationLabel: "SO 1", role: "governing", exactQuote: row.body,
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
        searchQueries: [row.action],
        salientTerms: [row.action],
        notes: "synthetic",
        situation: {
          kind,
          actor: "member",
          setting: row.setting,
          action: row.action,
          affectedPerson: "",
          proceduralMoment: "debate",
          decisionQuestion: row.question,
          materialFacts: kind === "incident" ? ["a member made a request during the proceedings"] : [],
          verb: row.action.split(" ")[0] ?? "",
          object: row.action.split(" ").slice(1).join(" "),
        },
      };
      request.validate?.(value);
      request.onProviderAttempt?.({ model: "gemini-3.5-flash-lite", outcome: "ok" });
      return value as T;
    }
    if (request.systemInstruction.includes("repair a missing Bottom line")) {
      const value = { bottomLine: `${row.body} [SO 1]` };
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
      body: JSON.stringify({ question: row.question }),
    }),
    {
      generateJson,
      streamText,
      searchProceduralAuthorities: async (): Promise<ProceduralSearchResponse> => ({
        query: row.action, corpus: null, limit: 10, offset: 0, total: 1, hasMore: false, results: [source],
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
  assert.ok(done, `${row.id} ${route} sent a done event`);
  const summary = events.find((item) => item.event === "diagnostics")?.data.selectorSummary as { forumCodes?: string[] } | undefined;
  return { done: done.data, codes: summary?.forumCodes ?? [] };
}

function observed(done: Record<string, unknown>, codes: string[]): string {
  const state = String(done.answerState ?? "");
  const authorities = (done.authorities ?? []) as Array<{ citationLabel?: string }>;
  const withheld = codes.some((code) => /^selector_forum=forum-identity:[1-9]\d*$/.test(code))
    && !authorities.some((item) => item.citationLabel === "SO 1")
    && state !== "supported";
  if (withheld) return "withheld";
  if (state === "supported") return "supported";
  if (state === "partial") return "qualified_partial";
  return state || "not_answered";
}

test("forum spec v2.27 matches the fixture on either route", async () => {
  const counts: Record<string, { pass: number; fail: number }> = {};
  const failures: string[] = [];
  let falseSupported = 0;
  for (const row of spec.rows as SpecRow[]) {
    if (row.deferred || row.informationOnly === "batch2-log") continue;
    const names = spec.fixtures.committeeList[row.committeeList] as string[];
    await withCorpusCommitteeNames(names, async () => {
      for (const route of row.routes) {
        if (route !== "selector" && route !== "adjudication") continue;
        const expected = row.expected[route];
        if (!expected) continue;
        const result = await ask(row, route);
        const got = observed(result.done, result.codes);
        const bucket = counts[expected] ??= { pass: 0, fail: 0 };
        if (got === expected) bucket.pass += 1;
        else {
          bucket.fail += 1;
          if (got === "supported") falseSupported += 1;
          failures.push(`${row.id} ${route} expected ${expected} got ${got}`);
        }
      }
    });
  }
  assert.equal(falseSupported, 0, failures.join("\n"));
  assert.deepEqual(failures, [], JSON.stringify(counts));
});

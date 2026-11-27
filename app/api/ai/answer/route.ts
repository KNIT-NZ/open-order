// app/api/ai/answer/route.ts
import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { clientCheckNote, forumCountCodes } from "@/lib/open-order/client-check-note";
import { CLAIM_ID_MAX_LENGTH, COUNT_DIGITS, FORUM_COUNT_WIDTH, boundedCount } from "@/lib/open-order/emitted-widths";
import { publicScenarioAdjudication } from "@/lib/open-order/public-diagnostics";
import { publicRetrievals } from "@/lib/open-order/public-search";
import { boundedElapsed, operationalRelease, operationalStage, type OperationalOutcome } from "@/lib/open-order/operational-event";
import { scheduleOperationalEvent } from "@/lib/open-order/operational-writer";
import { z } from "zod";
import { searchPlanSchema } from "@/lib/ai/search-plan-schema";
import { generateJson, streamText } from "@/lib/ai";
import type { AiTask } from "@/lib/ai/types";
import {
  ANSWER_STREAM_DEADLINE_MS,
  ANSWER_STREAM_HEARTBEAT_MS,
  openGovernedAnswerStream,
} from "@/lib/open-order/answer-stream";
import {
  actorClassQualificationQuery,
  authoritiesReferencedByAnswer,
  authorisingRuleQueries,
  citationLabelsIn,
  collectRejectionKeys,
  deriveAnswerOutcome,
  deriveAnswerState,
  dropUnreferencedCitationEntries,
  errorCorrectionQueries,
  followOperatorChain,
  freezeFirstDraft,
  labelBareRulings,
  parseSettlement,
  obligationPartialFacets,
  forumIdentityOutcome,
  presidingOfficerAppealQuery,
  proceedingConsequenceQueries,
  recoverySuppressed,
  relationsFromPlanner,
  reasonFromProviderKind,
  resolveServedModel,
  selectOverlookedCandidates,
  stageReopeningQueries,
  tallyForumOutcomes,
} from "@/lib/procedural-mechanisms";
import {
  failureDiagnostic,
  publicFailureReason,
  runClaimValidationWithRetry,
  type AiOperationPhase,
} from "@/lib/ai/provider-resilience";
import {
  ANSWER_CLAIM_VALIDATOR_SYSTEM_PROMPT,
  ANSWER_CLAIM_APPEAL_SYSTEM_PROMPT,
  ANSWER_BOTTOM_LINE_RECOVERY_SYSTEM_PROMPT,
  buildBottomLineRecoveryPrompt,
  buildAnswerClaimAppealPrompt,
  ANSWER_STREAM_SYSTEM_PROMPT,
  buildAnswerClaimValidationPrompt,
  buildGroundedAnswerPrompt,
  buildSearchPlannerPrompt,
  SEARCH_PLANNER_SYSTEM_PROMPT,
  V40_SOURCE_ADJUDICATION_SYSTEM_PROMPT,
  V402_SOURCE_RECOVERY_SYSTEM_PROMPT,
  buildV40SourceAdjudicationPrompt,
  ANSWER_V401_INCIDENT_REPAIR_SYSTEM_PROMPT,
  buildV401IncidentRepairPrompt,
} from "@/lib/ai/prompts";
import { findOmittedSourceQualifications } from "@/lib/ai/qualification-guard";
import {
  adjudicationRouting, admitJudgedOverlooked, buildV40Dossier, validateV40Proposal,
  v40SourceScopeMismatch,
  v401AcceptIndependentRepair, v402RecoveryCandidates, v402RepairRefusals,
  type V402Disposition, type V40Situation,
} from "@/lib/ai/scenario-adjudication";
import { corroborateClaimAppeal, rejectedBottomLineClaims } from "@/lib/ai/claim-appeal";
import { searchProceduralAuthorities } from "@/lib/procedural-search";
import {
  answerSectionHasContent,
  attachClaimQualifications,
  mentionRewriteEdit,
  appendEvidenceGapSection,
  buildAuthorityPayload,
  buildAuthorityProfile,
  buildCorpusBridgeSearchRequests,
  buildFallbackAnswer,
  firstDraftDebugEnabled,
  withholdingStage,
  buildMissingSlotRecoveryRequests,
  buildProceduralQueryPlan,
  describeMissingAuthoritySlots,
  extractAnswerClaims,
  inferConcepts,
  normalizeAnswerCitationLabels,
  normalizeAnswerFormatting,
  pruneUnsupportedAnswerClaims,
  removeEmptyAnswerSections,
  pruneValidatedAnswerContent,
  rewriteForbiddenAuthorityMentions,
  selectFinalAuthorities,
  selectV517ProductionAuthorities,
  type SearchExecution,
  validateAnswerAuthorityMentions,
  validateAnswerCitations,
} from "@/lib/procedural-reasoning";

const aiAnswerRequestSchema = z.object({
  question: z.string().min(1, "Question is required"),
  corpus: z.enum(["standing_orders", "speakers_rulings"]).nullable().optional(),
});

const v40SourceAdjudicationSchema = z.object({
  selected: z.array(z.object({
    citationLabel: z.string().min(1).max(24),
    role: z.enum(["governing", "qualification", "implementation"]),
    exactQuote: z.string().min(1).max(900),
    actorMatches: z.boolean(),
    settingMatches: z.boolean(),
    actionMatches: z.boolean(),
    stageMatches: z.boolean(),
    rationale: z.string().max(400),
  })).max(10),
  remainingUncertainties: z.array(z.string().max(280)).max(5),
  explanation: z.string().max(500),
});

const claimValidationSchema = z.object({
  claims: z.array(
    z.object({
      id: z.string().min(1),
      supported: z.boolean(),
      reason: z.string(),
    }),
  ),
  responsiveness: z.object({
    answersUserQuestion: z.boolean(),
    reason: z.string().max(500),
    unaddressedParts: z.array(z.string().max(180)).max(5),
  }).optional(),
});

const bottomLineRecoverySchema = z.object({bottomLine: z.string().max(900)});

const claimAppealSchema = z.object({
  claims: z.array(z.object({
    id: z.string().min(1),
    supported: z.boolean(),
    reason: z.string(),
    witnesses: z.array(z.object({
      citationLabel: z.string().min(1),
      exactQuote: z.string(),
    })).max(8),
  })).max(2),
});

type AuthorityPayload = ReturnType<typeof buildAuthorityPayload>[number];

// Plan assumption: the platform honours this literal. Next.js requires a
// static literal here; the stream deadline is derived from the same number
// in lib/open-order/answer-stream.js (ANSWER_ROUTE_MAX_DURATION_SECONDS).
export const maxDuration = 300;

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

type AnswerRouteDeps = {
  generateJson?: typeof generateJson;
  streamText?: typeof streamText;
  searchProceduralAuthorities?: typeof searchProceduralAuthorities;
  selectV517ProductionAuthorities?: typeof selectV517ProductionAuthorities;
  loadHeadings?: () => Promise<string[]>;
};

export async function POST(request: NextRequest) {
  return runAnswerRoute(request);
}

export async function runAnswerRoute(request: NextRequest, deps: AnswerRouteDeps = {}) {
  const generate = deps.generateJson ?? generateJson;
  const streamAnswer = deps.streamText ?? streamText;
  const searchAuthorities = deps.searchProceduralAuthorities ?? searchProceduralAuthorities;
  const selectAuthorities = deps.selectV517ProductionAuthorities ?? selectV517ProductionAuthorities;
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return new Response(sseEvent("error", { message: "Invalid JSON body", reason: "invalid_request", retryable: false, kind: "validation" }), {
      status: 400,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "private, no-store, no-transform",
        "Referrer-Policy": "no-referrer",
      },
    });
  }

  const parsed = aiAnswerRequestSchema.safeParse(body);

  if (!parsed.success) {
    return new Response(
      sseEvent("error", {
        message: "Invalid request body",
        reason: "invalid_request",
        retryable: false,
        kind: "validation",
        details: parsed.error.flatten(),
      }),
      {
        status: 400,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "private, no-store, no-transform",
          "Referrer-Policy": "no-referrer",
        },
      },
    );
  }

  const { question, corpus = null } = parsed.data;
  const startedAt = Date.now();
      const requestId = randomUUID();
      // Vercel supplies the public deployment commit when available.
      const buildCommit = process.env.VERCEL_GIT_COMMIT_SHA ?? null;
      const stageTimeline: Array<{ key: string; label: string; atMs: number }> = [];
      let incidentRepair: string | null = null;
      // Capture only a closed, content-free projection of the existing stream lifecycle.
      let opsOutcome: OperationalOutcome = "incomplete";
      let opsElapsed: number | null = null;
      const markOperationalTerminal = <T extends "done" | "error">(event: T): T => {
        if (opsOutcome === "incomplete") {
          opsOutcome = event === "done" ? "completed" : "failed";
          opsElapsed = boundedElapsed(startedAt);
        }
        return event;
      };
      scheduleOperationalEvent(() => ({ schemaVersion: 1, requestId, route: "ai_answer",
        outcome: opsOutcome, elapsedMs: opsElapsed ?? boundedElapsed(startedAt), resultCount: null,
        stageCount: Math.min(stageTimeline.length, 1000),
        lastStage: stageTimeline.length ? operationalStage(stageTimeline[stageTimeline.length - 1]?.key) : "none",
        releaseSha: operationalRelease(process.env.VERCEL_GIT_COMMIT_SHA) }));
      const outcomeState = {
        route: "semantic_selector" as "incident_adjudication" | "semantic_selector",
        providerRetries: 0,
        adjudicationRecovery: false,
        evidenceRecovery: false,
        repairAttempted: false,
        repairAccepted: false,
        appealAttempted: false,
        appealAccepted: false,
        fallbackCode: "none",
        partial: [] as string[],
        abstained: false,
        allObligationsComplete: true,
        obligationCoverage: [] as number[],
        settlement: null as "supported" | "partial" | "not_answered" | null,
        uncertainty: [] as Array<{ class: string; facet: string }>,
        recoveredAuthorities: [] as string[],
        pruned: false,
        rewritten: false,
      };
      let firstDraftRecord: ReturnType<typeof freezeFirstDraft> | null = null;
      let answerEdits: string[] = [];
      let mentionRewrites = 0;
      const claimRemovalCounts: Record<string, number> = {};
      const noteClaimRemovals = (codes: readonly string[]) => {
        for (const code of codes) {
          if (!/^[a-z0-9_]{1,40}$/.test(code)) continue;
          claimRemovalCounts[code] = (claimRemovalCounts[code] ?? 0) + 1;
        }
      };
      let adjudicationTrace: {
        nominationCount: number;
        unavailableNominations: number;
        dossierOutcomes: string[];
      } = { nominationCount: 0, unavailableNominations: 0, dossierOutcomes: [] };
      // `other` is a failed attempt that was not a 429, a 5xx, or a timeout.
      const providerAttempts: Array<{ model: string; outcome: "ok" | "429" | "5xx" | "timeout" | "other" }> = [];
      const stageModels: Array<{ task: string; model: string; outcome: "ok" | "429" | "5xx" | "timeout" | "other" }> = [];
      let openAttemptIndex: number | null = null;
      let lastAttemptedModel: string | null = null;
      let answerModel: string | null = null;
      let repairModel: string | null = null;
      let activeSignal: AbortSignal | undefined;
        const noteRetry = () => { outcomeState.providerRetries += 1; };
        const noteCheckedWithholding = () => {
          if (!outcomeState.partial.includes("partial")) outcomeState.partial.push("partial");
          if (outcomeState.uncertainty.length < 6 && !outcomeState.uncertainty.some((item) => item.facet === "claim withheld after checking")) {
            outcomeState.uncertainty.push({ class: "retrieval_uncertainty", facet: "claim withheld after checking" });
          }
        };
        const noteEvidenceGap = (facet: string) => {
          if (!outcomeState.partial.includes("evidence_gap")) outcomeState.partial.push("evidence_gap");
          if (outcomeState.uncertainty.length < 6 && !outcomeState.uncertainty.some((item) => item.facet === facet)) {
            outcomeState.uncertainty.push({ class: "retrieval_uncertainty", facet });
          }
        };
      const beginAttempt = (model: string) => {
        lastAttemptedModel = model;
        providerAttempts.push({ model, outcome: "timeout" });
        openAttemptIndex = providerAttempts.length - 1;
      };
      const recordAttempt = (task: string, attempt: { model: string; outcome: "ok" | "429" | "5xx" | "timeout" | "other" }) => {
        if (openAttemptIndex !== null && providerAttempts[openAttemptIndex]?.model === attempt.model) {
          providerAttempts[openAttemptIndex] = { model: attempt.model, outcome: attempt.outcome };
          openAttemptIndex = null;
        } else {
          providerAttempts.push({ model: attempt.model, outcome: attempt.outcome });
        }
        lastAttemptedModel = attempt.model;
        if (task === "query.plan" || task === "scenario.adjudication" || task === "source.recovery"
          || task === "answer.generate" || task === "answer.validate" || task === "answer.repair") {
          stageModels.push({ task, model: attempt.model, outcome: attempt.outcome });
        }
        if (task === "answer.generate" && attempt.outcome === "ok") answerModel = attempt.model;
        if (task === "answer.repair" && attempt.outcome === "ok") repairModel = attempt.model;
      };
      // Only models that actually served a stage. A failed attempt does not count.
      const mixedModels = () => new Set(stageModels.filter((attempt) => attempt.outcome === "ok").map((attempt) => attempt.model)).size > 1;
      // Last model whose attempt started. This does not mean the attempt succeeded;
      // read providerAttempts for each outcome.
      const servedModel = () => resolveServedModel(answerModel, lastAttemptedModel);
      const exposeFirstDraft = firstDraftDebugEnabled(process.env);
      const decorate = (event: string, data: unknown) => {
        if (event === "stage" && data && typeof data === "object") {
          const stage = data as { key?: unknown; label?: unknown };
          if (typeof stage.key === "string" && typeof stage.label === "string" && stageTimeline.length < 32) {
            stageTimeline.push({ key: stage.key, label: stage.label, atMs: Math.max(0, Date.now() - startedAt) });
          }
        }
        if (!(data && typeof data === "object")) return data;
        const record = data as Record<string, unknown>;
        const shown = event === "done" && Array.isArray(record.authorities)
          ? record.authorities as Array<{ unconfirmed?: boolean }>
          : [];
        const trace = {
          schemaVersion: 2,
          requestId,
          buildCommit,
          stageTimeline,
          incidentRepair,
          claimRemovalCounts: { ...claimRemovalCounts },
          adjudication: {
            nominationCount: adjudicationTrace.nominationCount,
            unavailableNominations: adjudicationTrace.unavailableNominations,
            dossierOutcomes: adjudicationTrace.dossierOutcomes.slice(),
          },
          shownAuthorities: {
            count: shown.length,
            unconfirmed: shown.filter((item) => item?.unconfirmed === true).length,
          },
        };
        if (event === "error") {
          const reason = typeof record.reason === "string"
            ? record.reason
            : reasonFromProviderKind(typeof record.kind === "string" ? record.kind : undefined);
          return {
            message: record.message,
            retryable: record.retryable === true,
            kind: record.kind ?? "unknown",
            reason,
            servedModel: servedModel(),
            mixedModels: mixedModels(),
            stageModels: stageModels.slice(),
            providerAttempts,
            trace,
          };
        }
        if (event === "done") {
          const outcome = deriveAnswerOutcome({ ...outcomeState, fallbackReason: outcomeState.fallbackCode });
          return {
            ...record,
            route: outcome.route,
            providerRetries: outcome.providerRetries,
            adjudicationRecovery: outcome.adjudicationRecovery,
            evidenceRecovery: outcome.evidenceRecovery,
            repairAttempted: outcome.repairAttempted,
            repairAccepted: outcome.repairAccepted,
            appealAttempted: outcome.appealAttempted,
            appealAccepted: outcome.appealAccepted,
            fallbackReason: outcome.fallbackReason === "none" ? null : outcome.fallbackReason,
            fallbackCode: outcome.fallbackReason,
            partial: outcome.partial,
            abstained: outcome.abstained,
            allObligationsComplete: outcome.allObligationsComplete,
            obligationCoverage: outcome.obligationCoverage,
            degraded: outcome.degraded,
            answerState: deriveAnswerState({
              ...outcomeState,
              fallbackReason: outcomeState.fallbackCode,
              answerEdits,
            }),
            uncertainty: outcomeState.uncertainty,
            recoveredAuthorities: outcomeState.recoveredAuthorities,
            servedModel: servedModel(),
            mixedModels: mixedModels(),
            stageModels: stageModels.slice(),
            providerAttempts,
            answerEdits,
            ...(exposeFirstDraft && firstDraftRecord ? { firstDraft: firstDraftRecord } : {}),
            trace,
          };
        }
        return data;
      };

      let send = (_event: string, _data?: unknown) => { void _event; void _data; };
      let citationList = (_answerText: string): Array<{ citationLabel?: string; unconfirmed?: boolean }> => [];
      const run = async () => {
        const started = startedAt;
        const callJson = <T,>(request: { task: AiTask; systemInstruction: string; prompt: string; temperature?: number; validate?: (value: unknown) => void }) =>
          generate<T>({
            ...request,
            signal: activeSignal,
            onProviderRetry: noteRetry,
            onProviderAttempt: (attempt) => recordAttempt(request.task, attempt),
            onProviderAttemptStart: beginAttempt,
          });
        const callText = (request: { task: AiTask; systemInstruction: string; prompt: string; temperature?: number }) =>
          streamAnswer({
            ...request,
            signal: activeSignal,
            onProviderRetry: noteRetry,
            onProviderAttempt: (attempt) => recordAttempt(request.task, attempt),
            onProviderAttemptStart: beginAttempt,
          });

        try {
          send("stage", {
            key: "planning",
            label: "Planning retrieval",
          });

          let headingLabels: string[] = [];
          if (deps.loadHeadings) {
            headingLabels = await deps.loadHeadings();
          } else {
            try {
              const { corpusHeadingLabels } = await import("@/lib/corpus-headings");
              headingLabels = await corpusHeadingLabels();
            } catch {
              headingLabels = [];
            }
          }
          const rawPlan = await callJson<unknown>({
            task: "query.plan",
            systemInstruction: SEARCH_PLANNER_SYSTEM_PROMPT,
            prompt: buildSearchPlannerPrompt({
              question,
              corpus,
              headingLabels,
            }),
            temperature: 0.1,
            validate: (value) => { searchPlanSchema.parse(value); },
          });

          const plan = searchPlanSchema.parse(rawPlan);
          // Only an explicit user corpus request may hard-filter retrieval.
          // The planner's preferredCorpus remains advisory metadata in the plan.
          const effectiveCorpus = corpus ?? null;
          const inferredConcepts = inferConcepts(question, plan.searchQueries);

          send("stage", {
            key: "retrieving",
            label: "Retrieving authorities",
          });

          // Permission to use equipment or be present is not authorisation for a
          // separately regulated act. Other expansions are relation-driven.
          const relationQueries = [
            ...authorisingRuleQueries(plan.situation),
            ...stageReopeningQueries(plan.situation),
            ...proceedingConsequenceQueries(plan.situation),
            ...errorCorrectionQueries(plan.situation),
            ...[presidingOfficerAppealQuery(plan.situation), actorClassQualificationQuery(plan.situation?.actor ?? "")]
              .filter((query): query is string => Boolean(query)),
          ];
          const scenarioFacets = [
            ...(plan.situation?.kind === "incident" ? plan.situation.evidenceQueries : []),
            ...relationQueries,
          ];
          const additionalScenarioQueries = scenarioFacets.filter((value, index, all) =>
              !plan.searchQueries.some((prior) => prior.toLowerCase() === value.toLowerCase()) &&
              all.findIndex((prior) => prior.toLowerCase() === value.toLowerCase()) === index,
            ).slice(0, 4);
          const queryPlan = buildProceduralQueryPlan({
            question,
            plannerQueries: [...plan.searchQueries, ...additionalScenarioQueries],
            salientTerms: plan.salientTerms,
            effectiveCorpus,
          });
          const expandedQueries = queryPlan.map((dimension) => dimension.query);

          const searches: SearchExecution[] = [];

          for (const dimension of queryPlan) {
            const searchResponse = await searchAuthorities({
              q: dimension.query,
              corpus: effectiveCorpus,
              limit: 10,
              offset: 0,
            });

            searches.push({
              query: dimension.query,
              corpus: effectiveCorpus,
              provenance: dimension.provenance,
              results: searchResponse.results,
            });
          }
          // The legacy query-plan utility may cap planned queries at three.
          // Run the two distinct incident facets independently if omitted;
          // never pretend they were included merely because the planner named them.
          for (const query of additionalScenarioQueries) {
            if (searches.some((search) => search.query.toLowerCase() === query.toLowerCase())) continue;
            const searchResponse = await searchAuthorities({
              q: query, corpus: effectiveCorpus, limit: 10, offset: 0,
            });
            searches.push({
              query, corpus: effectiveCorpus, provenance: "planner",
              results: searchResponse.results,
            });
            expandedQueries.push(query);
          }

          let selected = selectFinalAuthorities({
            searches,
            question,
            plannerQueries: plan.searchQueries,
          });

          const bridgeRequests = buildCorpusBridgeSearchRequests({
            searches,
            question,
            plannerQueries: plan.searchQueries,
            maxRequests: 2,
          });

          if (bridgeRequests.length > 0) {
            send("stage", {
              key: "retrieving",
              label: "Following corpus-native procedural breadcrumbs",
            });

            const existingBridgeSearchKeys = new Set(
              searches.map(
                (search) =>
                  `${search.corpus ?? "auto"}::${search.query.toLowerCase()}`,
              ),
            );
            let bridgeSearchCount = 0;

            for (const bridge of bridgeRequests) {
              const searchKey = `${bridge.corpus ?? "auto"}::${bridge.query.toLowerCase()}`;
              if (existingBridgeSearchKeys.has(searchKey)) continue;

              const searchResponse = await searchAuthorities({
                q: bridge.query,
                corpus: bridge.corpus,
                limit: 10,
                offset: 0,
              });

              searches.push({
                query: bridge.query,
                corpus: bridge.corpus,
                provenance: "corpus_bridge",
                bridgeSourceQuery: bridge.sourceQuery,
                bridgeSourceCitationLabel: bridge.sourceCitationLabel,
                results: searchResponse.results,
              });
              existingBridgeSearchKeys.add(searchKey);
              bridgeSearchCount += 1;
            }

            if (bridgeSearchCount > 0) {
              selected = selectFinalAuthorities({
                searches,
                question,
                plannerQueries: plan.searchQueries,
              });
            }
          }

          const recoveryAttempts: Array<{
            slotKey: string;
            query: string;
            corpus: string | null;
            resultCount: number;
          }> = [];

          if (!selected.blueprintSatisfied) {
            send("stage", {
              key: "retrieving",
              label: "Recovering missing authority evidence",
            });

            const recoveryRequests = buildMissingSlotRecoveryRequests({
              question,
              plannerQueries: plan.searchQueries,
              missingRequiredSlots: selected.missingRequiredSlots,
              requestedCorpus: corpus,
              maxRequests: 4,
            });

            const existingSearchKeys = new Set(
              searches.map(
                (search) =>
                  `${search.corpus ?? "auto"}::${search.query.toLowerCase()}`,
              ),
            );

            for (const recovery of recoveryRequests) {
              const searchKey = `${recovery.corpus ?? "auto"}::${recovery.query.toLowerCase()}`;
              if (existingSearchKeys.has(searchKey)) continue;

              const searchResponse = await searchAuthorities({
                q: recovery.query,
                corpus: recovery.corpus,
                limit: 10,
                offset: 0,
              });

              searches.push({
                query: recovery.query,
                corpus: recovery.corpus,
                provenance: "recovery",
                results: searchResponse.results,
              });
              existingSearchKeys.add(searchKey);

              recoveryAttempts.push({
                slotKey: recovery.slotKey,
                query: recovery.query,
                corpus: recovery.corpus,
                resultCount: searchResponse.results.length,
              });
            }

            if (recoveryAttempts.length > 0) {
              selected = selectFinalAuthorities({
                searches,
                question,
                plannerQueries: plan.searchQueries,
              });
            }
          }

          // v5.18 is authoritative for the final evidence pack. The existing
          // concept/slot selector remains in place for bridge/recovery planning
          // and diagnostics, but it no longer determines the answer authority set.
          send("stage", { key: "selecting", label: "Qualifying procedural evidence" });
          const plannerRelations = relationsFromPlanner({ intent: plan.intent, situation: plan.situation });
          const v517Selection = await selectAuthorities({
            searches,
            question,
            searchProceduralAuthorities: searchAuthorities,
            plannerRelations,
            situation: plan.situation,
          });

          // V40: preserve the established selector for procedure-first queries;
          // for natural incidents, adjudicate actual source-body evidence across
          // different actors/forums/stages. A model citation is never trusted
          // without a retrieved source and a verbatim supporting quotation.
          outcomeState.allObligationsComplete = v517Selection.allObligationsComplete;
          outcomeState.obligationCoverage = v517Selection.obligationDetails.map((detail) => detail.coverage);
          outcomeState.partial.push(...obligationPartialFacets(v517Selection.obligationDetails));
          const adjudicationRoute = adjudicationRouting(
            question, plan.situation?.kind, v517Selection.finalAuthorities.length > 0, plan.situation,
          );
          const v40IncidentGate = adjudicationRoute.adjudicate;
          outcomeState.route = v40IncidentGate ? "incident_adjudication" : "semantic_selector";
          const actLabels = new Set<string>();
          const forumLabels = new Set<string>();
          const remember = (target: Set<string>, labels: string[]) => {
            for (const label of labels) {
              const text = String(label ?? "").trim();
              if (text) target.add(text);
            }
          };
          const noteActQualification = (labels: string[]) => {
            remember(actLabels, labels);
            if (actLabels.size === 0) return;
            if (!outcomeState.uncertainty.some((item) => item.facet === "act_attestation_unconfirmed")) {
              outcomeState.uncertainty.push({ class: "retrieval_uncertainty", facet: "act_attestation_unconfirmed" });
            }
          };
          const noteForumQualification = (labels: string[]) => {
            remember(forumLabels, labels);
            if (forumLabels.size === 0) return;
            if (!outcomeState.uncertainty.some((item) => item.facet === "forum_identity_unconfirmed")) {
              outcomeState.uncertainty.push({ class: "retrieval_uncertainty", facet: "forum_identity_unconfirmed" });
            }
          };
          const hiddenLabel = (label: string) => {
            const text = String(label ?? "");
            const has = (set: Set<string>) => set.has(text) || [...set].some((item) => item.toLowerCase() === text.toLowerCase());
            return has(actLabels) || has(forumLabels);
          };
          // Every admitted source stays in the citation list. A qualified admission is labelled.
          const listedAuthorities = <T extends { citationLabel?: string }>(list: T[]) =>
            list.map((item) => ({
              ...item,
              unconfirmed: hiddenLabel(String(item.citationLabel ?? "")),
            }));
          const groundedFallback = (input: Parameters<typeof buildFallbackAnswer>[0]) => {
            const authorities = input.authorities ?? [];
            const unconfirmed = authorities.filter((item) => hiddenLabel(item.citationLabel));
            const confirmed = authorities.filter((item) => !hiddenLabel(item.citationLabel));
            return buildFallbackAnswer({ ...input, authorities: confirmed, unconfirmedAuthorities: unconfirmed });
          };
          let v40AuthoritySet = [...v517Selection.finalAuthorities];
          let v40Diagnostic: {
            status: string; candidateCount: number; selected: string[];
            rejected: string[]; gaps: string[]; providerAttempts: number;
            dossier: string[]; retrievedOutsideDossier: string[];
            dispositions: V402Disposition[]; unavailableNominations: number;
            recovery: { status: string; candidates: string[]; dispositions: V402Disposition[]; unavailableNominations: number; selected: string[]; rejected: string[] };
            qualifications: string[];
            rejectedGoverning: Array<{ id: string; inDossier: boolean }>;
          } = {
            status: "not_invoked", candidateCount: 0, selected: [], rejected: [], gaps: [], providerAttempts: 0,
            dossier: [], retrievedOutsideDossier: [], dispositions: [], unavailableNominations: 0,
            qualifications: [],
            rejectedGoverning: [],
            recovery: { status: "not_needed", candidates: [], dispositions: [], unavailableNominations: 0, selected: [], rejected: [] },
          };
          let recoveryRan = false;
          let overlookedRecords: Array<{ sectionId?: string; citationLabel?: string; heading?: string | null; path?: string[] }> = [];
          if (v40IncidentGate) {
            const dossier = buildV40Dossier({
              question, searches, legacySelected: v40AuthoritySet,
            });
            v40Diagnostic.candidateCount = dossier.length;
            const dossierIds = new Set(dossier.map((source) => source.sectionId));
            v40Diagnostic.dossier = dossier.map((source) => `${source.documentCorpus}:${source.citationLabel}`);
            v40Diagnostic.retrievedOutsideDossier = [...new Set(searches.flatMap((search) => search.results)
              .filter((source) => !dossierIds.has(source.sectionId))
              .map((source) => `${source.documentCorpus}:${source.citationLabel}`))].slice(0, 200);
            if (dossier.length > 0) {
              send("stage", {
                key: "selecting", label: "Adjudicating source scope and operative evidence",
              });
              try {
                const v40Provider = await runClaimValidationWithRetry({
                  requestStartedAt: started,
                  invoke: () => callJson<unknown>({
                    task: "scenario.adjudication",
                    systemInstruction: V40_SOURCE_ADJUDICATION_SYSTEM_PROMPT,
                    prompt: buildV40SourceAdjudicationPrompt({
                      question, situation: plan.situation as V40Situation | undefined,
                      candidates: dossier, legacySelected: v40AuthoritySet,
                    }),
                    temperature: 0,
                    validate: (value) => { v40SourceAdjudicationSchema.parse(value); },
                  }),
                  onRetry: () => send("stage", {
                    key: "selecting", label: "Retrying source adjudication after a transient provider error",
                  }),
                });
                const v40Parsed = v40SourceAdjudicationSchema.parse(v40Provider.value);
                const v40Review = validateV40Proposal({
                  question, candidates: dossier, proposal: v40Parsed,
                  setting: plan.situation?.setting, action: plan.situation?.action,
                });
                v40AuthoritySet = v40Review.authorities;
                noteActQualification(v40Review.dispositions
                  .filter((row) => row.reason === "act_attestation_unconfirmed")
                  .map((row) => row.citationLabel));
                v40Diagnostic = {
                  ...v40Diagnostic,
                  status: v40Review.reason,
                  candidateCount: dossier.length,
                  selected: v40Review.accepted,
                  rejected: v40Review.rejected,
                  gaps: v40Review.gaps,
                  providerAttempts: v40Provider.attempts,
                  dispositions: v40Review.dispositions,
                  unavailableNominations: v40Review.unavailableNominations,
                  qualifications: v40Review.qualifications,
                  rejectedGoverning: v40Review.rejectedGoverning,
                };
                if (v40Review.reason === "v40_no_governing_witness") {
                  const candidates = v402RecoveryCandidates({ question, candidates: dossier, review: v40Review });
                  v40Diagnostic.recovery.candidates = candidates.map((source) => `${source.documentCorpus}:${source.citationLabel}`);
                  v40Diagnostic.recovery.status = candidates.length === 0 ? "no_eligible_sources" : "time_budget_exhausted";
                  // The deadline status is set before recovery runs. Only entering this block counts as recovery.
                  if (candidates.length > 0 && Date.now() - started < 20_000) {
                    recoveryRan = true;
                    send("stage", { key: "selecting", label: "Reviewing eligible governing evidence again" });
                    v40Diagnostic.recovery.status = "provider_unavailable";
                    try {
                      const rawRecovery = await callJson<unknown>({
                        task: "source.recovery", systemInstruction: V402_SOURCE_RECOVERY_SYSTEM_PROMPT,
                        prompt: buildV40SourceAdjudicationPrompt({ question,
                          situation: plan.situation as V40Situation | undefined,
                          candidates, legacySelected: [] }), temperature: 0,
                        validate: (value) => { v40SourceAdjudicationSchema.parse(value); },
                      });
                      v40Diagnostic.recovery.status = "invalid_structured_result";
                      const proposal = v40SourceAdjudicationSchema.parse(rawRecovery);
                      // Only quotations from the presented text can establish a
                      // recovery witness. Restore full original bodies after checking.
                      const review = validateV40Proposal({ question,
                        candidates: candidates.map((source) => ({ ...source, sectionContent: source.sectionContent.slice(0, 1350) })),
                        proposal, setting: plan.situation?.setting, action: plan.situation?.action });
                      v40Diagnostic.recovery.dispositions = review.dispositions;
                      v40Diagnostic.recovery.unavailableNominations = review.unavailableNominations;
                      v40Diagnostic.recovery.selected = review.accepted;
                      v40Diagnostic.recovery.rejected = review.rejected;
                      v40Diagnostic.recovery.status = review.reason;
                      noteActQualification(review.dispositions
                        .filter((row) => row.reason === "act_attestation_unconfirmed")
                        .map((row) => row.citationLabel));
                      v40Diagnostic.qualifications = [...new Set([...v40Diagnostic.qualifications, ...review.qualifications])];
                      v40Diagnostic.rejectedGoverning = [...v40Diagnostic.rejectedGoverning, ...review.rejectedGoverning]
                        .filter((row, index, all) => all.findIndex((item) => item.id === row.id) === index);
                      if (review.authorities.length > 0) {
                        const fullById = new Map(candidates.map((source) => [source.sectionId, source]));
                        const restored = review.authorities.flatMap((source) => {
                          const full = fullById.get(source.sectionId);
                          return full ? [full] : [];
                        });
                        if (restored.length === review.authorities.length) {
                          v40AuthoritySet = restored;
                          outcomeState.adjudicationRecovery = true;
                          v40Diagnostic.status = "v402_independent_governing_recovery";
                          v40Diagnostic.selected = review.accepted;
                          v40Diagnostic.gaps = review.gaps;
                          v40Diagnostic.recovery.status = "accepted_source_witness";
                        }
                      }
                    } catch { /* Preserve the empty pack. No raw provider error is exposed. */ }
                  }
                }
              } catch (adjudicationError) {
                // Provider failure cannot be mistaken for a source judgment.
                // A source-scope-compatible baseline is preferable to an
                // unscreened new source; otherwise decline to answer.
                v40AuthoritySet = v40AuthoritySet.filter((authority) =>
                  !v40SourceScopeMismatch(question, authority),
                );
                const failure = failureDiagnostic(adjudicationError, "claim_validation", 1, Date.now() - started);
                v40Diagnostic.status = `adjudication_unavailable:${failure.kind}`;
                v40Diagnostic.selected = v40AuthoritySet.map((authority) => authority.citationLabel);
                noteEvidenceGap("adjudication unavailable");
              }
            } else {
              v40AuthoritySet = [];
              v40Diagnostic.status = "no_retrieved_source_bodies";
              noteEvidenceGap("no retrieved source body");
            }
          }
          {
            const knownStatus = new Set(["not_nominated", "rejected", "admitted", "withheld_no_primary", "not_reviewed_limit"]);
            const rows = v40Diagnostic.dispositions ?? [];
            adjudicationTrace = {
              nominationCount: rows.filter((row) => row.status !== "not_nominated").length,
              unavailableNominations: Number(v40Diagnostic.unavailableNominations) || 0,
              dossierOutcomes: rows.map((row) => {
                const status = knownStatus.has(row.status) ? row.status : "other";
                const reason = /^[a-z0-9_:,-]{1,80}$/i.test(String(row.reason ?? "")) ? String(row.reason) : "other_reason";
                return `${status}:${reason}`;
              }),
            };
          }
          selected = {
            ...selected,
            finalAuthorities: v40AuthoritySet,
          };

          const legacyEvidenceGaps = describeMissingAuthoritySlots({
            question,
            plannerQueries: [],
            missingRequiredSlots: selected.missingRequiredSlots,
          });
          // The legacy slot blueprint controls recovery and diagnostics, not the
          // authoritative semantic evidence pack. A missing legacy slot must
          // not add a contradictory user-facing gap to a grounded answer.
          const evidenceGaps = v40AuthoritySet.length > 0
            ? []
            : legacyEvidenceGaps;

          const rejectionKeys = collectRejectionKeys({
            dispositions: v40Diagnostic.dispositions,
            recoveryDispositions: v40Diagnostic.recovery?.dispositions,
            selectorRejections: v517Selection.rejectedAuthorities,
          });
          const askedAct = [plan.situation?.action, plan.situation?.verb, plan.situation?.object]
            .some((value) => String(value ?? "").trim().length > 0);
          if (!recoverySuppressed(v40Diagnostic) && askedAct) {
            const retrieved = searches.flatMap((search) => search.results);
            const chain = followOperatorChain({
              admitted: selected.finalAuthorities,
              pool: retrieved,
            });
            if (chain.truncated) {
              outcomeState.uncertainty.push({ class: "retrieval_uncertainty", facet: "cross-reference chain truncated" });
              if (!outcomeState.partial.includes("partial")) outcomeState.partial.push("partial");
            }
            const recoveryPool = selected.finalAuthorities.length === 0 ? retrieved : chain.candidates;
            overlookedRecords = recoveryPool;
            const eligible = selectOverlookedCandidates({
              pool: recoveryPool,
              admittedIds: selected.finalAuthorities.map((item) => item.sectionId),
              rejectedKeys: rejectionKeys,
              action: plan.situation?.action,
              verb: plan.situation?.verb,
              objectText: plan.situation?.object,
            });
            const overlooked = eligible.slice(0, 4);
            if (eligible.length > overlooked.length && !outcomeState.uncertainty.some((item) => item.facet === "cross-reference chain truncated")) {
              outcomeState.uncertainty.push({ class: "retrieval_uncertainty", facet: "cross-reference chain truncated" });
              if (!outcomeState.partial.includes("partial")) outcomeState.partial.push("partial");
            }
            const judged = await admitJudgedOverlooked({
              question,
              setting: plan.situation?.setting,
              action: plan.situation?.action,
              candidates: overlooked,
              judge: async () => {
                if (activeSignal?.aborted) throw new DOMException("The answer deadline elapsed.", "AbortError");
                const raw = await callJson<unknown>({
                  task: "scenario.adjudication",
                  systemInstruction: V40_SOURCE_ADJUDICATION_SYSTEM_PROMPT,
                  prompt: buildV40SourceAdjudicationPrompt({
                    question,
                    situation: plan.situation as V40Situation | undefined,
                    candidates: overlooked,
                    legacySelected: [],
                  }),
                  temperature: 0,
                  validate: (value) => { v40SourceAdjudicationSchema.parse(value); },
                });
                return v40SourceAdjudicationSchema.parse(raw);
              },
            });
            if (judged.unavailable) {
              outcomeState.uncertainty.push({ class: "retrieval_uncertainty", facet: "overlooked_adjudication_unavailable" });
              if (!outcomeState.partial.includes("evidence_gap")) outcomeState.partial.push("evidence_gap");
            } else if (judged.authorities.length > 0) {
              selected = { ...selected, finalAuthorities: [...selected.finalAuthorities, ...judged.authorities] };
              outcomeState.evidenceRecovery = true;
              outcomeState.recoveredAuthorities = judged.authorities.map((item) => item.citationLabel);
              if (judged.qualifications.includes("act_attestation_unconfirmed")) {
                noteActQualification(judged.authorities.map((item) => item.citationLabel));
              }
            }
          }
          const forumSetting = plan.situation?.setting ?? "";
          const forumKept = [];
          let selectorForumWithheld = 0;
          for (const authority of selected.finalAuthorities) {
            const outcome = forumIdentityOutcome(forumSetting, authority.path ?? []);
            if (outcome === "reject") {
              if (!v40IncidentGate) selectorForumWithheld += 1;
              continue;
            }
            if (outcome === "uncertain") noteForumQualification([authority.citationLabel]);
            forumKept.push(authority);
          }
          selected = { ...selected, finalAuthorities: forumKept };
          const finalAuthorities = forumKept;
          const forumCodes = [
            ...forumCountCodes("selector_forum", tallyForumOutcomes(searches.flatMap((search) => search.results), forumSetting)),
            ...forumCountCodes("overlooked_forum", tallyForumOutcomes(overlookedRecords, forumSetting)),
            ...clientCheckNote([`selector_forum_withheld=forum-identity:${boundedCount(selectorForumWithheld, FORUM_COUNT_WIDTH)}`])?.split(";") ?? [],
          ];
          const authorityPayload: AuthorityPayload[] =
            buildAuthorityPayload(finalAuthorities);

          const finalAuthorityCorpora = [
            ...new Set(finalAuthorities.map((authority) => authority.documentCorpus)),
          ];
          const finalAuthorityCorpus =
            finalAuthorityCorpora.length === 1
              ? finalAuthorityCorpora[0]
              : null;

          const shownAuthorities = listedAuthorities(authorityPayload);
          const shownLabels = new Set(shownAuthorities.map((authority) => authority.citationLabel.toLowerCase()));
          const shownResults = finalAuthorities.filter((authority) => shownLabels.has(authority.citationLabel.toLowerCase()));
          citationList = (answerText: string) => {
            const cited = listedAuthorities(authoritiesReferencedByAnswer(answerText, authorityPayload));
            const fallback = String(outcomeState.fallbackCode ?? "none").trim();
            const declined = outcomeState.abstained === true || fallback !== "none";
            return declined ? cited.filter((item) => !item.unconfirmed) : cited;
          };
          const verifiedMentionCheck = (answerText: string) => validateAnswerAuthorityMentions({
            answerText,
            authorities: finalAuthorities.map((authority) => ({
              citationLabel: authority.citationLabel,
              sectionContent: authority.sectionContent,
            })),
            acceptVerifiedCrossReferences: true,
          });

          const diagnosticConcepts = [
            ...new Set([
              ...inferredConcepts.map((concept) => concept.id),
              ...selected.discoveredDimensions
                .filter((dimension) => dimension.status === "promoted")
                .map((dimension) => dimension.conceptId),
            ]),
          ];

          send("diagnostics", {
            effectiveCorpus,
            // These are the semantic selector's own measured coverage results,
            // not legacy blueprint coverage or inferred confidence scores.
            selectorSummary: {
              candidateCount: v517Selection.candidateCount,
              minObligationCoverage: v517Selection.minObligationCoverage,
              allObligationsComplete: v517Selection.allObligationsComplete,
              obligationDetails: v517Selection.obligationDetails,
              prePruneCount: v517Selection.prePruneLabels.length,
              selectedLabels: shownResults.map((authority) => authority.citationLabel),
              legacySelectedCount: v517Selection.selectedLabels.length,
              // These coverage scores belong to the lexical v5.18 selector,
              // not the incident adjudicator. Do not misstate them as v40 scores.
              evidenceAdmission: v40IncidentGate
                ? v40Diagnostic.status : v517Selection.evidenceAdmission,
              legacyEvidenceAdmission: v517Selection.evidenceAdmission,
              // Counts and reason codes only. Labels stay off the streamed object.
              scenarioAdjudication: publicScenarioAdjudication(v40Diagnostic),
              forumCodes,
            },
            planner: {
              hasMaterialFacts: (plan.situation?.materialFacts ?? []).some((item) => String(item ?? "").trim().length > 0),
              hasAffectedPerson: String(plan.situation?.affectedPerson ?? "").trim().length > 0,
            },
            routingReason: adjudicationRoute.reason,
            inferredConcepts: diagnosticConcepts,
            activeConcepts: selected.activeConceptIds,
            blueprintSlots: selected.blueprintSlots,
            requiredSlots: selected.requiredSlots,
            optionalSlots: selected.optionalSlots,
            satisfiedSlots: selected.satisfiedSlots,
            missingRequiredSlots: selected.missingRequiredSlots,
            blueprintSatisfied: selected.blueprintSatisfied,
            expandedQueries: [],
            expandedQueryCount: expandedQueries.length,
            recoveryAttempts,
            evidenceGaps,
            retrievals: publicRetrievals(searches.map((search) => {
              const discovery = selected.discoveredDimensions.find(
                (dimension) =>
                  dimension.query.toLowerCase() === search.query.toLowerCase() &&
                  dimension.provenance ===
                    (search.provenance ?? "registry_expansion"),
              );

              return {
                query: search.query,
                corpus: search.corpus,
                provenance: search.provenance ?? "registry_expansion",
                discovery,
                resultCount: search.results.length,
                topResults: search.results.slice(0, 6).map((result) => ({
                sectionId: result.sectionId,
                sectionKey: result.sectionKey,
                citationLabel: result.citationLabel,
                heading: result.heading,
                documentTitle: result.documentTitle,
                documentCorpus: result.documentCorpus,
                rank: result.rank,
                sectionRank: result.sectionRank,
                pathRank: result.pathRank,
                bodyRank: result.bodyRank,
                chunkRank: result.chunkRank,
                clusterSupportCount: result.clusterSupportCount,
                  matchSignals: result.matchSignals,
                })),
              };
            })),
            // The final selection diagnostic must describe the semantic pack
            // actually supplied to drafting, not the earlier legacy ranking.
            finalAuthoritySelection: shownResults.map((result) => ({
              query: v40IncidentGate
                ? "scenario_source_adjudication" : "semantic_authority_pack",
              citationLabel: result.citationLabel,
              heading: result.heading,
              documentCorpus: result.documentCorpus,
              baseRank: result.rank,
              routeBoost: 0,
              slotBoost: 0,
              preferredTextBoost: 0,
              bridgeBoost: 0,
              discoveryBoost: 0,
              adjustedRank: result.rank,
              matchedSlots: [],
              authorityFunction: buildAuthorityProfile(result).authorityFunction,
              path: result.path,
            })),
            selectedSlotMatches: selected.selectedSlotMatches,
          });

            if (finalAuthorities.length === 0) {
            outcomeState.fallbackCode = "no_authority_selected";
            outcomeState.abstained = true;
            const noAuthorityReason = searches.some((search) => search.results.length > 0)
              ? "Retrieved evidence did not satisfy the semantic authority-selection requirements."
              : "No relevant authorities were retrieved.";
            const withheldStage = withholdingStage({
              adjudicated: v40IncidentGate,
              recoveryRan,
              recoveryStatus: v40Diagnostic.recovery.status,
            });
            const fallbackAnswer = groundedFallback({
              question,
              planIntent: plan.intent,
              authorities: finalAuthorities,
              effectiveCorpus,
              fallbackReason: noAuthorityReason,
              failureClass: "selection",
              withheldStage,
              retrievedEvidenceCount: searches.reduce((count, search) => count + search.results.length, 0),
            });

            send("stage", {
              key: "answering",
              label: "No authorities selected; returning grounded fallback",
            });

            send("answer_delta", { text: fallbackAnswer });

            send(markOperationalTerminal("done"), {
              ok: true,
              degraded: true,
              question,
              corpus: effectiveCorpus,
              latencyMs: Date.now() - started,
              answerText: fallbackAnswer,
              authorities: listedAuthorities(authorityPayload),
              fallbackReason: noAuthorityReason,
            });

            return;
          }

          send("stage", {
            key: "answering",
            label: "Drafting answer",
          });

          let activeAiOperation: AiOperationPhase = "drafting";
          const aiOperationStartedAt = Date.now();
          let claimValidationAttempts = 0;
          try {
            const draftedAnswer = await callText({
              task: "answer.generate",
              systemInstruction: ANSWER_STREAM_SYSTEM_PROMPT,
              prompt: buildGroundedAnswerPrompt({
                question,
                // This field is labelled "Requested corpus filter" in the prompt.
                // Do not misreport the final authority corpus as a user constraint.
                corpus,
                intent: plan.intent,
                evidenceGaps: [...evidenceGaps.map((gap) => gap.description),
                  ...(v40Diagnostic.status === "v402_independent_governing_recovery" ? v40Diagnostic.gaps : [])],
                searches: [
                  {
                    query: "final_authority_pack",
                    corpus: finalAuthorityCorpus,
                    results: finalAuthorities,
                  },
                ],
                concepts: selected.activeConceptIds,
              }),
              temperature: 0.2,
            });

            let finalAnswer = normalizeAnswerFormatting(
              normalizeAnswerCitationLabels({
                answerText: draftedAnswer,
                authorities: authorityPayload,
              }),
            );
            const draftedSettlement = parseSettlement(finalAnswer);
            finalAnswer = draftedSettlement.text;
            outcomeState.settlement = draftedSettlement.settlement;
            for (const item of draftedSettlement.uncertainty) outcomeState.uncertainty.push(item);
            if (draftedSettlement.settlement !== "supported" && !outcomeState.partial.includes("partial")) {
              outcomeState.partial.push("partial");
            }
            let rewriteNote: string | null = null;
            let pruneNote: string | null = null;
            let claimValidationNote: string | null = null;

            if (!finalAnswer.trim()) {
              outcomeState.fallbackCode = "empty_draft";
              outcomeState.abstained = true;
              const fallbackReason = "The AI draft was empty.";

              const fallbackAnswer = groundedFallback({
                question,
                planIntent: plan.intent,
                authorities: finalAuthorities,
                effectiveCorpus,
                fallbackReason,
              });

              send("stage", {
                key: "validating",
                label: "Empty draft; returning grounded fallback",
              });

              send("answer_delta", { text: fallbackAnswer });

              send(markOperationalTerminal("done"), {
                ok: true,
                degraded: true,
                question,
                corpus: effectiveCorpus,
                latencyMs: Date.now() - started,
                answerText: fallbackAnswer,
                authorities: listedAuthorities(authorityPayload),
                fallbackReason,
              });

              return;
            }

            send("stage", {
              key: "validating",
              label: "Checking claims against cited sources",
            });
            activeAiOperation = "post_validation";

            const initialPrune = pruneValidatedAnswerContent({
              answerText: finalAnswer,
              authorities: authorityPayload,
            });

            finalAnswer = removeEmptyAnswerSections(normalizeAnswerFormatting(initialPrune.prunedText));
            noteClaimRemovals(initialPrune.removalCodes);
            if (initialPrune.removedLines.length > 0) {
              pruneNote = clientCheckNote([`pruned_lines=${boundedCount(initialPrune.removedLines.length, COUNT_DIGITS)}`]);
              outcomeState.pruned = true;
              noteCheckedWithholding();
            }

            if (!finalAnswer.trim()) {
              outcomeState.fallbackCode = "prune_emptied_draft";
              outcomeState.abstained = true;
              const fallbackReason =
                "The AI draft could not be checked against its sources after pruning unsupported content.";

              const fallbackAnswer = groundedFallback({
                question,
                planIntent: plan.intent,
                authorities: finalAuthorities,
                effectiveCorpus,
                fallbackReason,
              });

              send("stage", {
                key: "validating",
                label: "Draft empty after pruning; returning grounded fallback",
              });

              send("answer_delta", { text: fallbackAnswer });

              send(markOperationalTerminal("done"), {
                ok: true,
                degraded: true,
                question,
                corpus: effectiveCorpus,
                latencyMs: Date.now() - started,
                answerText: fallbackAnswer,
                authorities: listedAuthorities(authorityPayload),
                fallbackReason,
              });

              return;
            }

            const citationValidation = validateAnswerCitations({
              answerText: finalAnswer,
              authorities: authorityPayload,
            });

            if (!citationValidation.ok) {
              outcomeState.fallbackCode = "invalid_citations";
              outcomeState.abstained = true;
              // Count only: the unretrieved labels stay off the client payload.
              const fallbackReason = "The AI draft cited authorities that were not retrieved.";
              claimValidationNote = clientCheckNote([
                `invalid_citations=${boundedCount(citationValidation.invalidCitations.length, COUNT_DIGITS)}`,
              ]);

              const fallbackAnswer = groundedFallback({
                question,
                planIntent: plan.intent,
                authorities: finalAuthorities,
                effectiveCorpus,
                fallbackReason,
              });

              send("stage", {
                key: "validating",
                label: "Draft rejected; returning grounded fallback",
              });

              send("answer_delta", { text: fallbackAnswer });

              send(markOperationalTerminal("done"), {
                ok: true,
                degraded: true,
                question,
                corpus: effectiveCorpus,
                latencyMs: Date.now() - started,
                answerText: fallbackAnswer,
                authorities: listedAuthorities(authorityPayload),
                fallbackReason,
                claimValidationNote,
                invalidCitations: [],
              });

              return;
            }

            const authorityMentionValidation = validateAnswerAuthorityMentions({
              answerText: finalAnswer,
              authorities: authorityPayload,
            });

            if (!authorityMentionValidation.ok) {
              const rewrite = rewriteForbiddenAuthorityMentions({
                answerText: finalAnswer,
                authorities: finalAuthorities.map((authority) => ({
                  citationLabel: authority.citationLabel,
                  sectionContent: authority.sectionContent,
                })),
              });

              finalAnswer = normalizeAnswerFormatting(rewrite.rewrittenText);
              mentionRewrites += rewrite.removedMentions.length;
              const mentionEdit = mentionRewriteEdit(mentionRewrites);
              if (mentionEdit) answerEdits = [mentionEdit];

              const secondPrune = pruneValidatedAnswerContent({
                answerText: finalAnswer,
                authorities: authorityPayload,
              });

              finalAnswer = removeEmptyAnswerSections(normalizeAnswerFormatting(secondPrune.prunedText));
              noteClaimRemovals(secondPrune.removalCodes);

              rewriteNote = clientCheckNote([
                `rewritten_mentions=${boundedCount(rewrite.removedMentions.length, COUNT_DIGITS)}`,
                secondPrune.removedLines.length > 0
                  ? `pruned_lines=${boundedCount(secondPrune.removedLines.length, COUNT_DIGITS)}`
                  : null,
              ]);
              if (rewrite.removedMentions.length > 0) outcomeState.rewritten = true;
              if (secondPrune.removedLines.length > 0) outcomeState.pruned = true;
              if (rewrite.removedMentions.length > 0 || secondPrune.removedLines.length > 0) noteCheckedWithholding();

              const recheckMentions = verifiedMentionCheck(finalAnswer);

              const recheckCitations = validateAnswerCitations({
                answerText: finalAnswer,
                authorities: authorityPayload,
              });

              if (!recheckMentions.ok || !recheckCitations.ok || !finalAnswer) {
                outcomeState.fallbackCode = "ungrounded_mentions";
                outcomeState.abstained = true;
                const fallbackReason = "The AI draft mentioned or cited authorities that could not be grounded.";
                claimValidationNote = clientCheckNote([
                  recheckMentions.ok ? null : `ungrounded_mentions=${boundedCount(recheckMentions.invalidAuthorityMentions.length, COUNT_DIGITS)}`,
                  recheckCitations.ok ? null : `invalid_citations=${boundedCount(recheckCitations.invalidCitations.length, COUNT_DIGITS)}`,
                ]);

                const fallbackAnswer = groundedFallback({
                  question,
                  planIntent: plan.intent,
                  authorities: finalAuthorities,
                  effectiveCorpus,
                  fallbackReason,
                });

                send("stage", {
                  key: "validating",
                  label: "Draft rejected; returning grounded fallback",
                });

                send("answer_delta", { text: fallbackAnswer });

                send(markOperationalTerminal("done"), {
                  ok: true,
                  degraded: true,
                  question,
                  corpus: effectiveCorpus,
                  latencyMs: Date.now() - started,
                  answerText: fallbackAnswer,
                  authorities: listedAuthorities(authorityPayload),
                  fallbackReason,
                  claimValidationNote,
                });

                return;
              }
            }

            let answerClaims = extractAnswerClaims(finalAnswer);

            if (answerClaims.length === 0) {
              outcomeState.fallbackCode = "no_grounded_claims";
              outcomeState.abstained = true;
              const fallbackReason =
                "The AI draft contained no substantive grounded claims after deterministic validation.";

              const fallbackAnswer = groundedFallback({
                question,
                planIntent: plan.intent,
                authorities: finalAuthorities,
                effectiveCorpus,
                fallbackReason,
              });

              send("stage", {
                key: "validating",
                label: "No grounded claims remained; returning fallback",
              });

              send("answer_delta", { text: fallbackAnswer });

              send(markOperationalTerminal("done"), {
                ok: true,
                degraded: true,
                question,
                corpus: effectiveCorpus,
                latencyMs: Date.now() - started,
                answerText: fallbackAnswer,
                authorities: listedAuthorities(authorityPayload),
                fallbackReason,
              });

              return;
            }

            // v38.1: retry ONLY a structured, transient provider error from
            // claim validation. A successful draft must never be regenerated.
            activeAiOperation = "claim_validation";
            const validationResult = await runClaimValidationWithRetry({
              requestStartedAt: started,
              invoke: () => callJson<unknown>({
                task: "answer.validate",
                systemInstruction: ANSWER_CLAIM_VALIDATOR_SYSTEM_PROMPT,
                prompt: buildAnswerClaimValidationPrompt({
                  claims: answerClaims,
                  authorities: finalAuthorities,
                  question,
                  answerText: finalAnswer,
                }),
                temperature: 0,
                validate: (value) => { claimValidationSchema.parse(value); },
              }),
              onRetry: () => {
                send("stage", {
                  key: "validating",
                  label: "Retrying the claim check after a transient AI-service error",
                });
              },
            });
            claimValidationAttempts = validationResult.attempts;
            let claimValidation =
              claimValidationSchema.parse(validationResult.value);
            activeAiOperation = "post_validation";
            if (claimValidationAttempts > 1) {
              claimValidationNote = clientCheckNote([
                claimValidationNote,
                `claim_check_attempts=${boundedCount(claimValidationAttempts, COUNT_DIGITS)}`,
              ]);
            }
            // V40.1: one bounded repair of an incident answer that omitted the
            // question's decision or its required Bottom line. Never accept a
            // replacement until ALL its claims and responsiveness are validated
            // independently against the same selected authority pack.
            const v401NeedsRepair = v40IncidentGate && (
              !answerSectionHasContent(finalAnswer, "Bottom line:") ||
              claimValidation.responsiveness?.answersUserQuestion !== true ||
              (claimValidation.responsiveness?.unaddressedParts.length ?? 0) > 0
            );
            let v401RepairDiagnostic = "not_needed";
            let repairPhase = "generation";
            if (v401NeedsRepair) {
              outcomeState.repairAttempted = true;
              v401RepairDiagnostic = "not_admitted";
              send("stage", {key:"validating", label:"Repairing the missing incident decision"});
              try {
                const proposedRepair = await callText({
                  task: "answer.repair",
                  systemInstruction: ANSWER_V401_INCIDENT_REPAIR_SYSTEM_PROMPT,
                  prompt: buildV401IncidentRepairPrompt({
                    question, currentAnswer: finalAnswer,
                    missingParts: [
                      ...(!answerSectionHasContent(finalAnswer, "Bottom line:")
                        ? ["A substantive Bottom line directly answering the question"] : []),
                      ...(claimValidation.responsiveness?.unaddressedParts ?? []),
                      ...(claimValidation.responsiveness?.reason
                        ? [claimValidation.responsiveness.reason] : []),
                    ],
                    authorities: finalAuthorities,
                  }),
                  temperature: 0.1,
                });
                repairPhase = "deterministic_checks";
                let repairedAnswer = normalizeAnswerFormatting(
                  normalizeAnswerCitationLabels({
                    answerText: proposedRepair, authorities: authorityPayload,
                  }),
                );
                const repairedPrune = pruneValidatedAnswerContent({
                  answerText: repairedAnswer, authorities: authorityPayload,
                });
                repairedAnswer = removeEmptyAnswerSections(
                  normalizeAnswerFormatting(repairedPrune.prunedText),
                );
                noteClaimRemovals(repairedPrune.removalCodes);
                const repairedClaims = extractAnswerClaims(repairedAnswer);
                const repairedCitations = validateAnswerCitations({
                  answerText: repairedAnswer, authorities: authorityPayload,
                });
                const repairedMentions = verifiedMentionCheck(repairedAnswer);
                const qualificationVetoes = findOmittedSourceQualifications({
                  claims: repairedClaims, authorities: finalAuthorities,
                });
                const preliminaryRefusals = [
                  !repairedAnswer.trim() && "empty_repair",
                  !repairedClaims.length && "no_claims",
                  !repairedCitations.ok && "invalid_citations",
                  !repairedMentions.ok && "invalid_authority_mentions",
                  qualificationVetoes.length > 0 && "qualification_veto",
                  !answerSectionHasContent(repairedAnswer, "Bottom line:") && "missing_bottom_line",
                ].filter(Boolean);
                v401RepairDiagnostic = preliminaryRefusals.length ? `refused:${preliminaryRefusals.join(",")}` : "independent_review_pending";
                if (repairedClaims.length > 0 && repairedCitations.ok &&
                    repairedMentions.ok && qualificationVetoes.length === 0 &&
                    answerSectionHasContent(repairedAnswer, "Bottom line:")) {
                  repairPhase = "independent_validation";
                  const repairedReview = await runClaimValidationWithRetry({
                    requestStartedAt: started,
                    invoke: () => callJson<unknown>({
                      task: "answer.validate",
                      systemInstruction: ANSWER_CLAIM_VALIDATOR_SYSTEM_PROMPT,
                      prompt: buildAnswerClaimValidationPrompt({
                        claims: repairedClaims, authorities: finalAuthorities,
                        question, answerText: repairedAnswer,
                      }),
                      temperature: 0,
                      validate: (value) => { claimValidationSchema.parse(value); },
                    }),
                    onRetry: () => send("stage", {
                      key:"validating", label:"Retrying the incident-repair check",
                    }),
                  });
                  claimValidationAttempts += repairedReview.attempts;
                  repairPhase = "independent_verdict_schema";
                  const reviewedRepair = claimValidationSchema.parse(repairedReview.value);
                  const repairAdmission = {
                    claimIds: repairedClaims.map((claim) => claim.id),
                    validatedClaims: reviewedRepair.claims,
                    responsive: reviewedRepair.responsiveness?.answersUserQuestion === true,
                    unaddressedParts: reviewedRepair.responsiveness?.unaddressedParts ?? ["missing verdict"],
                    hasBottomLine: answerSectionHasContent(repairedAnswer, "Bottom line:"),
                    citationValid: repairedCitations.ok,
                    mentionValid: repairedMentions.ok,
                    sourceQualificationVetoes: qualificationVetoes.length,
                  };
                  const refusals = v402RepairRefusals(repairAdmission);
                  v401RepairDiagnostic = refusals.length ? `refused:${refusals.join(",")}` : "independent_gate_refused";
                  if (v401AcceptIndependentRepair(repairAdmission)) {
                    firstDraftRecord = freezeFirstDraft({
                      answerText: finalAnswer,
                      claimVerdicts: claimValidation.claims,
                      citations: citationLabelsIn(finalAnswer),
                    });
                    outcomeState.repairAccepted = true;
                    outcomeState.settlement = null;
                    if (repairModel) answerModel = repairModel;
                    noteCheckedWithholding();
                    finalAnswer = repairedAnswer;
                    answerClaims = repairedClaims;
                    claimValidation = reviewedRepair;
                    v401RepairDiagnostic = "accepted_after_recheck";
                    claimValidationNote = clientCheckNote([
                      claimValidationNote,
                      "repair=accepted",
                      `repair_attempts=${boundedCount(claimValidationAttempts, COUNT_DIGITS)}`,
                    ]);
                  }
                }
              } catch (repairError) {
                // A failed rewrite or provider call must NEVER bypass an
                // initial grounding, citation, or responsiveness rejection.
                const failure = failureDiagnostic(repairError, "post_validation", 1, Date.now() - started);
                v401RepairDiagnostic = `unavailable:${repairPhase}:${failure.kind}`;
              }
              incidentRepair = v401RepairDiagnostic;
              send("stage", {key:"validating", label:
                v401RepairDiagnostic === "accepted_after_recheck"
                  ? "Incident answer repaired and checked again against sources"
                  : "Incident repair not admitted; preserving safety verdict"});
            }
            const validationById = new Map(
              claimValidation.claims.map((claim) => [claim.id, claim]),
            );
            if (v40IncidentGate && (
                claimValidation.responsiveness?.answersUserQuestion !== true ||
                !answerSectionHasContent(finalAnswer, "Bottom line:") ||
                (claimValidation.responsiveness?.unaddressedParts.length ?? 0) > 0)) {
              outcomeState.fallbackCode = "not_responsive";
              outcomeState.abstained = true;
              const fallbackReason =
                "The cited draft did not demonstrably answer the question asked.";
              const fallbackAnswer = groundedFallback({
                question, planIntent: plan.intent, authorities: finalAuthorities,
                effectiveCorpus, fallbackReason,
              });
              send("stage", {
                key: "validating", label: "Answer failed incident-responsiveness gate",
              });
              send("answer_delta", {text: fallbackAnswer});
              send(markOperationalTerminal("done"), {
                ok: true, degraded: true, question, corpus: effectiveCorpus,
                latencyMs: Date.now() - started, answerText: fallbackAnswer,
                authorities: listedAuthorities(authorityPayload), fallbackReason,
                claimValidationNote: clientCheckNote([
                  "responsiveness=withheld",
                  `incident_repair=${v401RepairDiagnostic}`,
                ]),
              });
              return;
            }

            // v34: independently check source-stated exceptions in the same
            // operative subsection. A model validator cannot silently approve
            // a categorical restriction that removes an express exception.
            const qualificationRejections = findOmittedSourceQualifications({
              claims: answerClaims,
              authorities: finalAuthorities,
            });
            const qualificationById = new Map(
              qualificationRejections.map((rejection) => [rejection.claimId, rejection]),
            );
            // v36: one bounded, independent source-quotation review ONLY when
            // model rejections would erase the entire Bottom line. A v35
            // deterministic qualification veto is never reconsidered.
            const initialUnsupported = new Set(answerClaims
              .filter((claim) => validationById.get(claim.id)?.supported !== true || qualificationById.has(claim.id))
              .map((claim) => claim.id));
            const qualificationVetoIds = new Set(qualificationRejections.map((item) => item.claimId));
            const initialPruned = pruneUnsupportedAnswerClaims({
              answerText: finalAnswer,
              claims: answerClaims,
              unsupportedClaimIds: [...initialUnsupported],
            });
            const acceptedAppeals = new Set<string>();
            let appealDiagnostic: string | null = null;
            if (answerSectionHasContent(finalAnswer, "Bottom line:") &&
                !answerSectionHasContent(initialPruned.prunedText, "Bottom line:")) {
              const disputed = rejectedBottomLineClaims({
                answerText: finalAnswer,
                claims: answerClaims,
                rejectedIds: initialUnsupported,
                qualificationVetoIds,
              }).slice(0, 2);
              if (disputed.length > 0) {
                send("stage", { key: "validating", label: "Checking disputed source support again" });
                try {
                  const rawAppeal = await callJson<unknown>({
                    task: "answer.validate",
                    systemInstruction: ANSWER_CLAIM_APPEAL_SYSTEM_PROMPT,
                    prompt: buildAnswerClaimAppealPrompt({
                      claims: disputed.map((claim) => ({
                        id: claim.id,
                        text: claim.text,
                        citations: claim.citations,
                        originalReason: validationById.get(claim.id)?.reason ?? "Unspecified rejection",
                      })),
                      authorities: finalAuthorities,
                    }),
                    temperature: 0,
                    validate: (value) => { claimAppealSchema.parse(value); },
                  });
                  const reviewed = claimAppealSchema.parse(rawAppeal);
                  for (const claim of disputed) {
                    const verdict = reviewed.claims.find((item) => item.id === claim.id);
                    if (!verdict || qualificationVetoIds.has(claim.id)) continue;
                    const attestation = corroborateClaimAppeal({
                      claim,
                      verdict,
                      authorities: finalAuthorities,
                    });
                    if (attestation.accepted) acceptedAppeals.add(claim.id);
                  }
                  outcomeState.appealAttempted = true;
                  outcomeState.appealAccepted = acceptedAppeals.size > 0;
                  appealDiagnostic = `appeal_attempted=${boundedCount(disputed.length, COUNT_DIGITS)};appeal_corroborated=${boundedCount(acceptedAppeals.size, COUNT_DIGITS)}`;
                } catch {
                  // Reviewer errors, malformed JSON, missing or fake quotations
                  // are not a reason to waive the original rejection.
                  appealDiagnostic = `appeal_unavailable=${boundedCount(1, COUNT_DIGITS)}`;
                }
              }
            }
            const unsupportedClaimIds = answerClaims
              .filter((claim) => qualificationVetoIds.has(claim.id) ||
                (validationById.get(claim.id)?.supported !== true && !acceptedAppeals.has(claim.id)))
              .map((claim) => claim.id);

            // v29: diagnostics only. Preserve the exact pre-prune bottom-line state.
            const ooV29BottomLineBeforeSemanticPrune = answerSectionHasContent(
              finalAnswer,
              "Bottom line:",
            );
            if (unsupportedClaimIds.length > 0) {
              const semanticPrune = pruneUnsupportedAnswerClaims({
                answerText: finalAnswer,
                claims: answerClaims,
                unsupportedClaimIds,
              });

              finalAnswer = removeEmptyAnswerSections(
                normalizeAnswerFormatting(semanticPrune.prunedText),
              );

              const claimIds = semanticPrune.removedClaims
                .map((claim) => claim.id)
                .filter((id) => id.length >= 1 && id.length <= CLAIM_ID_MAX_LENGTH && /^[a-z0-9_.:-]+$/i.test(id));
              claimValidationNote = clientCheckNote([
                `pruned_unsupported_claims=${boundedCount(semanticPrune.removedClaims.length, COUNT_DIGITS)}`,
                claimIds.length > 0 ? `claim_ids=${claimIds.join(",")}` : null,
                appealDiagnostic,
              ]);
              outcomeState.pruned = true;
              noteCheckedWithholding();
              noteClaimRemovals(semanticPrune.removedClaims.map((claim) =>
                qualificationVetoIds.has(claim.id) ? "omitted_source_qualification" : "unsupported_by_passage"));
            } else {
              finalAnswer = removeEmptyAnswerSections(finalAnswer);
              if (appealDiagnostic) claimValidationNote = clientCheckNote([appealDiagnostic]);
            }

            let remainingClaims = extractAnswerClaims(finalAnswer);
            let finalCitationValidation = validateAnswerCitations({
              answerText: finalAnswer,
              authorities: authorityPayload,
            });
            let finalMentionValidation = verifiedMentionCheck(finalAnswer);

            let hasBottomLine = answerSectionHasContent(
              finalAnswer,
              "Bottom line:",
            );
            // v38: one bounded fresh rewrite when a correctly rejected Bottom
            // line leaves other source-supported claims intact. This is NOT an
            // appeal of the old claim and never overrides the qualification veto.
            // The new line must independently pass citation, mention, semantic
            // entailment and deterministic exception checks or we fail closed.
            let reconstructionDiagnostic = "not_needed";
            if (!hasBottomLine && remainingClaims.length > 0 &&
                finalCitationValidation.ok && finalMentionValidation.ok) {
              send("stage", {key:"validating",label:"Reconstructing a grounded Bottom line"});
              reconstructionDiagnostic = "attempted_rejected";
              try {
                const rawRecovery = await callJson<unknown>({
                  task: "answer.repair",
                  systemInstruction: ANSWER_BOTTOM_LINE_RECOVERY_SYSTEM_PROMPT,
                  prompt: buildBottomLineRecoveryPrompt({
                    question,
                    survivingAnswer: finalAnswer,
                    authorities: finalAuthorities,
                    rejectedClaims: answerClaims
                      .filter((claim) => unsupportedClaimIds.includes(claim.id))
                      .slice(0, 2)
                      .map((claim) => ({
                        text: claim.text,
                        reason: qualificationById.get(claim.id)?.reason ??
                          validationById.get(claim.id)?.reason ?? "Unsupported claim",
                      })),
                  }),
                  temperature: 0,
                  validate: (value) => { bottomLineRecoverySchema.parse(value); },
                });
                const recovery = bottomLineRecoverySchema.parse(rawRecovery);
                const line = recovery.bottomLine.trim();
                if (line.length >= 20 && !line.includes("\n") &&
                    /\[[^\]]+\]/.test(line)) {
                  const candidate = normalizeAnswerFormatting(`Bottom line:\n${line}\n\n${finalAnswer}`);
                  const candidateClaims = extractAnswerClaims(`Bottom line:\n${line}`);
                  const citationOK = validateAnswerCitations({
                    answerText: candidate,
                    authorities: authorityPayload,
                  }).ok;
                  const mentionOK = verifiedMentionCheck(candidate).ok;
                  const qualificationOK = findOmittedSourceQualifications({
                    claims: candidateClaims,
                    authorities: finalAuthorities,
                  }).length === 0;
                  if (candidateClaims.length === 1 && citationOK && mentionOK && qualificationOK) {
                    const rawReview = await callJson<unknown>({
                      task: "answer.validate",
                      systemInstruction: ANSWER_CLAIM_VALIDATOR_SYSTEM_PROMPT,
                      prompt: buildAnswerClaimValidationPrompt({
                        claims: candidateClaims,
                        authorities: finalAuthorities,
                      }),
                      temperature: 0,
                      validate: (value) => { claimValidationSchema.parse(value); },
                    });
                    const decisions = claimValidationSchema.parse(rawReview);
                    // Require one complete and unambiguous fresh judgement.
                    // Duplicate/extra claim IDs do not constitute validation.
                    if (decisions.claims.length === 1 &&
                        decisions.claims[0].id === candidateClaims[0].id &&
                        decisions.claims[0].supported === true) {
                      finalAnswer = removeEmptyAnswerSections(candidate);
                      remainingClaims = extractAnswerClaims(finalAnswer);
                      finalCitationValidation = validateAnswerCitations({
                        answerText: finalAnswer,
                        authorities: authorityPayload,
                      });
                      finalMentionValidation = verifiedMentionCheck(finalAnswer);
                      hasBottomLine = answerSectionHasContent(finalAnswer,"Bottom line:");
                      reconstructionDiagnostic = "accepted_after_recheck";
                      outcomeState.repairAccepted = true;
                      if (repairModel) answerModel = repairModel;
                      outcomeState.settlement = null;
                      noteCheckedWithholding();
                    }
                  }
                }
              } catch {
                reconstructionDiagnostic = "unavailable_original_rejection_preserved";
              }
              claimValidationNote = clientCheckNote([
                claimValidationNote,
                `bottom_line_recovery=${reconstructionDiagnostic}`,
              ]);
            }

            if (
              remainingClaims.length === 0 ||
              !hasBottomLine ||
              !finalCitationValidation.ok ||
              !finalMentionValidation.ok
            ) {
              const rejectedIds = unsupportedClaimIds
                .filter((id) => new RegExp(`^[a-z0-9_.:-]{1,${CLAIM_ID_MAX_LENGTH}}$`, "i").test(id))
                .slice(0, 8);
              const ooV29FailureTrace = clientCheckNote([
                "v29_semantic_fallback",
                `bottom_line_before=${ooV29BottomLineBeforeSemanticPrune}`,
                `bottom_line_after=${hasBottomLine}`,
                `draft_claims=${boundedCount(answerClaims.length, COUNT_DIGITS)}`,
                `rejected_claims=${boundedCount(unsupportedClaimIds.length, COUNT_DIGITS)}`,
                `remaining_claims=${boundedCount(remainingClaims.length, COUNT_DIGITS)}`,
                `citations_valid=${finalCitationValidation.ok}`,
                `mentions_valid=${finalMentionValidation.ok}`,
                rejectedIds.length > 0 ? `claim_ids=${rejectedIds.join(",")}` : "claim_ids=none",
                appealDiagnostic ?? "appeal=not_attempted",
              ]);
              outcomeState.fallbackCode = !hasBottomLine ? "bottom_line_lost" : "validation_rejected";
              outcomeState.abstained = true;
              const fallbackReason = !hasBottomLine
                ? "The AI draft lost its grounded Bottom line during semantic entailment validation."
                : "The AI draft could not retain a valid set of grounded claims after semantic entailment validation.";

              const fallbackAnswer = groundedFallback({
                question,
                planIntent: plan.intent,
                authorities: finalAuthorities,
                effectiveCorpus,
                fallbackReason,
              });

              send("stage", {
                key: "validating",
                label: "Claim check rejected the draft; returning fallback",
              });

              send("answer_delta", { text: fallbackAnswer });

              send(markOperationalTerminal("done"), {
                ok: true,
                degraded: true,
                question,
                corpus: effectiveCorpus,
                latencyMs: Date.now() - started,
                answerText: fallbackAnswer,
                authorities: listedAuthorities(authorityPayload),
                fallbackReason,
                // v29: existing debug-snapshot field, only for this failure path.
                claimValidationNote: ooV29FailureTrace,
              });

              return;
            }

            if (evidenceGaps.length > 0) {
              finalAnswer = appendEvidenceGapSection(
                finalAnswer,
                evidenceGaps.map((gap) => gap.description),
              );
            }

            if (claimValidationAttempts > 1 &&
                !(claimValidationNote ?? "").includes("claim_check_attempts=")) {
              claimValidationNote = clientCheckNote([
                claimValidationNote,
                `claim_check_attempts=${boundedCount(claimValidationAttempts, COUNT_DIGITS)}`,
              ]);
            }
            const trailingSettlement = parseSettlement(finalAnswer);
            finalAnswer = trailingSettlement.text;
            const settlementRank = { supported: 1, partial: 2, not_answered: 3 } as const;
            if ((settlementRank[trailingSettlement.settlement ?? "supported"] ?? 0) > (settlementRank[outcomeState.settlement ?? "supported"] ?? 0)
                && trailingSettlement.settlement) {
              outcomeState.settlement = trailingSettlement.settlement;
            }
            for (const item of trailingSettlement.uncertainty) {
              if (!outcomeState.uncertainty.some((row) => row.class === item.class && row.facet === item.facet)) {
                outcomeState.uncertainty.push(item);
              }
            }
            finalAnswer = labelBareRulings(finalAnswer, finalAuthorities);
            const cited = dropUnreferencedCitationEntries(finalAnswer);
            finalAnswer = cited.text;
            finalAnswer = attachClaimQualifications(finalAnswer, {
              actLabels: [...actLabels],
              forumLabels: [...forumLabels],
            });
            const mentionEdit = mentionRewriteEdit(mentionRewrites);
            answerEdits = [...cited.dropped, ...(mentionEdit ? [mentionEdit] : [])];
            if (answerEdits.length > 0) noteCheckedWithholding();
            if (evidenceGaps.length > 0) outcomeState.partial.push("evidence_gap");
            if (claimValidationAttempts > 1) {
              outcomeState.providerRetries = Math.max(outcomeState.providerRetries, claimValidationAttempts - 1);
            }
            send("answer_delta", { text: finalAnswer });

            send(markOperationalTerminal("done"), {
              ok: true,
              degraded: evidenceGaps.length > 0,
              question,
              corpus: effectiveCorpus,
              latencyMs: Date.now() - started,
              answerText: finalAnswer,
              authorities: shownAuthorities,
              rewriteNote,
              pruneNote,
              claimValidationNote,
              recoveryAttempts,
              evidenceGaps,
              missingRequiredSlots: selected.missingRequiredSlots,
            });

            return;
          } catch (operationError) {
            // v38.1: the original try includes drafting AND validation. Never
            // misreport a validator/schema exception as a drafting failure.
            const operationFailure = failureDiagnostic(
              operationError,
              activeAiOperation,
              claimValidationAttempts || 1,
              Date.now() - aiOperationStartedAt,
            );
            const isDraftFailure = activeAiOperation === "drafting";
            outcomeState.fallbackCode = isDraftFailure ? "drafting_unavailable" : "validation_unavailable";
            outcomeState.abstained = true;
            const fallbackReason = publicFailureReason(operationFailure);
            const fallbackAnswer = groundedFallback({
              question,
              planIntent: plan.intent,
              authorities: finalAuthorities,
              effectiveCorpus,
              fallbackReason,
              failureClass: isDraftFailure ? "drafting_unavailable" : "validation_unavailable",
            });

            send("stage", {
              key: isDraftFailure ? "answering" : "validating",
              label: isDraftFailure
                ? "Answer drafting failed; returning source-only fallback"
                : "Answer validation failed; returning source-only fallback",
            });
            send("answer_delta", { text: fallbackAnswer });
            send(markOperationalTerminal("done"), {
              ok: true,
              degraded: true,
              question,
              corpus: effectiveCorpus,
              latencyMs: Date.now() - started,
              answerText: fallbackAnswer,
              authorities: listedAuthorities(authorityPayload),
              fallbackReason,
              claimValidationNote: clientCheckNote([
                `operation=${operationFailure.phase}`,
                `kind=${operationFailure.kind}`,
                `status=${operationFailure.httpStatus ?? "none"}`,
                `code=${operationFailure.code ?? "none"}`,
                `provider=${operationFailure.provider ?? "none"}`,
                `retryable=${operationFailure.retryable}`,
                `attempts=${boundedCount(operationFailure.attempts, COUNT_DIGITS)}`,
              ]),
              operationFailure,
            });

            return;
          }
        } catch (error) {
          // Never expose raw provider payloads or Zod errors to the browser.
          // The request ID in trace still permits internal correlation.
          send(markOperationalTerminal("error"), {
            message: "The parliamentary answer request could not complete. Please try again.",
            retryable:
              typeof error === "object" &&
              error !== null &&
              "retryable" in error &&
              typeof (error as { retryable?: unknown }).retryable === "boolean"
                ? (error as { retryable: boolean }).retryable
                : false,
            kind:
              typeof error === "object" &&
              error !== null &&
              "kind" in error &&
              typeof (error as { kind?: unknown }).kind === "string"
                ? (error as { kind: string }).kind
                : "unknown",
          });
        }
      };

      const stream = openGovernedAnswerStream({
        deadlineMs: ANSWER_STREAM_DEADLINE_MS,
        heartbeatMs: ANSWER_STREAM_HEARTBEAT_MS,
        bindSend(rawSend) {
          send = (event, data) => {
            if (event === "done" || event === "error") markOperationalTerminal(event);
            if (event === "done" && data && typeof data === "object") {
              const record = data as { answerText?: unknown };
              const authorities = citationList(typeof record.answerText === "string" ? record.answerText : "");
              rawSend("authorities", decorate("authorities", { authorities }));
              rawSend(event, decorate(event, { ...data, authorities }));
              return;
            }
            rawSend(event, decorate(event, data));
          };
          return send;
        },
        work: async (_send, signal) => {
          activeSignal = signal;
          await run();
        },
      });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "private, no-store, no-transform",
      "Referrer-Policy": "no-referrer",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
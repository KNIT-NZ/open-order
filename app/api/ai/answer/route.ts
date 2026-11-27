// app/api/ai/answer/route.ts
import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { boundedElapsed, operationalRelease, operationalStage, type OperationalOutcome } from "@/lib/open-order/operational-event";
import { scheduleOperationalEvent } from "@/lib/open-order/operational-writer";
import { z } from "zod";
import { searchPlanSchema } from "@/lib/ai/search-plan-schema";
import { generateJson, streamText } from "@/lib/ai";
import {
  ANSWER_STREAM_DEADLINE_MS,
  ANSWER_STREAM_HEARTBEAT_MS,
  superviseAnswerStream,
} from "@/lib/open-order/answer-stream";
import {
  actorClassDrift,
  actorClassQualificationQuery,
  authorisingRuleQueries,
  citationLabelsIn,
  contentTokens,
  conditionalSubIssueGaps,
  deriveAnswerOutcome,
  describesStandingOrdersAsStatute,
  dropUnreferencedCitationEntries,
  errorCorrectionQueries,
  expressCrossReferences,
  freezeFirstDraft,
  insufficiencyFacets,
  isApplicabilityRejection,
  labelBareRulings,
  mustAdjudicateFromPlanner,
  obligationPartialFacets,
  overHedgesSettledDuty,
  presidingOfficerAppealQuery,
  proceedingConsequenceQueries,
  quoteAttestsActAndObject,
  relationsFromPlanner,
  reasonFromProviderKind,
  routeFromPlanner,
  stageReopeningQueries,
  usableSourceAnchor,
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
  buildV40Dossier, validateV40Proposal,
  v40SourceScopeMismatch,
  v401AcceptIndependentRepair, v402RecoveryCandidates, v402RepairRefusals,
  type V402Disposition, type V40Situation,
} from "@/lib/ai/scenario-adjudication";
import { corroborateClaimAppeal, rejectedBottomLineClaims } from "@/lib/ai/claim-appeal";
import { searchProceduralAuthorities } from "@/lib/procedural-search";
import {
  answerSectionHasContent,
  appendEvidenceGapSection,
  buildAuthorityPayload,
  buildAuthorityProfile,
  buildCorpusBridgeSearchRequests,
  buildFallbackAnswer,
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

// Stay under the platform function budget. The supervisor deadline is shorter
// than this limit so a hung provider still emits a terminal SSE event.
export const maxDuration = 300;

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: NextRequest) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return new Response(sseEvent("error", { message: "Invalid JSON body", reason: "invalid_request", retryable: false, kind: "configuration" }), {
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
        kind: "configuration",
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
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
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
        fallbackReason: "none",
        partial: [] as string[],
        abstained: false,
        allObligationsComplete: true,
        obligationCoverage: [] as number[],
      };
      let firstDraftRecord: ReturnType<typeof freezeFirstDraft> | null = null;
      const noteRetry = () => { outcomeState.providerRetries += 1; };
      const closeStream = () => { try { closeStream(); } catch { /* already closed */ } };
      let outbound = (event: string, data: unknown) => {
        try { controller.enqueue(encoder.encode(sseEvent(event, data))); } catch { /* closed */ }
      };
      const send = (event: string, data: unknown) => {
        if (event === "stage" && data && typeof data === "object") {
          const stage = data as { key?: unknown; label?: unknown };
          if (typeof stage.key === "string" && typeof stage.label === "string" && stageTimeline.length < 32) {
            stageTimeline.push({ key: stage.key, label: stage.label, atMs: Math.max(0, Date.now() - startedAt) });
          }
        }
        if ((event === "done" || event === "error") && data && typeof data === "object") {
          const record = data as Record<string, unknown>;
          const prose = typeof record.fallbackReason === "string"
            && record.fallbackReason !== outcomeState.fallbackReason
            ? record.fallbackReason : null;
          const outcome = deriveAnswerOutcome(outcomeState);
          const reason = event === "error"
            ? (typeof record.reason === "string" ? record.reason : reasonFromProviderKind(typeof record.kind === "string" ? record.kind : undefined))
            : undefined;
          data = {
            ...record,
            ...outcome,
            degraded: outcome.degraded,
            ...(prose ? { fallbackDetail: prose } : {}),
            ...(reason ? { reason } : {}),
            ...(firstDraftRecord ? { firstDraft: firstDraftRecord } : {}),
            trace: {
              schemaVersion: 2,
              requestId,
              buildCommit,
              stageTimeline,
              incidentRepair,
            },
          };
        }
        outbound(event, data);
      };

      const run = async () => {
        const started = startedAt;

        try {
          send("stage", {
            key: "planning",
            label: "Planning retrieval",
          });

          let headingLabels: string[] = [];
          try {
            const { corpusHeadingLabels } = await import("@/lib/corpus-headings");
            headingLabels = await corpusHeadingLabels();
          } catch {
            headingLabels = [];
          }
          const rawPlan = await generateJson<unknown>({
            task: "query.plan",
            systemInstruction: SEARCH_PLANNER_SYSTEM_PROMPT,
            prompt: buildSearchPlannerPrompt({
              question,
              corpus,
              headingLabels,
            }),
            temperature: 0.1,
            onProviderRetry: noteRetry,
          });

          const plan = searchPlanSchema.parse(rawPlan);
          // Only an explicit user corpus request may hard-filter retrieval.
          // The planner's preferredCorpus remains advisory metadata in the plan.
          const effectiveCorpus = corpus ?? null;
          const inferredConcepts = inferConcepts(question, plan.searchQueries);

          send("plan", plan);

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
            const searchResponse = await searchProceduralAuthorities({
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
            const searchResponse = await searchProceduralAuthorities({
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

              const searchResponse = await searchProceduralAuthorities({
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

              const searchResponse = await searchProceduralAuthorities({
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
          const v517Selection = await selectV517ProductionAuthorities({
            searches,
            question,
            searchProceduralAuthorities,
            plannerRelations,
            situation: plan.situation,
          });

          // V40: preserve the established selector for procedure-first queries;
          // for natural incidents, adjudicate actual source-body evidence across
          // different actors/forums/stages. A model citation is never trusted
          // without a retrieved source and a verbatim supporting quotation.
          outcomeState.route = routeFromPlanner(plan.situation?.kind);
          outcomeState.allObligationsComplete = v517Selection.allObligationsComplete;
          outcomeState.obligationCoverage = v517Selection.obligationDetails.map((detail) => detail.coverage);
          outcomeState.partial.push(...obligationPartialFacets(v517Selection.obligationDetails));
          const v40IncidentGate = mustAdjudicateFromPlanner(
            plan.situation?.kind, v517Selection.finalAuthorities.length > 0,
          );
          let v40AuthoritySet = [...v517Selection.finalAuthorities];
          let v40Diagnostic: {
            status: string; candidateCount: number; selected: string[];
            rejected: string[]; gaps: string[]; providerAttempts: number;
            dossier: string[]; retrievedOutsideDossier: string[];
            dispositions: V402Disposition[]; unavailableNominations: number;
            recovery: { status: string; candidates: string[]; dispositions: V402Disposition[]; unavailableNominations: number; selected: string[]; rejected: string[] };
          } = {
            status: "not_invoked", candidateCount: 0, selected: [], rejected: [], gaps: [], providerAttempts: 0,
            dossier: [], retrievedOutsideDossier: [], dispositions: [], unavailableNominations: 0,
            recovery: { status: "not_needed", candidates: [], dispositions: [], unavailableNominations: 0, selected: [], rejected: [] },
          };
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
                  invoke: () => generateJson<unknown>({
                    // Evidence adjudication is a strict validation operation.
                    task: "answer.validate",
                    systemInstruction: V40_SOURCE_ADJUDICATION_SYSTEM_PROMPT,
                    prompt: buildV40SourceAdjudicationPrompt({
                      question, situation: plan.situation as V40Situation | undefined,
                      candidates: dossier, legacySelected: v40AuthoritySet,
                    }),
                    temperature: 0,
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
                };
                if (v40Review.reason === "v40_no_governing_witness") {
                  const candidates = v402RecoveryCandidates({ question, candidates: dossier, review: v40Review });
                  v40Diagnostic.recovery.candidates = candidates.map((source) => `${source.documentCorpus}:${source.citationLabel}`);
                  v40Diagnostic.recovery.status = candidates.length === 0 ? "no_eligible_sources" : "time_budget_exhausted";
                  if (candidates.length > 0 && Date.now() - started < 20_000) {
                    send("stage", { key: "selecting", label: "Independently reviewing eligible governing evidence" });
                    v40Diagnostic.recovery.status = "provider_unavailable";
                    try {
                      const rawRecovery = await generateJson<unknown>({
                        task: "answer.validate", systemInstruction: V402_SOURCE_RECOVERY_SYSTEM_PROMPT,
                        prompt: buildV40SourceAdjudicationPrompt({ question,
                          situation: plan.situation as V40Situation | undefined,
                          candidates, legacySelected: [] }), temperature: 0,
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
              }
            } else {
              v40AuthoritySet = [];
              v40Diagnostic.status = "no_retrieved_source_bodies";
            }
          }
          selected = {
            ...selected,
            finalAuthorities: v40AuthoritySet,
          };

          const legacyEvidenceGaps = describeMissingAuthoritySlots({
            question,
            plannerQueries: plan.searchQueries,
            missingRequiredSlots: selected.missingRequiredSlots,
          });
          // The legacy slot blueprint controls recovery and diagnostics, not the
          // authoritative semantic evidence pack. A missing legacy slot must
          // not add a contradictory user-facing gap to a grounded answer.
          const evidenceGaps = v40AuthoritySet.length > 0
            ? []
            : legacyEvidenceGaps;

          const rejectedApplicability = new Set(
            (v40Diagnostic.dispositions ?? [])
              .filter((row) => row.status === "rejected" && isApplicabilityRejection(row.reason))
              .map((row) => row.citationLabel.toLowerCase()),
          );
          const crossRefs = new Set(selected.finalAuthorities.flatMap((item) =>
            expressCrossReferences(item.sectionContent ?? "")));
          const issues = plan.situation?.materialFacts ?? [];
          const coversIssue = (issue: string, authorities: typeof selected.finalAuthorities) => {
            const tokens = contentTokens(issue);
            if (tokens.length === 0) return true;
            return authorities.some((authority) => {
              const hay = contentTokens(`${authority.heading ?? ""} ${authority.sectionContent ?? ""}`);
              const overlap = tokens.filter((token) => hay.includes(token)).length;
              return overlap >= Math.min(2, tokens.length);
            });
          };
          const uncovered = issues.filter((issue) => !coversIssue(issue, selected.finalAuthorities));
          if (selected.finalAuthorities.length === 0 || crossRefs.size > 0 || uncovered.length > 0) {
            const seen = new Set(selected.finalAuthorities.map((item) => item.sectionId));
            const recovered = [];
            for (const result of searches.flatMap((search) => search.results)) {
              if (seen.has(result.sectionId)) continue;
              if (rejectedApplicability.has(result.citationLabel.toLowerCase())) continue;
              if (v40SourceScopeMismatch(question, result, plan.situation?.setting)) continue;
              const referenced = [...crossRefs].some((ref) => ref.toLowerCase() === result.citationLabel.toLowerCase());
              const coversUncovered = uncovered.some((issue) => coversIssue(issue, [result]));
              const attests = !plan.situation?.action || quoteAttestsActAndObject(result.sectionContent, plan.situation.action);
              if (!referenced && !coversUncovered && !(selected.finalAuthorities.length === 0 && attests)) continue;
              if (!referenced && !attests) continue;
              seen.add(result.sectionId);
              recovered.push(result);
              if (selected.finalAuthorities.length + recovered.length >= 4) break;
            }
            if (recovered.length > 0) {
              selected = { ...selected, finalAuthorities: [...selected.finalAuthorities, ...recovered] };
              outcomeState.evidenceRecovery = true;
            }
          }
          const finalAuthorities = selected.finalAuthorities;
          const authorityPayload: AuthorityPayload[] =
            buildAuthorityPayload(finalAuthorities);

          const finalAuthorityCorpora = [
            ...new Set(finalAuthorities.map((authority) => authority.documentCorpus)),
          ];
          const finalAuthorityCorpus =
            finalAuthorityCorpora.length === 1
              ? finalAuthorityCorpora[0]
              : null;

          send("authorities", {
            authorities: authorityPayload,
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
              prePruneLabels: v517Selection.prePruneLabels,
              selectedLabels: finalAuthorities.map((authority) => authority.citationLabel),
              legacySelectedLabels: v517Selection.selectedLabels,
              // These coverage scores belong to the lexical v5.18 selector,
              // not the incident adjudicator. Do not misstate them as v40 scores.
              evidenceAdmission: v40IncidentGate
                ? v40Diagnostic.status : v517Selection.evidenceAdmission,
              legacyEvidenceAdmission: v517Selection.evidenceAdmission,
              scenarioAdjudication: v40Diagnostic,
            },
            inferredConcepts: diagnosticConcepts,
            activeConcepts: selected.activeConceptIds,
            blueprintSlots: selected.blueprintSlots,
            requiredSlots: selected.requiredSlots,
            optionalSlots: selected.optionalSlots,
            satisfiedSlots: selected.satisfiedSlots,
            missingRequiredSlots: selected.missingRequiredSlots,
            blueprintSatisfied: selected.blueprintSatisfied,
            expandedQueries,
            recoveryAttempts,
            evidenceGaps,
            retrievals: searches.map((search) => {
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
            }),
            // The final selection diagnostic must describe the semantic pack
            // actually supplied to drafting, not the earlier legacy ranking.
            finalAuthoritySelection: finalAuthorities.map((result) => ({
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

            if (recoveryAttempts.length > 0) outcomeState.evidenceRecovery = true;
            if (finalAuthorities.length === 0) {
            outcomeState.fallbackReason = "no_authority_selected";
            outcomeState.abstained = true;
            const noAuthorityReason = searches.some((search) => search.results.length > 0)
              ? "Retrieved evidence did not satisfy the semantic authority-selection requirements."
              : "No relevant authorities were retrieved.";
            const fallbackAnswer = buildFallbackAnswer({
              question,
              planIntent: plan.intent,
              authorities: finalAuthorities,
              effectiveCorpus,
              fallbackReason: noAuthorityReason,
              failureClass: "selection",
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
              plan,
              answerText: fallbackAnswer,
              authorities: authorityPayload,
              fallbackReason: noAuthorityReason,
            });

            closeStream();
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
            const draftedAnswer = await streamText({
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
            let rewriteNote: string | null = null;
            let pruneNote: string | null = null;
            let claimValidationNote: string | null = null;

            if (!finalAnswer.trim()) {
              outcomeState.fallbackReason = "empty_draft";
              outcomeState.abstained = true;
              const fallbackReason = "The AI draft was empty.";

              const fallbackAnswer = buildFallbackAnswer({
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
                plan,
                answerText: fallbackAnswer,
                authorities: authorityPayload,
                fallbackReason,
              });

              closeStream();
              return;
            }

            send("stage", {
              key: "validating",
              label: "Validating grounded claims",
            });
            activeAiOperation = "post_validation";

            const initialPrune = pruneValidatedAnswerContent({
              answerText: finalAnswer,
              authorities: authorityPayload,
            });

            finalAnswer = normalizeAnswerFormatting(initialPrune.prunedText);
            if (initialPrune.removedLines.length > 0) {
              pruneNote = `Pruned unsupported lines: ${initialPrune.removedLines.length}`;
            }

            if (!finalAnswer.trim()) {
              outcomeState.fallbackReason = "prune_emptied_draft";
              outcomeState.abstained = true;
              const fallbackReason =
                "The AI draft could not be validated after pruning unsupported content.";

              const fallbackAnswer = buildFallbackAnswer({
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
                plan,
                answerText: fallbackAnswer,
                authorities: authorityPayload,
                fallbackReason,
              });

              closeStream();
              return;
            }

            const citationValidation = validateAnswerCitations({
              answerText: finalAnswer,
              authorities: authorityPayload,
            });

            if (!citationValidation.ok) {
              outcomeState.fallbackReason = "invalid_citations";
              outcomeState.abstained = true;
              const fallbackReason = `The AI draft cited authorities that were not retrieved: ${citationValidation.invalidCitations
                .map((citation) => `[${citation}]`)
                .join(", ")}`;

              const fallbackAnswer = buildFallbackAnswer({
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
                plan,
                answerText: fallbackAnswer,
                authorities: authorityPayload,
                fallbackReason,
                invalidCitations: citationValidation.invalidCitations,
              });

              closeStream();
              return;
            }

            const authorityMentionValidation = validateAnswerAuthorityMentions({
              answerText: finalAnswer,
              authorities: authorityPayload,
            });

            if (!authorityMentionValidation.ok) {
              const admittedLabels = new Set(authorityPayload.map((authority) => authority.citationLabel.toLowerCase()));
              for (const mention of authorityMentionValidation.invalidAuthorityMentions) {
                const retrieved = searches.flatMap((search) => search.results).find((result) =>
                  result.citationLabel.toLowerCase() === mention.toLowerCase()
                  || `so ${result.citationLabel.replace(/^so\s+/i, "")}`.toLowerCase() === mention.toLowerCase());
                if (!retrieved || rejectedApplicability.has(retrieved.citationLabel.toLowerCase())) continue;
                if (v40SourceScopeMismatch(question, retrieved, plan.situation?.setting)) continue;
                if (admittedLabels.has(retrieved.citationLabel.toLowerCase())) continue;
                authorityPayload.push(...buildAuthorityPayload([retrieved]));
                finalAuthorities.push(retrieved);
                admittedLabels.add(retrieved.citationLabel.toLowerCase());
                outcomeState.evidenceRecovery = true;
              }
              const rewrite = rewriteForbiddenAuthorityMentions({
                answerText: finalAnswer,
                authorities: authorityPayload,
              });

              finalAnswer = normalizeAnswerFormatting(rewrite.rewrittenText);

              const secondPrune = pruneValidatedAnswerContent({
                answerText: finalAnswer,
                authorities: authorityPayload,
              });

              finalAnswer = normalizeAnswerFormatting(secondPrune.prunedText);

              rewriteNote = `Rewrote unsupported authority mentions: ${rewrite.removedMentions.join(
                ", ",
              )}${
                secondPrune.removedLines.length > 0
                  ? `; pruned additional lines: ${secondPrune.removedLines.length}`
                  : ""
              }`;

              const recheckMentions = validateAnswerAuthorityMentions({
                answerText: finalAnswer,
                authorities: authorityPayload,
              });

              const recheckCitations = validateAnswerCitations({
                answerText: finalAnswer,
                authorities: authorityPayload,
              });

              if (!recheckMentions.ok || !recheckCitations.ok || !finalAnswer) {
                outcomeState.fallbackReason = "ungrounded_mentions";
                outcomeState.abstained = true;
                const fallbackReason = `The AI draft mentioned or cited authorities that could not be grounded: ${
                  recheckMentions.ok
                    ? recheckCitations.ok
                      ? "unknown validation failure"
                      : recheckCitations.invalidCitations.join(", ")
                    : recheckMentions.invalidAuthorityMentions.join(", ")
                }`;

                const fallbackAnswer = buildFallbackAnswer({
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
                  plan,
                  answerText: fallbackAnswer,
                  authorities: authorityPayload,
                  fallbackReason,
                });

                closeStream();
                return;
              }
            }

            let answerClaims = extractAnswerClaims(finalAnswer);

            if (answerClaims.length === 0) {
              outcomeState.fallbackReason = "no_grounded_claims";
              outcomeState.abstained = true;
              const fallbackReason =
                "The AI draft contained no substantive grounded claims after deterministic validation.";

              const fallbackAnswer = buildFallbackAnswer({
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
                plan,
                answerText: fallbackAnswer,
                authorities: authorityPayload,
                fallbackReason,
              });

              closeStream();
              return;
            }

            // v38.1: retry ONLY a structured, transient provider error from
            // claim validation. A successful draft must never be regenerated.
            activeAiOperation = "claim_validation";
            const validationResult = await runClaimValidationWithRetry({
              requestStartedAt: started,
              invoke: () => generateJson<unknown>({
                task: "answer.validate",
                systemInstruction: ANSWER_CLAIM_VALIDATOR_SYSTEM_PROMPT,
                prompt: buildAnswerClaimValidationPrompt({
                  claims: answerClaims,
                  authorities: finalAuthorities,
                  question,
                  answerText: finalAnswer,
                }),
                temperature: 0,
              }),
              onRetry: () => {
                send("stage", {
                  key: "validating",
                  label: "Retrying grounded-claim validation after a transient AI-service error",
                });
              },
            });
            claimValidationAttempts = validationResult.attempts;
            let claimValidation =
              claimValidationSchema.parse(validationResult.value);
            activeAiOperation = "post_validation";
            if (claimValidationAttempts > 1) {
              claimValidationNote = `v38.1 validated after ${claimValidationAttempts} provider attempts`;
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
                const proposedRepair = await streamText({
                  task: "answer.generate",
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
                const repairedClaims = extractAnswerClaims(repairedAnswer);
                const repairedCitations = validateAnswerCitations({
                  answerText: repairedAnswer, authorities: authorityPayload,
                });
                const repairedMentions = validateAnswerAuthorityMentions({
                  answerText: repairedAnswer, authorities: authorityPayload,
                });
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
                    invoke: () => generateJson<unknown>({
                      task: "answer.validate",
                      systemInstruction: ANSWER_CLAIM_VALIDATOR_SYSTEM_PROMPT,
                      prompt: buildAnswerClaimValidationPrompt({
                        claims: repairedClaims, authorities: finalAuthorities,
                        question, answerText: repairedAnswer,
                      }),
                      temperature: 0,
                    }),
                    onRetry: () => send("stage", {
                      key:"validating", label:"Retrying independent incident-repair validation",
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
                    finalAnswer = repairedAnswer;
                    answerClaims = repairedClaims;
                    claimValidation = reviewedRepair;
                    v401RepairDiagnostic = "accepted_independently_validated";
                    claimValidationNote = [claimValidationNote,
                      `v40.1 repair=accepted; attempts=${claimValidationAttempts}`]
                      .filter(Boolean).join("; ");
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
                v401RepairDiagnostic === "accepted_independently_validated"
                  ? "Incident decision repaired and independently validated"
                  : "Incident repair not admitted; preserving safety verdict"});
            }
            const validationById = new Map(
              claimValidation.claims.map((claim) => [claim.id, claim]),
            );
            if (v40IncidentGate && (
                claimValidation.responsiveness?.answersUserQuestion !== true ||
                !answerSectionHasContent(finalAnswer, "Bottom line:") ||
                (claimValidation.responsiveness?.unaddressedParts.length ?? 0) > 0)) {
              outcomeState.fallbackReason = "not_responsive";
              outcomeState.abstained = true;
              const fallbackReason =
                "The cited draft did not demonstrably answer the question asked.";
              const fallbackAnswer = buildFallbackAnswer({
                question, planIntent: plan.intent, authorities: finalAuthorities,
                effectiveCorpus, fallbackReason,
              });
              send("stage", {
                key: "validating", label: "Answer failed incident-responsiveness gate",
              });
              send("answer_delta", {text: fallbackAnswer});
              send(markOperationalTerminal("done"), {
                ok: true, degraded: true, question, corpus: effectiveCorpus,
                latencyMs: Date.now() - started, plan, answerText: fallbackAnswer,
                authorities: authorityPayload, fallbackReason,
                claimValidationNote: [
                  claimValidation.responsiveness?.reason ??
                    "Validator omitted the mandatory responsiveness verdict",
                  `v40.1 incidentRepair=${v401RepairDiagnostic}`,
                ].join("; "),
              });
              closeStream();
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
                send("stage", { key: "validating", label: "Independently reviewing disputed source entailment" });
                try {
                  const rawAppeal = await generateJson<unknown>({
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
                  appealDiagnostic = `v36 source-quotation review attempted=${disputed.length}, corroborated=${acceptedAppeals.size}`;
                } catch (appealError) {
                  // Reviewer errors, malformed JSON, missing or fake quotations
                  // are not a reason to waive the original rejection.
                  appealDiagnostic = `v36 independent review unavailable; original rejection preserved (${appealError instanceof Error ? appealError.name : "error"})`;
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

              const unsupportedReasons = semanticPrune.removedClaims
                .map((claim) => {
                  const reason =
                    qualificationById.get(claim.id)?.reason ??
                    validationById.get(claim.id)?.reason ??
                    "no supporting validation result";
                  return `${claim.id}: ${reason}`;
                })
                .join(" | ");

              claimValidationNote = `Pruned semantically unsupported claims: ${semanticPrune.removedClaims.length}${
                unsupportedReasons ? ` (${unsupportedReasons})` : ""
              }`;
              if (appealDiagnostic) claimValidationNote += `; ${appealDiagnostic}`;
            } else {
              finalAnswer = removeEmptyAnswerSections(finalAnswer);
              if (appealDiagnostic) claimValidationNote = appealDiagnostic;
            }

            let remainingClaims = extractAnswerClaims(finalAnswer);
            let finalCitationValidation = validateAnswerCitations({
              answerText: finalAnswer,
              authorities: authorityPayload,
            });
            let finalMentionValidation = validateAnswerAuthorityMentions({
              answerText: finalAnswer,
              authorities: authorityPayload,
            });

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
                const rawRecovery = await generateJson<unknown>({
                  task: "answer.validate",
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
                  const mentionOK = validateAnswerAuthorityMentions({
                    answerText: candidate,
                    authorities: authorityPayload,
                  }).ok;
                  const qualificationOK = findOmittedSourceQualifications({
                    claims: candidateClaims,
                    authorities: finalAuthorities,
                  }).length === 0;
                  if (candidateClaims.length === 1 && citationOK && mentionOK && qualificationOK) {
                    const rawReview = await generateJson<unknown>({
                      task: "answer.validate",
                      systemInstruction: ANSWER_CLAIM_VALIDATOR_SYSTEM_PROMPT,
                      prompt: buildAnswerClaimValidationPrompt({
                        claims: candidateClaims,
                        authorities: finalAuthorities,
                      }),
                      temperature: 0,
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
                      finalMentionValidation = validateAnswerAuthorityMentions({
                        answerText: finalAnswer,
                        authorities: authorityPayload,
                      });
                      hasBottomLine = answerSectionHasContent(finalAnswer,"Bottom line:");
                      reconstructionDiagnostic = "accepted_independently_validated";
                    }
                  }
                }
              } catch {
                reconstructionDiagnostic = "unavailable_original_rejection_preserved";
              }
              claimValidationNote = [claimValidationNote,
                `v38 bottomLineRecovery=${reconstructionDiagnostic}`].filter(Boolean).join("; ");
            }

            if (
              remainingClaims.length === 0 ||
              !hasBottomLine ||
              !finalCitationValidation.ok ||
              !finalMentionValidation.ok
            ) {
              const ooV29RejectedClaimDetails = unsupportedClaimIds
                .slice(0, 8)
                .map((claimId) => {
                  const rejectedClaim = answerClaims.find((claim) => claim.id === claimId);
                  const reason = qualificationById.get(claimId)?.reason ??
                    validationById.get(claimId)?.reason ?? "missing validation decision";
                  const claimExcerpt = (rejectedClaim?.text ?? "").replace(/\s+/g, " ").slice(0, 130);
                  return `${claimId}[${claimExcerpt}]: ${reason.replace(/\s+/g, " ").slice(0, 220)}`;
                })
                .join(" | ");
              const ooV29FailureTrace = [
                "v29-semantic-fallback-trace",
                `bottomLineBeforePrune=${ooV29BottomLineBeforeSemanticPrune}`,
                `bottomLineAfterPrune=${hasBottomLine}`,
                `draftClaims=${answerClaims.length}`,
                `rejectedClaims=${unsupportedClaimIds.length}`,
                `remainingClaims=${remainingClaims.length}`,
                `citationsValid=${finalCitationValidation.ok}`,
                `mentionsValid=${finalMentionValidation.ok}`,
                `rejected=${ooV29RejectedClaimDetails || "none"}`,
                `appeal=${appealDiagnostic || "not attempted"}`,
              ].join("; ");
              outcomeState.fallbackReason = !hasBottomLine ? "bottom_line_lost" : "validation_rejected";
              outcomeState.abstained = true;
              const fallbackReason = !hasBottomLine
                ? "The AI draft lost its grounded Bottom line during semantic entailment validation."
                : "The AI draft could not retain a valid set of grounded claims after semantic entailment validation.";

              const fallbackAnswer = buildFallbackAnswer({
                question,
                planIntent: plan.intent,
                authorities: finalAuthorities,
                effectiveCorpus,
                fallbackReason,
              });

              send("stage", {
                key: "validating",
                label: "Semantic validation rejected the draft; returning fallback",
              });

              send("answer_delta", { text: fallbackAnswer });

              send(markOperationalTerminal("done"), {
                ok: true,
                degraded: true,
                question,
                corpus: effectiveCorpus,
                latencyMs: Date.now() - started,
                plan,
                answerText: fallbackAnswer,
                authorities: authorityPayload,
                fallbackReason,
                // v29: existing debug-snapshot field, only for this failure path.
                claimValidationNote: ooV29FailureTrace,
              });

              closeStream();
              return;
            }

            if (evidenceGaps.length > 0) {
              finalAnswer = appendEvidenceGapSection(
                finalAnswer,
                evidenceGaps.map((gap) => gap.description),
              );
            }

            if (claimValidationAttempts > 1 &&
                !(claimValidationNote ?? "").includes("v38.1 validated after")) {
              claimValidationNote = [claimValidationNote,
                `v38.1 validated after ${claimValidationAttempts} provider attempts`]
                .filter(Boolean).join("; ");
            }
            finalAnswer = labelBareRulings(finalAnswer);
            const cited = dropUnreferencedCitationEntries(finalAnswer);
            finalAnswer = cited.text;
            const declared = insufficiencyFacets(finalAnswer);
            if (declared.length > 0 && outcomeState.fallbackReason === "none") {
              outcomeState.partial.push(...declared);
            }
            if (evidenceGaps.length > 0) outcomeState.partial.push("evidence_gap");
            if (describesStandingOrdersAsStatute(finalAnswer)) outcomeState.partial.push("instrument_character");
            if (overHedgesSettledDuty(finalAnswer, finalAuthorities)) outcomeState.partial.push("over_hedged");
            outcomeState.partial.push(...conditionalSubIssueGaps(finalAnswer));
            if (finalAuthorities.some((authority) => actorClassDrift(finalAnswer, authority.sectionContent))) {
              outcomeState.partial.push("actor_class");
            }
            if (claimValidationAttempts > 1) {
              outcomeState.providerRetries = Math.max(outcomeState.providerRetries, claimValidationAttempts - 1);
            }
            const citedLabels = new Set(citationLabelsIn(finalAnswer).map((label) => label.toLowerCase()));
            const citedAuthorities = authorityPayload.filter((authority) =>
              citedLabels.has(authority.citationLabel.toLowerCase()));
            send("answer_delta", { text: finalAnswer });

            send(markOperationalTerminal("done"), {
              ok: true,
              degraded: evidenceGaps.length > 0,
              question,
              corpus: effectiveCorpus,
              latencyMs: Date.now() - started,
              plan,
              answerText: finalAnswer,
              authorities: citedLabels.size > 0 ? citedAuthorities : authorityPayload,
              rewriteNote,
              pruneNote,
              claimValidationNote,
              recoveryAttempts,
              evidenceGaps,
              missingRequiredSlots: selected.missingRequiredSlots,
            });

            closeStream();
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
            outcomeState.fallbackReason = isDraftFailure ? "drafting_unavailable" : "validation_unavailable";
            outcomeState.abstained = true;
            const fallbackReason = publicFailureReason(operationFailure);
            const fallbackAnswer = buildFallbackAnswer({
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
              plan,
              answerText: fallbackAnswer,
              authorities: authorityPayload,
              fallbackReason,
              claimValidationNote: `v38.1 operation=${operationFailure.phase}; kind=${operationFailure.kind}; status=${operationFailure.httpStatus ?? "none"}; code=${operationFailure.code ?? "none"}; provider=${operationFailure.provider ?? "none"}; upstreamName=${operationFailure.upstreamErrorName ?? "none"}; retryable=${operationFailure.retryable}; attempts=${operationFailure.attempts}; elapsedMs=${operationFailure.elapsedMs}`,
              operationFailure,
            });

            closeStream();
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
          closeStream();
        }
      };

      await superviseAnswerStream({
        deadlineMs: ANSWER_STREAM_DEADLINE_MS,
        heartbeatMs: ANSWER_STREAM_HEARTBEAT_MS,
        write: (chunk) => { try { controller.enqueue(encoder.encode(chunk)); } catch { /* closed */ } },
        work: async (rawSend) => {
          outbound = (event, data) => rawSend(event, data);
          await run();
        },
      });
      closeStream();
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
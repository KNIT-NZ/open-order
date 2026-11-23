// app/api/ai/answer/route.ts
import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { generateJson, streamText } from "@/lib/ai";
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
} from "@/lib/ai/prompts";
import { findOmittedSourceQualifications } from "@/lib/ai/qualification-guard";
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

const searchPlanSchema = z.object({
  intent: z.enum([
    "explain_rule",
    "explain_statement",
    "options",
    "admissibility",
    "tactic",
    "compare_authorities",
    "clarification",
  ]),
  preferredCorpus: z.enum(["standing_orders", "speakers_rulings"]).nullable(),
  searchQueries: z
    .array(z.string().min(1))
    .min(1)
    .transform((queries) => queries.slice(0, 3)),
  salientTerms: z.array(z.string().min(1)).max(4).default([]),
  notes: z.string(),
});

const claimValidationSchema = z.object({
  claims: z.array(
    z.object({
      id: z.string().min(1),
      supported: z.boolean(),
      reason: z.string(),
    }),
  ),
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

type SearchPlan = z.infer<typeof searchPlanSchema>;
type AuthorityPayload = ReturnType<typeof buildAuthorityPayload>[number];

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: NextRequest) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return new Response(sseEvent("error", { message: "Invalid JSON body" }), {
      status: 400,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  }

  const parsed = aiAnswerRequestSchema.safeParse(body);

  if (!parsed.success) {
    return new Response(
      sseEvent("error", {
        message: "Invalid request body",
        details: parsed.error.flatten(),
      }),
      {
        status: 400,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
        },
      },
    );
  }

  const { question, corpus = null } = parsed.data;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const startedAt = Date.now();
      const requestId = randomUUID();
      // Vercel supplies the public deployment commit when available.
      const buildCommit = process.env.VERCEL_GIT_COMMIT_SHA ?? null;
      const stageTimeline: Array<{ key: string; label: string; atMs: number }> = [];
      const send = (event: string, data: unknown) => {
        if (event === "stage" && data && typeof data === "object") {
          const stage = data as { key?: unknown; label?: unknown };
          if (typeof stage.key === "string" && typeof stage.label === "string" && stageTimeline.length < 32) {
            stageTimeline.push({ key: stage.key, label: stage.label, atMs: Math.max(0, Date.now() - startedAt) });
          }
        }
        if ((event === "done" || event === "error") && data && typeof data === "object") {
          data = {
            ...data,
            trace: {
              schemaVersion: 2,
              requestId,
              buildCommit,
              stageTimeline,
            },
          };
        }
        controller.enqueue(encoder.encode(sseEvent(event, data)));
      };

      const run = async () => {
        const started = startedAt;

        try {
          send("stage", {
            key: "planning",
            label: "Planning retrieval",
          });

          const rawPlan = await generateJson<unknown>({
            task: "query.plan",
            systemInstruction: SEARCH_PLANNER_SYSTEM_PROMPT,
            prompt: buildSearchPlannerPrompt({
              question,
              corpus,
            }),
            temperature: 0.1,
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

          const queryPlan = buildProceduralQueryPlan({
            question,
            plannerQueries: plan.searchQueries,
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
          const v517Selection = await selectV517ProductionAuthorities({
            searches,
            question,
            searchProceduralAuthorities,
          });
          selected = {
            ...selected,
            finalAuthorities: v517Selection.finalAuthorities,
          };

          const legacyEvidenceGaps = describeMissingAuthoritySlots({
            question,
            plannerQueries: plan.searchQueries,
            missingRequiredSlots: selected.missingRequiredSlots,
          });
          // The legacy slot blueprint controls recovery and diagnostics, not the
          // authoritative semantic evidence pack. A missing legacy slot must
          // not add a contradictory user-facing gap to a grounded answer.
          const evidenceGaps = v517Selection.finalAuthorities.length > 0
            ? []
            : legacyEvidenceGaps;

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
              selectedLabels: v517Selection.selectedLabels,
              evidenceAdmission: v517Selection.evidenceAdmission,
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
            finalAuthoritySelection: v517Selection.finalAuthorities.map((result) => ({
              query: "semantic_authority_pack",
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

            send("done", {
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

            controller.close();
            return;
          }

          send("stage", {
            key: "answering",
            label: "Drafting answer",
          });

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
                evidenceGaps: evidenceGaps.map((gap) => gap.description),
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

              send("done", {
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

              controller.close();
              return;
            }

            send("stage", {
              key: "validating",
              label: "Validating grounded claims",
            });

            const initialPrune = pruneValidatedAnswerContent({
              answerText: finalAnswer,
              authorities: authorityPayload,
            });

            finalAnswer = normalizeAnswerFormatting(initialPrune.prunedText);
            if (initialPrune.removedLines.length > 0) {
              pruneNote = `Pruned unsupported lines: ${initialPrune.removedLines.length}`;
            }

            if (!finalAnswer.trim()) {
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

              send("done", {
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

              controller.close();
              return;
            }

            const citationValidation = validateAnswerCitations({
              answerText: finalAnswer,
              authorities: authorityPayload,
            });

            if (!citationValidation.ok) {
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

              send("done", {
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

              controller.close();
              return;
            }

            const authorityMentionValidation = validateAnswerAuthorityMentions({
              answerText: finalAnswer,
              authorities: authorityPayload,
            });

            if (!authorityMentionValidation.ok) {
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

                send("done", {
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

                controller.close();
                return;
              }
            }

            const answerClaims = extractAnswerClaims(finalAnswer);

            if (answerClaims.length === 0) {
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

              send("done", {
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

              controller.close();
              return;
            }

            const rawClaimValidation = await generateJson<unknown>({
                task: "answer.validate",
              systemInstruction: ANSWER_CLAIM_VALIDATOR_SYSTEM_PROMPT,
              prompt: buildAnswerClaimValidationPrompt({
                claims: answerClaims,
                authorities: finalAuthorities,
              }),
              temperature: 0,
            });

            const claimValidation =
              claimValidationSchema.parse(rawClaimValidation);
            const validationById = new Map(
              claimValidation.claims.map((claim) => [claim.id, claim]),
            );

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

              send("done", {
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

              controller.close();
              return;
            }

            if (evidenceGaps.length > 0) {
              finalAnswer = appendEvidenceGapSection(
                finalAnswer,
                evidenceGaps.map((gap) => gap.description),
              );
            }

            send("answer_delta", { text: finalAnswer });

            send("done", {
              ok: true,
              degraded: evidenceGaps.length > 0,
              question,
              corpus: effectiveCorpus,
              latencyMs: Date.now() - started,
              plan,
              answerText: finalAnswer,
              authorities: authorityPayload,
              rewriteNote,
              pruneNote,
              claimValidationNote,
              recoveryAttempts,
              evidenceGaps,
              missingRequiredSlots: selected.missingRequiredSlots,
            });

            controller.close();
            return;
          } catch (draftingError) {
            const draftingMessage =
              draftingError instanceof Error
                ? draftingError.message
                : "AI drafting failed.";

            const fallbackAnswer = buildFallbackAnswer({
              question,
              planIntent: plan.intent,
              authorities: finalAuthorities,
              effectiveCorpus,
              fallbackReason: draftingMessage,
              failureClass: "provider",
            });

            send("stage", {
              key: "answering",
              label: "AI drafting failed; returning grounded fallback",
            });

            send("answer_delta", { text: fallbackAnswer });

            send("done", {
              ok: true,
              degraded: true,
              question,
              corpus: effectiveCorpus,
              latencyMs: Date.now() - started,
              plan,
              answerText: fallbackAnswer,
              authorities: authorityPayload,
              fallbackReason: draftingMessage,
            });

            controller.close();
            return;
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown AI answer error";

          send("error", {
            message,
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
          controller.close();
        }
      };

      void run();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
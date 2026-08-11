// app/api/ai/answer/route.ts
import { NextRequest } from "next/server";
import { z } from "zod";
import { generateJson, streamText } from "@/lib/ai/gemini";
import {
  ANSWER_CLAIM_VALIDATOR_SYSTEM_PROMPT,
  ANSWER_STREAM_SYSTEM_PROMPT,
  buildAnswerClaimValidationPrompt,
  buildGroundedAnswerPrompt,
  buildSearchPlannerPrompt,
  SEARCH_PLANNER_SYSTEM_PROMPT,
} from "@/lib/ai/prompts";
import { searchProceduralAuthorities } from "@/lib/procedural-search";
import {
  answerSectionHasContent,
  appendEvidenceGapSection,
  buildAuthorityPayload,
  buildAuthorityProfile,
  buildFallbackAnswer,
  buildMissingSlotRecoveryRequests,
  buildProceduralQueryPlan,
  describeMissingAuthoritySlots,
  extractAnswerClaims,
  inferConcepts,
  normalizeAnswerFormatting,
  pruneUnsupportedAnswerClaims,
  removeEmptyAnswerSections,
  pruneValidatedAnswerContent,
  rewriteForbiddenAuthorityMentions,
  selectFinalAuthorities,
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
  searchQueries: z.array(z.string().min(1)).min(1).max(3),
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
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(sseEvent(event, data)));
      };

      const run = async () => {
        const started = Date.now();

        try {
          send("stage", {
            key: "planning",
            label: "Planning retrieval",
          });

          const rawPlan = await generateJson<unknown>({
            systemInstruction: SEARCH_PLANNER_SYSTEM_PROMPT,
            prompt: buildSearchPlannerPrompt({
              question,
              corpus,
            }),
            temperature: 0.1,
          });

          const plan = searchPlanSchema.parse(rawPlan);
          const effectiveCorpus = corpus ?? plan.preferredCorpus ?? null;
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

          const evidenceGaps = describeMissingAuthoritySlots({
            question,
            plannerQueries: plan.searchQueries,
            missingRequiredSlots: selected.missingRequiredSlots,
          });

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
            finalAuthoritySelection: selected.scoredAuthorities.map((item) => ({
              query: item.query,
              citationLabel: item.result.citationLabel,
              heading: item.result.heading,
              documentCorpus: item.result.documentCorpus,
              baseRank: item.result.rank,
              routeBoost: item.routeBoost,
              slotBoost: item.slotBoost,
              preferredTextBoost: item.preferredTextBoost,
              bridgeBoost: item.bridgeBoost,
              adjustedRank: item.adjustedRank,
              matchedSlots: item.matchedSlotKeys,
              authorityFunction: buildAuthorityProfile(item.result).authorityFunction,
              path: item.result.path,
            })),
            selectedSlotMatches: selected.selectedSlotMatches,
          });

          if (finalAuthorities.length === 0) {
            const fallbackAnswer = buildFallbackAnswer({
              question,
              planIntent: plan.intent,
              authorities: finalAuthorities,
              effectiveCorpus,
              fallbackReason: "No relevant authorities were retrieved.",
            });

            send("stage", {
              key: "answering",
              label: "No authorities retrieved; returning grounded fallback",
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
              fallbackReason: "No relevant authorities were retrieved.",
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
              systemInstruction: ANSWER_STREAM_SYSTEM_PROMPT,
              prompt: buildGroundedAnswerPrompt({
                question,
                corpus: finalAuthorityCorpus ?? effectiveCorpus,
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

            let finalAnswer = normalizeAnswerFormatting(draftedAnswer);
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

            const unsupportedClaimIds = answerClaims
              .filter(
                (claim) => validationById.get(claim.id)?.supported !== true,
              )
              .map((claim) => claim.id);

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
                    validationById.get(claim.id)?.reason ??
                    "no supporting validation result";
                  return `${claim.id}: ${reason}`;
                })
                .join(" | ");

              claimValidationNote = `Pruned semantically unsupported claims: ${semanticPrune.removedClaims.length}${
                unsupportedReasons ? ` (${unsupportedReasons})` : ""
              }`;
            } else {
              finalAnswer = removeEmptyAnswerSections(finalAnswer);
            }

            const remainingClaims = extractAnswerClaims(finalAnswer);
            const finalCitationValidation = validateAnswerCitations({
              answerText: finalAnswer,
              authorities: authorityPayload,
            });
            const finalMentionValidation = validateAnswerAuthorityMentions({
              answerText: finalAnswer,
              authorities: authorityPayload,
            });

            const hasBottomLine = answerSectionHasContent(
              finalAnswer,
              "Bottom line:",
            );

            if (
              remainingClaims.length === 0 ||
              !hasBottomLine ||
              !finalCitationValidation.ok ||
              !finalMentionValidation.ok
            ) {
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
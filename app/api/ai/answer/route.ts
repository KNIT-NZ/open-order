// app/api/ai/answer/route.ts
import { NextRequest } from "next/server";
import { z } from "zod";
import { generateJson, streamText } from "@/lib/ai/gemini";
import {
  ANSWER_STREAM_SYSTEM_PROMPT,
  buildGroundedAnswerPrompt,
  buildSearchPlannerPrompt,
  SEARCH_PLANNER_SYSTEM_PROMPT,
} from "@/lib/ai/prompts";
import { searchProceduralAuthorities } from "@/lib/procedural-search";
import {
  buildAuthorityPayload,
  buildFallbackAnswer,
  expandPlannerQueries,
  inferConcepts,
  normalizeAnswerFormatting,
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
  notes: z.string(),
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

  const inferredConcepts = inferConcepts(question);

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

          send("plan", plan);

          send("stage", {
            key: "retrieving",
            label: "Retrieving authorities",
          });

          const expandedQueries = expandPlannerQueries({
            question,
            plannerQueries: plan.searchQueries,
            effectiveCorpus,
          });

          const searches: SearchExecution[] = [];

          for (const query of expandedQueries) {
            const searchResponse = await searchProceduralAuthorities({
              q: query,
              corpus: effectiveCorpus,
              limit: 6,
              offset: 0,
            });

            searches.push({
              query,
              corpus: effectiveCorpus,
              results: searchResponse.results,
            });
          }

          const selected = selectFinalAuthorities({
            searches,
            question,
            maxAuthorities:
              question.toLowerCase().includes("racist") ||
              question.toLowerCase().includes("racism") ||
              question.toLowerCase().includes("country of origin") ||
              question.toLowerCase().includes("unparliamentary")
                ? 6
                : 10,
          });

          const finalAuthorities = selected.finalAuthorities;
          const authorityPayload: AuthorityPayload[] =
            buildAuthorityPayload(finalAuthorities);

          send("authorities", {
            authorities: authorityPayload,
          });

          send("diagnostics", {
            effectiveCorpus,
            inferredConcepts: inferredConcepts.map((concept) => concept.id),
            expandedQueries,
            retrievals: searches.map((search) => ({
              query: search.query,
              corpus: search.corpus,
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
            })),
            finalAuthoritySelection: selected.scoredAuthorities.map((item) => ({
              query: item.query,
              citationLabel: item.result.citationLabel,
              heading: item.result.heading,
              documentCorpus: item.result.documentCorpus,
              baseRank: item.result.rank,
              routeBoost: item.routeBoost,
              adjustedRank: item.adjustedRank,
              path: item.result.path,
            })),
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

          let fullAnswer = "";

          try {
            fullAnswer = await streamText({
              systemInstruction: ANSWER_STREAM_SYSTEM_PROMPT,
              prompt: buildGroundedAnswerPrompt({
                question,
                corpus: effectiveCorpus,
                searches: [
                  {
                    query: "final_authority_pack",
                    corpus: effectiveCorpus,
                    results: finalAuthorities,
                  },
                ],
                concepts: inferredConcepts.map((c) => c.id),
              }),
              temperature: 0.2,
            });

            fullAnswer = normalizeAnswerFormatting(fullAnswer);

            let finalAnswer = fullAnswer;
            let rewriteNote: string | null = null;

            if (!fullAnswer.trim()) {
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

            const citationValidation = validateAnswerCitations({
              answerText: fullAnswer,
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

              rewriteNote = `Rewrote unsupported authority mentions: ${rewrite.removedMentions.join(
                ", ",
              )}`;

              const recheck = validateAnswerAuthorityMentions({
                answerText: finalAnswer,
                authorities: authorityPayload,
              });

              if (!recheck.ok) {
                const fallbackReason = `The AI draft mentioned authorities that could not be grounded: ${authorityMentionValidation.invalidAuthorityMentions.join(
                  ", ",
                )}`;

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
                  invalidAuthorityMentions:
                    authorityMentionValidation.invalidAuthorityMentions,
                });

                controller.close();
                return;
              }
            }

            send("answer_delta", { text: finalAnswer });

            send("done", {
              ok: true,
              degraded: false,
              question,
              corpus: effectiveCorpus,
              latencyMs: Date.now() - started,
              plan,
              answerText: finalAnswer,
              authorities: authorityPayload,
              rewriteNote,
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

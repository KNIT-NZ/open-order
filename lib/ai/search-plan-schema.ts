/**
 * V40.1 query-planner contract. The situation is advisory context, never a
 * source of procedural authority; malformed optional fields must not prevent
 * retrieval with a valid core plan. Zod 4 output normalises absent people.
 */
import { z } from "zod";

export const searchPlanSchema = z.object({
  intent: z.enum([
    "explain_rule", "explain_statement", "options", "admissibility",
    "tactic", "compare_authorities", "clarification",
  ]),
  preferredCorpus: z.enum(["standing_orders", "speakers_rulings"]).nullable(),
  searchQueries: z.array(z.string().min(1)).min(1)
    .transform((queries) => queries.slice(0, 3)),
  salientTerms: z.array(z.string().min(1)).max(4).default([]),
  notes: z.string(),
  situation: z.object({
    kind: z.enum(["incident", "procedure"]),
    actor: z.string().max(180),
    setting: z.string().max(180),
    action: z.string().max(240),
    affectedPerson: z.string().max(180).nullish()
      .transform((value) => value ?? ""),
    proceduralMoment: z.string().max(180),
    decisionQuestion: z.string().max(260),
    materialFacts: z.array(z.string().max(240)).max(5),
    verb: z.string().max(80).optional().catch(undefined),
    object: z.string().max(120).optional().catch(undefined),
    relations: z.array(z.enum([
      "stage_reopening",
      "proceeding_consequence",
      "error_correction",
      "presiding_appeal",
      "regulated_act",
    ])).max(4).optional().catch(undefined),
    evidenceQueries: z.array(z.string().min(2).max(90)).max(2).nullish()
      .transform((value) => value ?? []),
  }).nullish().catch(undefined).transform((value) => value ?? undefined),
});

export type SearchPlan = z.infer<typeof searchPlanSchema>;

// lib/search.ts
import { z } from "zod";

export const searchParamsSchema = z.object({
  q: z.string().min(1, "Query is required"),
  corpus: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

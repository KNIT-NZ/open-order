import { db } from "@/lib/db";

let cached: string[] | null = null;

/** Distinct corpus headings for planner vocabulary. No request text is stored. */
export async function corpusHeadingLabels(): Promise<string[]> {
  if (cached) return cached;
  const result = await db.query<{ heading: string }>(
    `select distinct heading
     from sections
     where heading is not null and char_length(btrim(heading)) between 3 and 80
     order by heading asc
     limit 180`,
  );
  cached = result.rows.map((row) => row.heading);
  return cached;
}

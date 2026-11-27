import { db } from "@/lib/db";

const CACHE_TTL_MS = 10 * 60 * 1000;
let cached: { at: number; labels: string[] } | null = null;

/**
 * Frequent corpus headings for the planner. The cache expires; it is not the
 * first alphabetical slice kept for the process lifetime. No request text is stored.
 */
export async function corpusHeadingLabels(): Promise<string[]> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.labels;
  const result = await db.query<{ heading: string }>(
    `select heading
     from sections
     where heading is not null and char_length(btrim(heading)) between 3 and 60
     group by heading
     order by count(*) desc, heading asc
     limit 80`,
  );
  cached = { at: Date.now(), labels: result.rows.map((row) => row.heading) };
  return cached.labels;
}

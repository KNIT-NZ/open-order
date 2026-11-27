import { db } from "@/lib/db";

const CACHE_TTL_MS = 10 * 60 * 1000;
const NEGATIVE_TTL_MS = 30 * 1000;
let cached: { at: number; labels: string[]; ok: boolean; error?: unknown } | null = null;
let inflight: Promise<string[]> | null = null;

/**
 * Frequent corpus headings for the planner. A success is reused for ten minutes.
 * A failed read is reused for thirty seconds, and concurrent callers share one query.
 * No request text is stored.
 */
export async function corpusHeadingLabels(): Promise<string[]> {
  const now = Date.now();
  if (cached && now - cached.at < (cached.ok ? CACHE_TTL_MS : NEGATIVE_TTL_MS)) {
    if (!cached.ok) throw cached.error;
    return cached.labels;
  }
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const result = await db.query<{ heading: string }>(
        `select heading
         from sections
         where heading is not null and char_length(btrim(heading)) between 3 and 60
         group by heading
         order by count(*) desc, heading asc
         limit 80`,
      );
      cached = { at: Date.now(), labels: result.rows.map((row) => row.heading), ok: true };
      return cached.labels;
    } catch (error) {
      cached = { at: Date.now(), labels: [], ok: false, error };
      throw error;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

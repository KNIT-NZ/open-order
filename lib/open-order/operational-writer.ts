import { after } from "next/server";
import { Pool } from "pg";
import { verifiedDatabaseUrl } from "@/lib/db-transport";
import { parseOperationalEvent } from "./operational-event";

// Deliberately separate from the corpus pool. No fallback to DATABASE_URL.
let pool: Pool | undefined;
let failures = 0;
function noteFailure(): void { failures = Math.min(failures + 1, 1_000_000); }
export function operationalFailureCount(): number { return failures; }
function enabled(): boolean {
  return process.env.VERCEL_ENV === "production" && process.env.OPEN_ORDER_OPS_ENABLED === "1";
}
async function writeEvent(input: unknown): Promise<void> {
  try {
    const event = parseOperationalEvent(input);
    const url = process.env.OPEN_ORDER_OPERATIONAL_DATABASE_URL;
    if (!event || !url || !event.releaseSha) { noteFailure(); return; }
    if (!pool) {
      pool = new Pool({ connectionString: verifiedDatabaseUrl(url, "production"), max: 1,
        connectionTimeoutMillis: 1500, query_timeout: 2000, idleTimeoutMillis: 5000 });
      pool.on("error", noteFailure);
    }
    const result = await pool.query<{ accepted: boolean }>(
      "select open_order_ops.record_event_v1($1::smallint,$2::uuid,$3::text,$4::text,$5::integer,$6::integer,$7::integer,$8::text,$9::text) as accepted",
      [event.schemaVersion, event.requestId, event.route, event.outcome, event.elapsedMs,
       event.resultCount, event.stageCount, event.lastStage, event.releaseSha]);
    if (result.rows[0]?.accepted !== true) noteFailure();
  } catch { noteFailure(); }
}
// Register only in the request scope. No await, no raw errors, no recursive logging.
export function scheduleOperationalEvent(snapshot: () => unknown): void {
  if (!enabled()) return;
  try {
    after(async () => {
      try { await writeEvent(snapshot()); } catch { noteFailure(); }
    });
  } catch { noteFailure(); }
}

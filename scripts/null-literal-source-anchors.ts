/**
 * Idempotent data fix: literal "None" or blank source_anchor values become NULL.
 * Refuses any database host that is not the reviewed Neon test branch.
 * Does not print the connection string.
 */
import pg from "pg";

function assertTestBranch(databaseUrl: string): void {
  let host = "";
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    throw new Error("Refusing to write: DATABASE_URL is not a URL.");
  }
  // The pooler hostname starts with the reviewed test-branch endpoint id.
  if (!host.startsWith("ep-weathered-hall")) {
    throw new Error("Refusing to write: database host is not the reviewed Neon test branch.");
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("Refusing to write: DATABASE_URL is unset.");
  assertTestBranch(databaseUrl);
  const client = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: true } });
  await client.connect();
  try {
    const before = await client.query<{
      literal_none: number;
      blank: number;
      already_null: number;
    }>(`
      select
        count(*) filter (where source_anchor ~* '^\\s*none\\s*$')::int as literal_none,
        count(*) filter (where source_anchor is not null and btrim(source_anchor) = '')::int as blank,
        count(*) filter (where source_anchor is null)::int as already_null
      from sections
    `);
    const candidates = Number(before.rows[0]?.literal_none ?? 0) + Number(before.rows[0]?.blank ?? 0);
    if (candidates === 0) {
      console.log(JSON.stringify({
        hostChecked: "ep-weathered-hall",
        dryRunCount: 0,
        updated: 0,
        before: before.rows[0],
        note: "No write: dry-run count was zero.",
      }));
      return;
    }
    const updated = await client.query(`
      update sections
      set source_anchor = null, updated_at = now()
      where source_anchor is not null
        and (source_anchor ~* '^\\s*none\\s*$' or btrim(source_anchor) = '')
    `);
    const after = await client.query<{ literal_none: number; blank: number; already_null: number }>(`
      select
        count(*) filter (where source_anchor ~* '^\\s*none\\s*$')::int as literal_none,
        count(*) filter (where source_anchor is not null and btrim(source_anchor) = '')::int as blank,
        count(*) filter (where source_anchor is null)::int as already_null
      from sections
    `);
    console.log(JSON.stringify({
      hostChecked: "ep-weathered-hall",
      before: before.rows[0],
      updated: updated.rowCount,
      after: after.rows[0],
    }));
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "data fix failed";
  console.error(message);
  process.exit(1);
});

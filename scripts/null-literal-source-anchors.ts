/**
 * Idempotent data fix: literal "None" or blank source_anchor values become NULL.
 *
 * Fail closed. There is no default host and no prefix match.
 * A write runs only when all of these hold:
 * - OPEN_ORDER_CORPUS_DB_HOST is set to the hostname the operator intends.
 * - OPEN_ORDER_ALLOWED_TEST_BRANCH_HOST is set to the one allowed test-branch hostname.
 * - those two values are exactly equal.
 * - the DATABASE_URL hostname is exactly that same host.
 * Does not print the connection string.
 */
import pg from "pg";

function allowedTestBranchHost(): string {
  const intended = process.env.OPEN_ORDER_CORPUS_DB_HOST ?? "";
  const allowed = process.env.OPEN_ORDER_ALLOWED_TEST_BRANCH_HOST ?? "";
  if (!intended) throw new Error("Refusing to write: OPEN_ORDER_CORPUS_DB_HOST is unset.");
  if (!allowed) throw new Error("Refusing to write: OPEN_ORDER_ALLOWED_TEST_BRANCH_HOST is unset.");
  if (intended !== allowed) {
    throw new Error("Refusing to write: OPEN_ORDER_CORPUS_DB_HOST is not the allowed test-branch host.");
  }
  return intended;
}

function assertTestBranch(databaseUrl: string): string {
  let host = "";
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    throw new Error("Refusing to write: DATABASE_URL is not a URL.");
  }
  const expected = allowedTestBranchHost();
  if (host !== expected) {
    throw new Error("Refusing to write: database host is not exactly the allowed test-branch host.");
  }
  return expected;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("Refusing to write: DATABASE_URL is unset.");
  const hostChecked = assertTestBranch(databaseUrl);
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
        hostChecked,
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
      hostChecked,
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

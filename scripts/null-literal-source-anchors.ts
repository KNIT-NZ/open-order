/**
 * Idempotent data fix: literal "None" or blank source_anchor values become NULL.
 *
 * Fail closed. There is no default host and no prefix match.
 * A write runs only when all of these hold:
 * - OPEN_ORDER_CORPUS_DB_HOST is set to the hostname the operator intends.
 * - OPEN_ORDER_ALLOWED_TEST_BRANCH_HOST is set to the one allowed test-branch hostname.
 * - those two values are exactly equal.
 * - pg's own connection-string parser resolves the database host to that exact host.
 * The guard refuses host and hostaddr parameters, a service name, more than
 * one host, a unix-socket or path host, a port that disagrees with itself,
 * TLS downgrade parameters, certificate and replication parameters, an options
 * parameter, a percent-encoded parameter name, and a set PGOPTIONS variable.
 * pg-connection-string is loaded the same way pg loads it.
 * Does not print the connection string.
 */
import { createRequire } from "node:module";
import pg from "pg";

const require = createRequire(import.meta.url);
const { parse: parseConnectionString } = require("pg-connection-string") as {
  parse: (connectionString: string) => { host?: string | null; port?: string | null; service?: string | null };
};

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
  const expected = allowedTestBranchHost();
  const query = (() => {
    try {
      return new URL(databaseUrl).search.slice(1);
    } catch {
      return "";
    }
  })();
  for (const part of query.split("&").filter(Boolean)) {
    const rawKey = part.split("=")[0] ?? "";
    if (/%[0-9a-f]{2}/i.test(rawKey)) {
      throw new Error("Refusing to write: connection string uses an encoded parameter name.");
    }
    let key = rawKey;
    try {
      key = decodeURIComponent(rawKey);
    } catch {
      throw new Error("Refusing to write: connection string has an undecodable parameter name.");
    }
    if (["host", "hostaddr", "ssl", "sslmode", "uselibpqcompat", "options", "sslrootcert", "sslcert", "sslkey", "replication"].includes(key.toLowerCase())) {
      throw new Error("Refusing to write: connection string sets a refused parameter.");
    }
  }
  let parsed: { host?: string | null; port?: string | null; service?: string | null };
  try {
    parsed = parseConnectionString(databaseUrl);
  } catch {
    throw new Error("Refusing to write: DATABASE_URL is not a connection string.");
  }
  if (parsed.service) throw new Error("Refusing to write: connection string uses a service name.");
  const host = String(parsed.host ?? "");
  if (!host || host.includes(",") || host.startsWith("/") || host.includes("/")) {
    throw new Error("Refusing to write: database host is not a single TCP host.");
  }
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error("Refusing to write: DATABASE_URL is not a URL.");
  }
  const queryPort = url.searchParams.get("port");
  if (queryPort && url.port && queryPort !== url.port) {
    throw new Error("Refusing to write: connection string ports disagree.");
  }
  if (parsed.port && url.port && String(parsed.port) !== url.port) {
    throw new Error("Refusing to write: parsed port does not match the URL port.");
  }
  if (host !== expected) {
    throw new Error("Refusing to write: database host is not exactly the allowed test-branch host.");
  }
  return expected;
}

async function main(): Promise<void> {
  if (process.env.PGOPTIONS) throw new Error("Refusing to write: PGOPTIONS is set.");
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

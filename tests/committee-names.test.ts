import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { committeeNameRecords } from "../lib/committee-names-data.js";
import { committeeRecordsFromSections } from "../lib/committee-names.js";
import { verifiedDatabaseUrl } from "../lib/db-transport";

test("a generated committee record keeps its corpus location", () => {
  const records = committeeRecordsFromSections([{
    sectionId: "sec-widget",
    heading: "Functions of the Widget Oversight Committee",
    path: ["Widget Oversight Committee"],
    citationLabel: "QX 9",
  }, {
    sectionId: "sec-sentence",
    heading: "Motion to omit select committee consideration",
    path: ["General"],
    citationLabel: "QX 10",
  }]);
  assert.equal(records.length, 1);
  assert.deepEqual(records[0]?.tokens, ["widget", "oversight"]);
  assert.equal(records[0]?.sectionId, "sec-widget");
  assert.equal(records[0]?.citationLabel, "QX 9");
  assert.ok(records[0]?.path.includes("Widget Oversight Committee"));
});

test("committed committee names carry a corpus location", () => {
  assert.ok(committeeNameRecords.length > 0);
  for (const record of committeeNameRecords) {
    assert.ok(record.tokens.length > 0);
    assert.match(record.sectionId, /^[0-9a-f-]{36}$/);
    assert.match(record.citationLabel, /^SO\s+\S+$/);
    assert.ok(record.path.length > 0);
  }
});

test("committed committee names match a fresh read of the corpus", async (t) => {
  const configured = process.env.DATABASE_URL ?? "";
  let hostname = "";
  try {
    hostname = configured ? new URL(configured).hostname : "";
  } catch {
    hostname = "";
  }
  if (!hostname.startsWith("ep-weathered-hall")) {
    t.skip("corpus database is not configured");
    return;
  }
  const pool = new Pool({ connectionString: verifiedDatabaseUrl(configured, "development") });
  try {
    const result = await pool.query(`
      select s.id::text as id, s.heading, s.path, s.citation_label
      from sections s
      join documents d on d.id = s.document_id
      where d.corpus in ('standing_orders', 'speakers_rulings')
        and (
          s.heading ilike '%committee%'
          or exists (select 1 from unnest(s.path) p where p ilike '%committee%')
        )
    `);
    const fresh = committeeRecordsFromSections(result.rows.map((row) => ({
      sectionId: row.id,
      heading: row.heading,
      path: row.path,
      citationLabel: row.citation_label,
    })));
    assert.deepEqual(fresh, committeeNameRecords);
  } finally {
    await pool.end();
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { committeeNameRecords } from "../lib/committee-names-data.js";
import { committeeNameTokens, committeeRecordsFromSections } from "../lib/committee-names.js";
import { forumIdentityOutcome } from "../lib/procedural-mechanisms";
import { publicCommitteeNameRecords, readCommitteeNameRows } from "../scripts/gen-committee-names";

test("a generated committee record keeps its corpus location", () => {
  const records = publicCommitteeNameRecords([{
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
  assert.equal(records[0]?.citationLabel, "QX 9");
  assert.equal("sectionId" in (records[0] ?? {}), false);
  assert.ok(records[0]?.path.includes("Widget Oversight Committee"));
  assert.equal(committeeRecordsFromSections([{
    sectionId: "sec-widget",
    heading: "Widget Oversight Committee",
    path: ["Widget Oversight Committee"],
    citationLabel: "QX 9",
  }])[0]?.sectionId, "sec-widget");
});

test("committed committee names carry a citation and path, not a section row id", () => {
  assert.ok(committeeNameRecords.length > 0);
  const serialised = JSON.stringify(committeeNameRecords);
  assert.equal(serialised.includes("sectionId"), false);
  for (const record of committeeNameRecords) {
    assert.ok(record.tokens.length > 0);
    assert.match(record.citationLabel, /^SO\s+\S+$/);
    assert.ok(record.path.length > 0);
    assert.equal("sectionId" in record, false);
  }
});

test("every listed body matches its own source path", () => {
  for (const record of committeeNameRecords) {
    const naming = record.path.filter((segment) => {
      const tokens = committeeNameTokens(segment);
      return tokens.length === record.tokens.length && tokens.every((token, index) => token === record.tokens[index]);
    });
    assert.ok(naming.length > 0, record.citationLabel);
    assert.equal(forumIdentityOutcome(naming[0], record.path), "match", record.citationLabel);
  }
});

test("committed committee names match the generator", async (t) => {
  const expectedHost = process.env.OPEN_ORDER_CORPUS_DB_HOST ?? "";
  const configured = process.env.DATABASE_URL ?? "";
  if (!expectedHost) {
    t.skip("OPEN_ORDER_CORPUS_DB_HOST is unset");
    return;
  }
  let hostname = "";
  try {
    hostname = configured ? new URL(configured).hostname : "";
  } catch {
    hostname = "";
  }
  if (!hostname || (hostname !== expectedHost && !hostname.startsWith(expectedHost))) {
    t.skip("corpus database host does not match OPEN_ORDER_CORPUS_DB_HOST");
    return;
  }
  const rows = await readCommitteeNameRows(configured);
  assert.deepEqual(publicCommitteeNameRecords(rows), committeeNameRecords);
});

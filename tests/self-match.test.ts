import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { forumIdentityOutcome } from "../lib/procedural-mechanisms.js";

type ExpectedRow = { id: string; outcome: "match" | "uncertain" | "reject" };

test("each pack section can be scored against its own path", () => {
  const packBytes = readFileSync(new URL("./fixtures/so-pack.json", import.meta.url));
  const expectedBytes = readFileSync(new URL("./fixtures/self-match-expected.json", import.meta.url));
  assert.equal(createHash("sha256").update(packBytes).digest("hex"), "34771e4a6102b996fc0a9cfc5d3663e06d32cd62395af7d00702a42e0b6eb100");
  assert.equal(createHash("sha256").update(expectedBytes).digest("hex"), "3f109f9ebc1fc7bd6f49e6b578df7b9bf66b63ac3d448dba848ac5c306b92da8");
  const pack = JSON.parse(packBytes.toString("utf8")) as {
    sections: Array<{ citation_label?: string; heading?: string; path?: string[] }>;
  };
  const counts = { match: 0, uncertain: 0, reject: 0 };
  const actual = new Map<string, string>();
  for (const section of pack.sections) {
    const heading = String(section.heading ?? "");
    const path = Array.isArray(section.path) ? section.path.map((segment) => String(segment)) : [];
    const outcome = forumIdentityOutcome(heading, path.length > 0 ? path : [heading]);
    counts[outcome as "match" | "uncertain" | "reject"] += 1;
    const id = String(section.citation_label ?? heading);
    actual.set(id, outcome);
  }
  assert.equal(counts.match + counts.uncertain + counts.reject, pack.sections.length);
  assert.equal(existsSync(new URL("./fixtures/self-match-expected.json", import.meta.url)), true, "self-match fixture is required");
  const expected = JSON.parse(expectedBytes.toString("utf8")) as ExpectedRow[];
  assert.equal(expected.length, pack.sections.length, "self-match fixture must cover every section");
  const seen = new Set<string>();
  for (const row of expected) {
    assert.equal(seen.has(row.id), false, row.id);
    seen.add(row.id);
    assert.equal(actual.has(row.id), true, row.id);
  }
  for (const id of actual.keys()) assert.equal(seen.has(id), true, id);
  const misses = expected.filter((row) => actual.get(row.id) !== row.outcome)
    .map((row) => ({ id: row.id, expected: row.outcome, actual: actual.get(row.id) }));
  assert.deepEqual(misses, []);
});

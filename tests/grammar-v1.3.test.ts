import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assessCitations } from "../lib/citations/grammar";

type Row = {
  id: string;
  input: string;
  admitted: string[];
  grounded: "yes" | "partial" | "no";
  tags: string[];
  provision_tree: Record<string, string[]>;
  expected_grounded_cpk: string[];
  expected_rule_codes: { parts: string[]; brackets: Array<string | null>; row: string };
};

const rows = readFileSync(new URL("./fixtures/grammar/v1.3/golden-corpus-v1.3.jsonl", import.meta.url), "utf8")
  .trim().split("\n").map((line) => JSON.parse(line) as Row);

const rank = { no: 0, partial: 1, yes: 2 } as const;

test("grammar v1.3 corpus has no false authority", () => {
  let agree = 0;
  let permissive = 0;
  let restrictive = 0;
  let extra = 0;
  let codeMismatch = 0;
  const permissiveIds: string[] = [];
  const extraIds: string[] = [];
  for (const row of rows) {
    const deferred = (row.tags ?? []).some((tag) => tag.startsWith("deferred"));
    const result = assessCitations(row.input, row.admitted.map((citationLabel) => ({ citationLabel })), {
      provisionTree: row.provision_tree ?? {},
      deferralTags: row.tags ?? [],
    });
    if (result.verdict === row.grounded) agree += 1;
    else if (rank[result.verdict] > rank[row.grounded]) {
      permissive += 1;
      if (!deferred) permissiveIds.push(row.id);
    } else restrictive += 1;
    const expected = new Set(row.expected_grounded_cpk ?? []);
    const extras = result.groundedCpk.filter((key) => !expected.has(key));
    if (!deferred && extras.length > 0) {
      extra += 1;
      extraIds.push(`${row.id}:${extras.join("+")}`);
    }
    if (result.ruleCodes.parts.join(",") !== (row.expected_rule_codes.parts ?? []).join(",")) codeMismatch += 1;
  }
  console.log(JSON.stringify({
    rows: rows.length, agree, permissive, restrictive, extra, codeMismatch,
  }));
  assert.deepEqual(permissiveIds, []);
  assert.deepEqual(extraIds, []);
});

test("mutation probes stay at least as strict as the grammar", () => {
  const probes = rows.filter((row) => row.id.startsWith("mutation_probe-") || row.id.startsWith("possessive-") || row.id.startsWith("bracket_quantity-014"));
  for (const row of probes) {
    const result = assessCitations(row.input, row.admitted.map((citationLabel) => ({ citationLabel })), {
      provisionTree: row.provision_tree ?? {},
      deferralTags: row.tags ?? [],
    });
    assert.ok(rank[result.verdict] <= rank[row.grounded], `${row.id} ${result.verdict} > ${row.grounded}`);
  }
});

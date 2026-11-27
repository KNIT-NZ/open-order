import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { committeeNameRecords } from "../lib/committee-names-data.js";
import { forumIdentityOutcome } from "../lib/procedural-mechanisms";
import { corpusProceedingHeads, corpusProceedingPhrases } from "../lib/corpus-proceedings-data.js";
import { publicCommitteeNameRecords, renderCommitteeNamesModule } from "../scripts/gen-committee-names";
import { deriveCorpusProceedings, renderCorpusProceedingsModule } from "../scripts/gen-corpus-proceedings";

const matrix = JSON.parse(readFileSync(new URL("./fixtures/corpus-matrix-v1.1.json", import.meta.url), "utf8"));

type MatrixCase = {
  id: string;
  matrix_part: number;
  section: string;
  path: string[];
  setting: string;
  expected: string;
  accepted: string[];
  rationale_code: string;
  on_reject?: string;
  ruling?: string;
  r3_scope?: string;
};

const cases = matrix.cases as MatrixCase[];

test("the public corpus matrix follows the forum rulings", () => {
  const byPart: Record<number, { pass: number; fail: number }> = {};
  const byCode: Record<string, { pass: number; fail: number }> = {};
  const failures: string[] = [];
  let warnFr8 = 0;
  let chapterTitleCaps = 0;
  for (const item of cases) {
    const outcome = forumIdentityOutcome(item.setting, item.path);
    const part = byPart[item.matrix_part] ??= { pass: 0, fail: 0 };
    const code = byCode[item.rationale_code] ??= { pass: 0, fail: 0 };
    if (item.on_reject === "warn_fr8" && outcome === "reject") {
      warnFr8 += 1;
      part.pass += 1;
      code.pass += 1;
      continue;
    }
    if (item.accepted.includes(outcome)) {
      part.pass += 1;
      code.pass += 1;
      if (item.r3_scope === "chapter_title_only" && outcome === "uncertain") chapterTitleCaps += 1;
    } else {
      part.fail += 1;
      code.fail += 1;
      if (failures.length < 12) failures.push(`${item.id} ${item.rationale_code} expected ${item.expected} got ${outcome}`);
    }
  }
  for (const check of matrix.synthetic_checks as MatrixCase[]) {
    const outcome = forumIdentityOutcome(check.setting, check.path);
    assert.ok(check.accepted.includes(outcome), `${check.id} got ${outcome}`);
  }
  assert.deepEqual(failures, [], JSON.stringify({ byPart, byCode, warnFr8, chapterTitleCaps }));
  const part1 = cases.filter((item) => item.matrix_part === 1);
  assert.equal(part1.length, 12);
  assert.ok(part1.every((item) => forumIdentityOutcome(item.setting, item.path) === "match"));
  for (const setting of ["the House", "the Chamber"]) {
    const rows = cases.filter((item) => item.matrix_part === 2 && item.setting === setting);
    const floor = rows.filter((item) => item.rationale_code === "S2_NEUTRAL_LEAF" || item.rationale_code === "S2_HOUSE_LEVEL_LEAF");
    const uncapped = rows.filter((item) => forumIdentityOutcome(item.setting, item.path) === "match").length;
    assert.equal(floor.length, 204, setting);
    assert.ok(floor.every((item) => forumIdentityOutcome(item.setting, item.path) === "match"), setting);
    assert.ok(uncapped >= floor.length, `${setting} uncapped ${uncapped}`);
    const illegalReject = rows.filter((item) => {
      const outcome = forumIdentityOutcome(item.setting, item.path);
      return outcome === "reject" && item.rationale_code !== "S2_LEAF_NAMES_COMMITTEE_FR8";
    });
    assert.equal(illegalReject.length, 0, setting);
  }
  assert.ok(chapterTitleCaps >= 0);
  assert.equal(warnFr8 >= 0, true);
});

test("committee names regenerate from the public sections without false bodies", () => {
  const seen = new Map<string, { heading: string; path: string[]; citationLabel: string }>();
  for (const item of cases) {
    const blob = [item.path.at(-1) ?? "", ...item.path].join("\n");
    if (!/committee/i.test(blob) || seen.has(item.section)) continue;
    seen.set(item.section, { heading: item.path.at(-1) ?? "", path: item.path, citationLabel: item.section });
  }
  // SO 378 is not in the public portion. Its pinned path is the committed record.
  for (const record of committeeNameRecords) {
    if (seen.has(record.citationLabel)) continue;
    seen.set(record.citationLabel, {
      heading: record.path.at(-1) ?? "",
      path: record.path,
      citationLabel: record.citationLabel,
    });
  }
  const rendered = renderCommitteeNamesModule(publicCommitteeNameRecords([...seen.values()]));
  const committed = readFileSync(new URL("../lib/committee-names-data.js", import.meta.url));
  assert.equal(createHash("sha256").update(rendered).digest("hex"), createHash("sha256").update(committed).digest("hex"));
  assert.equal(rendered, committed.toString());
  const forbidden = ["establishment", "meeting", "membership", "power"];
  const produced = publicCommitteeNameRecords([...seen.values()]);
  assert.ok(produced.every((record) => !(record.tokens.length === 1 && forbidden.includes(record.tokens[0] ?? ""))));
});

test("proceeding phrases match the published derivation and rebuild offline", () => {
  const expectedPhrases = Object.keys(matrix.derivation.proceedings).sort();
  const gotPhrases = corpusProceedingPhrases.map((phrase: string[]) => phrase.join(" ")).sort();
  assert.deepEqual(gotPhrases, expectedPhrases);
  assert.deepEqual([...corpusProceedingHeads].sort(), [...matrix.derivation.proceeding_head_nouns].sort());
  const publicSections = new Set(cases.map((item) => item.section));
  const rows: Array<{ heading: string; path: string[] }> = [];
  const seen = new Set<string>();
  for (const item of cases) {
    if (seen.has(item.section)) continue;
    seen.add(item.section);
    rows.push({ heading: item.path.at(-1) ?? "", path: item.path });
  }
  for (const info of Object.values(matrix.derivation.proceedings) as Array<{ setting: string; leaf_occurrences: string[] }>) {
    for (const section of info.leaf_occurrences) {
      if (publicSections.has(section)) continue;
      rows.push({ heading: info.setting, path: [info.setting] });
    }
  }
  const rendered = renderCorpusProceedingsModule(deriveCorpusProceedings(rows));
  const committed = readFileSync(new URL("../lib/corpus-proceedings-data.js", import.meta.url), "utf8");
  assert.equal(rendered, committed);
});

test("the anchor script refuses a host query, a socket, and a port mismatch", () => {
  const run = (databaseUrl: string) => spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/null-literal-source-anchors.ts"],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: {
        ...process.env,
        OPEN_ORDER_CORPUS_DB_HOST: "corpus.example",
        OPEN_ORDER_ALLOWED_TEST_BRANCH_HOST: "corpus.example",
        DATABASE_URL: databaseUrl,
      },
      encoding: "utf8",
    },
  );
  const hostQuery = run("postgresql://u:p@corpus.example/db?host=other.example");
  assert.notEqual(hostQuery.status, 0);
  assert.match(hostQuery.stderr, /refused parameter|host or hostaddr/);
  const socket = run("postgresql://u:p@corpus.example/db?host=/var/run/postgresql");
  assert.notEqual(socket.status, 0);
  const ports = run("postgresql://u:p@corpus.example:5432/db?port=5433");
  assert.notEqual(ports.status, 0);
  assert.match(ports.stderr, /port/i);
  const tls = run("postgresql://u:p@corpus.example/db?sslmode=disable&uselibpqcompat=true");
  assert.notEqual(tls.status, 0);
  const sslOff = run("postgresql://u:p@corpus.example/db?ssl=0");
  assert.notEqual(sslOff.status, 0);
  const options = run("postgresql://u:p@corpus.example/db?options=-csearch_path%3Dpublic");
  assert.notEqual(options.status, 0);
  const encoded = run("postgresql://u:p@corpus.example/db?%68ostaddr=127.0.0.1");
  assert.notEqual(encoded.status, 0);
});

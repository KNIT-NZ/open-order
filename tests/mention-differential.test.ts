import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateAnswerAuthorityMentions } from "../lib/procedural-reasoning";
import { mainFlagsMention } from "./frozen/main-mention-detector";

test("the frozen pattern is main 2ca3449 line 1859, including the bare fraction", () => {
  const source = readFileSync(new URL("./frozen/main-mention-detector.ts", import.meta.url), "utf8");
  const pinned = String.raw`\b(?:standing order|so)\s+\d+[a-z]*\b|\bappendix\s+[a-f]\s+(?:cl(?:ause)?\.?\s+\d+[a-z]*|(?:table|part)\s+\d+\s+row\s+\d+|note)\b|\b\d+\/\d+\b`;
  assert.equal(source.includes("2ca3449"), true);
  assert.equal(source.includes("1859"), true);
  assert.equal(source.includes(pinned), true);
  assert.equal(mainFlagsMention("See 12/9 before the House sits.", ["SO 1"]), true);
  assert.equal(mainFlagsMention("See 2/3 before the House sits.", ["2/3"]), false);
});

/**
 * Admitted rulings written "SO 2/3" or "Ruling 2/3", and the N-7 keeps
 * (bare "2/3" and "SR 2/3" when that ruling is admitted). Main flags some of
 * these; the head is allowed to keep them. Nothing else is.
 */
function intendedKeep(text: string, labels: string[]): boolean {
  const admitted = new Set<string>();
  for (const label of labels) {
    const bare = label.trim().match(/^(\d+\/\d+)$/);
    if (bare) admitted.add(bare[1]);
    const sr = label.trim().match(/^(?:SR|S\.R\.)\s*(\d+\/\d+)$/i);
    if (sr) admitted.add(sr[1]);
  }
  if (admitted.size === 0) return false;
  const compact = text.trim().replace(/\s+/g, " ");
  const spelled = compact.match(/^(?:SO|S\.O\.|Ruling|SR|Speakers' ruling|Speaker's ruling)\s+(\d+\/\d+)$/i);
  const bareText = compact.match(/^(\d+\/\d+)$/);
  const token = spelled?.[1] ?? bareText?.[1];
  return token !== undefined && admitted.has(token);
}

function headFlags(text: string, labels: string[]): boolean {
  return !validateAnswerAuthorityMentions({
    answerText: text,
    authorities: labels.map((citationLabel) => ({ citationLabel })),
  }).ok;
}

const PREFIXES = ["SO", "S.O.", "Standing Order", "Standing Orders", "SOs", "S.O.s"];
const NUMERATORS = ["1", "2", "9", "12", "19", "22", "40", "99", "123"];
const DENOMINATORS = ["1", "2", "3", "4", "5", "9", "12", "34", "99"];
const SEPARATORS = [" ", ", ", " and ", " or ", " & ", " to ", " through ", "-"];
const TAILS = ["1", "2", "9", "12", "99", "2/3", "2/9", "12/3", "12/9", "12/34", "19/5", "22/9", "23/4", "123/4"];
const LABEL_SETS = [
  ["SO 1"],
  ["SO 2"],
  ["SO 12"],
  ["SO 1", "SO 2"],
  ["SO 12", "SO 1"],
  ["2/3"],
  ["SR 2/3"],
  ["SO 1", "2/3"],
];

function gridTexts(): string[] {
  const texts = new Set<string>();
  for (const prefix of PREFIXES) {
    for (const numerator of NUMERATORS) {
      for (const denominator of DENOMINATORS) texts.add(`${prefix} ${numerator}/${denominator}`);
      for (const separator of SEPARATORS) {
        for (const tail of TAILS) texts.add(`${prefix} ${numerator}${separator}${tail}`);
      }
    }
  }
  for (const spelling of ["SO 2/3", "Ruling 2/3", "SR 2/3", "2/3", "Speaker's ruling 2/3"]) texts.add(spelling);
  return [...texts];
}

test("the head flags every provision main flags, except the explicit keeps", (t) => {
  const texts = gridTexts();
  let mainFlagged = 0;
  let kept = 0;
  let headMisses = 0;
  const sample: string[] = [];
  for (const labels of LABEL_SETS) {
    for (const text of texts) {
      if (!mainFlagsMention(text, labels)) continue;
      mainFlagged += 1;
      if (intendedKeep(text, labels)) {
        kept += 1;
        continue;
      }
      if (!headFlags(text, labels)) {
        headMisses += 1;
        if (sample.length < 8) sample.push(`${JSON.stringify(text)} | ${labels.join("+")}`);
      }
    }
  }
  const cells = texts.length * LABEL_SETS.length;
  t.diagnostic(`cells ${cells}; texts ${texts.length}; main flags ${mainFlagged}; allow-listed ${kept}; head misses ${headMisses}`);
  assert.ok(texts.some((text) => /12\/9|22\/9|12\/34|123\/4|19\/5/.test(text)), "grid includes multi-digit rulings");
  assert.equal(cells, 52304);
  assert.equal(texts.length, 6538);
  assert.equal(mainFlagged, 39392);
  assert.equal(kept, 8);
  assert.equal(headMisses, 0, sample.join("\n"));
});

test("frozen main does not flag the six singular joins, and the head does", (t) => {
  const forms = [
    "SO 1 & 99",
    "Standing Order 1 and 99",
    "SO 1, 99",
    "SO 1 or 99",
    "SO 1 to 99",
    "SO 1 through 99",
  ];
  const main = forms.map((form) => mainFlagsMention(form, ["SO 1"]));
  t.diagnostic(`main flags ${forms.filter((_, index) => main[index]).length} of 6: ${main.map((flag, index) => `${forms[index]}=${flag}`).join("; ")}`);
  assert.deepEqual(main, [false, false, false, false, false, false]);
  for (const form of forms) {
    assert.equal(headFlags(form, ["SO 1"]), true, form);
  }
});

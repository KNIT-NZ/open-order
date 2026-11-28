import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { citedSubitemText, corroborateClaimAppeal, sourceLabel } from "../lib/ai/claim-appeal";
import { buildAnswerClaimValidationPrompt } from "../lib/ai/prompts";
import { findOmittedSourceQualifications } from "../lib/ai/qualification-guard";
import {
  applyStructuredHedge,
  assessCitations,
  buildProvisionTree,
  normalizeGrammarText,
  rewriteByGrammar,
  type GrammarAssessment,
} from "../lib/citations/grammar";
import { dropUnreferencedCitationEntries } from "../lib/procedural-mechanisms";
import {
  attachClaimQualifications,
  normalizeAnswerCitationLabels,
  rewriteForbiddenAuthorityMentions,
  validateAnswerCitations,
} from "../lib/procedural-reasoning";

const ACT = "has not been confirmed to govern the specific act asked about.";
const FORUM = "has not been confirmed to be the body the question is about.";
const PLACEHOLDER = "[citation not verified]";

function authorities(labels: string[], content = new Map<string, string>()) {
  return labels.map((citationLabel) => ({ citationLabel, sectionContent: content.get(citationLabel) }));
}

function blankAssessment(): GrammarAssessment {
  return {
    mentions: [],
    brackets: [],
    verdict: "no",
    reasonCode: "served_no_authority",
    ruleCodes: { parts: [], brackets: [], row: "uncited" },
    groundedCpk: [],
    rewriteSpans: [],
    stripSpans: [],
  };
}

function keptOutside(input: string, spans: Array<{ start: number; end: number }>): string {
  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
  let out = "";
  let cursor = 0;
  for (const span of sorted) {
    if (span.end <= cursor) continue;
    const start = Math.max(span.start, cursor);
    out += input.slice(cursor, start);
    cursor = span.end;
  }
  return out + input.slice(cursor);
}

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

test("OO-DEF-129 rewrites only the citation span and keeps later text in order", () => {
  const input = "Under SO 1 and SO 2 the House may sit [SO 1].";
  const assessed = assessCitations(input, authorities(["SO 1", "SO 2"]), { provisionTree: {} });
  const rewritten = rewriteByGrammar(input, assessed);
  assert.equal(rewritten.text, input);
  const prosePlaceholder = `a provision ${PLACEHOLDER}`;
  assert.equal(keptOutside(input, assessed.rewriteSpans).split(prosePlaceholder).join(""), rewritten.text.split(prosePlaceholder).join(""));

  const mixed = "Standing Orders 98 and 99 and SO 97 apply. The House may sit [SO 1].";
  const mixedAssessment = assessCitations(mixed, authorities(["SO 1"]), { provisionTree: {} });
  const mixedOut = rewriteByGrammar(mixed, mixedAssessment);
  assert.equal(mixedOut.text.includes("[SO 1]"), true);
  assert.equal(mixedOut.text.includes("apply. The House may sit"), true);
  assert.equal(/[A-Za-z]a provision/.test(mixedOut.text), false);
  assert.equal(keptOutside(mixed, mixedAssessment.rewriteSpans), mixedOut.text.split(prosePlaceholder).join(""));
});

test("OO-DEF-129 list and range fuzz loses no citation main kept", () => {
  let lost = 0;
  let glued = 0;
  for (let index = 0; index < 5000; index += 1) {
    const rand = rng(index + 1);
    const a = 1 + Math.floor(rand() * 20);
    const b = 1 + Math.floor(rand() * 20);
    const c = 1 + Math.floor(rand() * 20);
    const kept = 1 + Math.floor(rand() * 12);
    const admitted = new Set<number>([kept]);
    if (rand() > 0.4) admitted.add(a);
    if (rand() > 0.4) admitted.add(b);
    if (rand() > 0.5) admitted.add(c);
    const labels = [...admitted].map((number) => ({ citationLabel: `SO ${number}` }));
    const width = 1 + (a % 8);
    const from = Math.min(a, b);
    const forms = [
      `Under SO ${a} and SO ${b} the House may sit [SO ${kept}].`,
      `SOs ${a}, ${b} and ${c} apply [SO ${kept}].`,
      `Standing Orders ${from} to ${from + width} apply [SO ${kept}].`,
      `Members may use SO ${a}, SO ${b} or SO ${c} today [SO ${kept}].`,
    ];
    const input = forms[index % forms.length];
    const main = rewriteForbiddenAuthorityMentions({ answerText: input, authorities: labels });
    const head = rewriteByGrammar(input, assessCitations(input, labels, { provisionTree: {} }));
    for (const match of main.rewrittenText.matchAll(/\[([^\[\]]+)\]/g)) {
      if (!head.text.includes(`[${match[1]}]`)) lost += 1;
    }
    if (/[A-Za-z0-9\]]\[citation not verified\]/.test(head.text)) glued += 1;
    if (/\[citation not verified\][A-Za-z0-9\[]/.test(head.text)) glued += 1;
  }
  console.log(JSON.stringify({ listRangeFuzz: 5000, lostCitations: lost, gluedPlaceholders: glued }));
  assert.equal(lost, 0);
  assert.equal(glued, 0);
});

test("OO-DEF-124 edition year is the title and the following number is checked", () => {
  const input = "Standing Orders 2026 98 applies and the House may sit [SO 1].";
  const assessed = assessCitations(input, authorities(["SO 1"]), { provisionTree: {} });
  assert.equal(assessed.mentions.some((mention) => mention.ref === "SO 98" && mention.status === "ungrounded"), true);
  assert.notEqual(assessed.reasonCode, "served");
  const rewritten = rewriteByGrammar(input, assessed);
  assert.equal(rewritten.text.includes("98"), false);
  assert.equal(rewritten.text.includes("[SO 1]"), true);
});

test("OO-DEF-130 plain ruling words are not citations", () => {
  const input = "The Speaker follows previous rulings [SO 2].";
  const assessed = assessCitations(input, authorities(["SO 2"]), { provisionTree: {} });
  assert.equal(assessed.reasonCode, "served");
  assert.equal(rewriteByGrammar(input, assessed).text, input);
  assert.equal(assessed.mentions.some((mention) => mention.ref === "rulings"), false);
});

test("OO-DEF-131 a label that is both act and forum qualified gets both sentences", () => {
  const input = "What this means:\nThe House may sit [SO 2].";
  const assessed = assessCitations(input, authorities(["SO 2"]), { provisionTree: {} });
  const hedged = applyStructuredHedge(input, assessed, { actLabels: ["SO 2"], forumLabels: ["SO 2"] });
  const claimLine = hedged.split("\n").find((line) => line.includes("The House may sit")) ?? "";
  assert.equal(claimLine.includes(ACT), true);
  assert.equal(claimLine.includes(FORUM), true);
  assert.equal(hedged.includes("Qualification:"), false);
});

test("OO-DEF-131 qualification fuzz loses no sentence main would add", () => {
  let lost = 0;
  for (let index = 0; index < 5000; index += 1) {
    const rand = rng(50_000 + index);
    const label = `SO ${1 + Math.floor(rand() * 40)}`;
    const both = rand() < 0.5;
    const actLabels = both || rand() < 0.5 ? [label] : [];
    const forumLabels = both || actLabels.length === 0 ? [label] : [];
    const heading = ["Bottom line:", "What this means:", "Your options:", "Risks or constraints:"][index % 4];
    const input = `${heading}\nThe House may sit [${label}].`;
    const main = attachClaimQualifications(input, { actLabels, forumLabels });
    const head = applyStructuredHedge(input, assessCitations(input, authorities([label]), { provisionTree: {} }), { actLabels, forumLabels });
    if (main.includes(ACT) && !head.includes(ACT)) lost += 1;
    if (main.includes(FORUM) && !head.includes(FORUM)) lost += 1;
  }
  console.log(JSON.stringify({ qualificationFuzz: 5000, lostQualifications: lost }));
  assert.equal(lost, 0);
});

test("OO-DEF-132 trees match the pinned fixture-tree rows and do not nest continuing letters", () => {
  const pack = JSON.parse(readFileSync(new URL("./fixtures/so-pack.json", import.meta.url), "utf8")) as {
    sections: Array<{ citation_label: string; content: string }>;
  };
  assert.equal(pack.sections.length, 561);
  const byCpk = new Map<string, { citation_label: string; content: string }>();
  let nestedLetters = 0;
  for (const section of pack.sections) {
    const tree = buildProvisionTree(section.citation_label, section.content);
    byCpk.set(buildProvisionTree(section.citation_label, "")[0], section);
    for (const node of tree) {
      const nested = /^(.*)\(([a-z])\)\(([a-z])\)$/.exec(node);
      if (nested && nested[3].charCodeAt(0) === nested[2].charCodeAt(0) + 1) nestedLetters += 1;
    }
  }
  const so7 = buildProvisionTree("SO 7", byCpk.get("SO 7")?.content ?? "");
  assert.equal(so7.includes("SO 7(b)"), true);
  assert.equal(so7.includes("SO 7(a)(b)"), false);
  const so35 = buildProvisionTree("SO 35", byCpk.get("SO 35")?.content ?? "");
  assert.equal(so35.includes("SO 35(2)(c)(ii)"), true);
  assert.equal(so35.includes("SO 35(2)(b)(c)"), false);
  const so3 = buildProvisionTree("SO 3", byCpk.get("SO 3")?.content ?? "");
  assert.equal(so3.includes("SO 3(1)"), true);
  assert.equal(so3.includes("SO 3(1)(a)"), false);
  const rows = readFileSync(new URL("./fixtures/grammar/v1.3/golden-corpus-v1.3.jsonl", import.meta.url), "utf8")
    .trim().split("\n").map((line) => JSON.parse(line) as { tags: string[]; provision_tree: Record<string, string[]> });
  let compared = 0;
  let differences = 0;
  const seen = new Set<string>();
  for (const row of rows) {
    if (!(row.tags ?? []).includes("fixture-tree")) continue;
    for (const [key, expected] of Object.entries(row.provision_tree ?? {})) {
      if (seen.has(key)) continue;
      seen.add(key);
      const section = byCpk.get(key);
      assert.ok(section, key);
      const built = new Set(buildProvisionTree(section.citation_label, section.content));
      const want = new Set([key, ...expected]);
      compared += 1;
      if ([...want].some((node) => !built.has(node)) || [...built].some((node) => !want.has(node))) differences += 1;
    }
  }
  let badInserts = 0;
  const mustHave = ["SO 80(1)(c)", "SO 80(1)(d)", "SO 344(1)(c)", "SO 344(1)(d)", "APP B cl 8(2)(d)"];
  const mustLack = ["SO 80(1)(ba)(c)", "SO 344(1)(ba)(c)", "APP B cl 8(2)(ca)(d)"];
  const builtKeys = new Set<string>();
  for (const section of pack.sections) {
    for (const node of buildProvisionTree(section.citation_label, section.content)) {
      builtKeys.add(node);
      const inserted = /^(.*)\(([a-z])([a-z])\)\(([a-z])\)$/.exec(node);
      if (inserted && inserted[4].charCodeAt(0) === inserted[2].charCodeAt(0) + 1) badInserts += 1;
    }
  }
  console.log(JSON.stringify({ sections: pack.sections.length, nestedLetters, badInserts, fixtureTrees: compared, differences }));
  assert.equal(nestedLetters, 0);
  assert.equal(badInserts, 0);
  assert.equal(differences, 0);
  assert.ok(compared >= 15);
  for (const key of mustHave) assert.equal(builtKeys.has(key), true, key);
  for (const key of mustLack) assert.equal(builtKeys.has(key), false, key);
});

test("OO-DEF-139 residue brackets are ungrounded at citation check", () => {
  for (const sample of ["[ibid]", "[see above]", "[(a)]", "[op. cit.]"]) {
    const assessed = assessCitations(`The House may sit ${sample}.`, authorities(["SO 1"]), { provisionTree: {} });
    assert.equal(assessed.brackets[0]?.class, "ungrounded", sample);
    assert.equal(assessed.reasonCode, "withheld_invalid_citations", sample);
  }
});

test("OO-DEF-135 a false not-retrieved suffix is stripped from an admitted mention", () => {
  const input = "SO 98 applies. Standing Order 99 (referred to in SO 1; not retrieved) lets the Speaker act [SO 99].";
  const assessed = assessCitations(input, authorities(["SO 1", "SO 99"]), { provisionTree: {} });
  const rewritten = rewriteByGrammar(input, assessed);
  assert.equal(rewritten.text.includes("referred to in"), false);
  assert.equal(rewritten.text.includes("Standing Order 99"), true);
  assert.equal(rewritten.text.includes("[SO 99]"), true);
  const strip = [...assessed.stripSpans];
  rewriteByGrammar(input, assessed);
  assert.deepEqual(assessed.stripSpans, strip);
});

test("OO-DEF-138 rewrite does not reorder the caller's spans and slash spacing is one walk", () => {
  const source = readFileSync(new URL("../lib/citations/grammar.ts", import.meta.url), "utf8");
  assert.equal(source.includes("pre-mutation"), false);
  assert.equal(normalizeGrammarText("SO 1 / 2").text, "SO 1/2");
  const spans = [{ start: 8, end: 12 }, { start: 0, end: 2 }];
  const assessed = blankAssessment();
  assessed.stripSpans = spans;
  rewriteByGrammar("0123456789abcdef", assessed);
  assert.deepEqual(spans, [{ start: 8, end: 12 }, { start: 0, end: 2 }]);
});

test("OO-DEF-136 bracket pinpoints reach the parser", () => {
  const normalized = normalizeAnswerCitationLabels({
    answerText: "The House may sit [SO 300(4)].",
    authorities: [{ citationLabel: "SO 300" }],
  });
  assert.equal(normalized, "The House may sit [SO 300(4)].");
  const assessed = assessCitations(normalized, authorities(["SO 300"]), { provisionTree: { "SO 300": ["SO 300(1)", "SO 300(4)"] } });
  assert.equal(assessed.brackets[0]?.class, "ungrounded");
  assert.equal(assessed.reasonCode, "withheld_invalid_citations");
});

test("OO-DEF-137 the authorities list does not receive the hedge", () => {
  const input = [
    "Best authorities to inspect or cite:",
    "- Standing Order 2 [SO 2]",
    "Bottom line:",
    "The House may sit.",
  ].join("\n");
  const hedged = applyStructuredHedge(input, blankAssessment(), { actLabels: ["SO 2"], forumLabels: ["SO 2"] });
  const authorityLine = hedged.split("\n").find((line) => line.includes("Standing Order 2"));
  assert.equal(authorityLine?.includes(ACT), false);
  assert.equal(authorityLine?.includes(FORUM), false);
});

test("OO-DEF-112 an uncertain claim keeps main's hedge", () => {
  const input = "Bottom line:\nThe House may sit [SO 2].";
  const hedged = applyStructuredHedge(input, blankAssessment(), { actLabels: ["SO 2"] });
  assert.equal(hedged.includes(ACT), true);
  const clear = assessCitations(input, authorities(["SO 2"]), { provisionTree: {} });
  assert.equal(applyStructuredHedge(input, clear, {}), input);
});

test("OO-DEF-113 empty answer text throws", () => {
  const assessed = blankAssessment();
  assert.throws(() => applyStructuredHedge("", assessed, {}), TypeError);
  assert.throws(() => applyStructuredHedge(null as unknown as string, assessed, {}), TypeError);
});

test("OO-DEF-141 an unmappable letter pin still runs the omitted-exception veto", () => {
  const sectionContent = [
    "A member must not disclose evidence taken in private—",
    "(a) unless the House authorises it, or",
    "(b) to the Clerk.",
  ].join("\n");
  assert.equal(sourceLabel("SO 5(a)"), "SO 5");
  assert.equal(sourceLabel("SO 5(1)(ab)"), "SO 5");
  assert.equal(sourceLabel("SO 5(1)(a)(i)"), "SO 5");
  const claim = "A member must not disclose evidence taken in private [SO 5(a)].";
  const rejections = findOmittedSourceQualifications({
    claims: [{ id: "claim-1", text: claim, citations: ["SO 5(a)"] }],
    authorities: [{ citationLabel: "SO 5", sectionContent }],
  });
  assert.equal(rejections.length, 1);
  assert.equal(rejections[0]?.claimId, "claim-1");
  const assessed = assessCitations(`Bottom line:\n${claim}`, authorities(["SO 5"], new Map([["SO 5", sectionContent]])));
  assert.equal(assessed.brackets[0]?.class, "grounded");
  const prompt = buildAnswerClaimValidationPrompt({
    claims: [{ id: "claim-1", text: claim, citations: ["SO 5(a)"] }],
    authorities: [{
      citationLabel: "SO 5",
      heading: "Private evidence",
      path: ["SO 5"],
      sectionContent,
    } as never],
  });
  assert.equal(prompt.includes("unless the House authorises it"), true);
  assert.equal(prompt.includes(sectionContent), true);
});

test("OO-DEF-132 a letter after a two-letter insert is that letter, and the inserted nest is not a provision", () => {
  const pack = JSON.parse(readFileSync(new URL("./fixtures/so-pack.json", import.meta.url), "utf8")) as {
    sections: Array<{ citation_label: string; content: string }>;
  };
  const content = new Map(pack.sections.map((section) => [section.citation_label, section.content]));
  const so80 = content.get("SO 80") ?? "";
  const fake = assessCitations("The House may sit [SO 80(1)(ba)(c)].", authorities(["SO 80"], content), {});
  assert.notEqual(fake.reasonCode, "served");
  assert.equal(fake.brackets[0]?.class, "ungrounded");
  const real = assessCitations("The House may sit [SO 80(1)(c)].", authorities(["SO 80"], content), {});
  assert.equal(real.brackets[0]?.class, "grounded");
  assert.equal(real.reasonCode, "served");
  assert.equal(buildProvisionTree("SO 80", so80).includes("SO 80(1)(c)"), true);
  assert.equal(buildProvisionTree("SO 80", so80).includes("SO 80(1)(ba)(c)"), false);
});

test("OO-DEF-142 an appendix pinpoint keeps the parent authorities entry", () => {
  const answer = [
    "Bottom line:",
    "The House may sit [Appendix D cl 1(2)].",
    "",
    "Best authorities to inspect or cite:",
    "- [Appendix D cl 1]",
  ].join("\n");
  const kept = dropUnreferencedCitationEntries(answer);
  assert.equal(kept.text.includes("[Appendix D cl 1]"), true);
  assert.deepEqual(kept.dropped, []);
});

test("OO-DEF-143 placeholders keep the separating space", () => {
  const admitted = authorities(["SO 1"]);
  const rewrite = (input: string) => rewriteByGrammar(input, assessCitations(input, admitted, { provisionTree: {} })).text;
  assert.equal(rewrite("SO 1 et seq. apply [SO 1]."), "a provision [citation not verified] apply [SO 1].");
  assert.equal(rewrite("SR 2/3 to 5 apply [SO 1]."), "a provision [citation not verified] apply [SO 1].");
  assert.equal(rewrite("SO 12 /9 lets the House sit late."), "a provision [citation not verified] lets the House sit late.");
  assert.equal(rewrite("Under SO 12/9 the House may sit late [SO 1]."), "Under a provision [citation not verified] the House may sit late [SO 1].");
  assert.equal(rewrite("SO 1 and 12/9 apply [SO 1]."), "SO 1 and a provision [citation not verified] apply [SO 1].");
  assert.equal(rewrite("Standing Order one hundred and forty-six applies [SO 1].").includes("forty-six"), false);
  assert.equal(/[A-Za-z]a provision|anda provision|SO 1a provision/.test(rewrite("SO 1 et seq. apply [SO 1].")), false);
});

test("OO-DEF-145 an unreadable pin group is residue and is not served", () => {
  const section = "The Speaker may—\n(a) name a member; or\n(b) suspend the sitting.";
  const labels = authorities(["SO 7"], new Map([["SO 7", section]]));
  for (const shape of ["(abcd)", "(abc)", "(xyz)", "(a.)", "( a )", "(-)", "(ⅰ)", "(a1)", "(b)(xyz)", "(-)(iv)", "(z y)", "(e f)", "(a)(z w)", "(abcdefghijklmnop)", "(z y)(b)(ⅰ)", "(see a)", "(as amended)", "(a, b)", "(z, y)", "（abc）"]) {
    const assessed = assessCitations(`The Speaker may name a member [SO 7${shape}].`, labels);
    assert.notEqual(assessed.reasonCode, "served", shape);
    assert.equal(assessed.mentions.some((mention) => mention.status === "ungrounded"), true, shape);
  }
  const pack = JSON.parse(readFileSync(new URL("./fixtures/so-pack.json", import.meta.url), "utf8")) as {
    sections: Array<{ citation_label: string; content: string }>;
  };
  const content = new Map(pack.sections.map((section) => [section.citation_label, section.content]));
  const nested = assessCitations("The House may sit [SO 80(1)(abc)].", authorities(["SO 80"], content));
  assert.notEqual(nested.reasonCode, "served");
});

test("OO-DEF-145 pin-shape fuzz serves no nonexistent label", () => {
  const pack = JSON.parse(readFileSync(new URL("./fixtures/so-pack.json", import.meta.url), "utf8")) as {
    sections: Array<{ citation_label: string; content: string }>;
  };
  const sections = pack.sections.filter((section) => section.citation_label.startsWith("SO ") || / cl \d/.test(section.citation_label));
  const trees = new Map(sections.map((section) => [section.citation_label, new Set(buildProvisionTree(section.citation_label, section.content))]));
  const garbage = ["(abcd)", "(abc)", "(xyz)", "(a.)", "( a )", "(-)", "(ⅰ)", "(a1)", "(z y)", "(e f)", "(abcdefghijklmnop)", "(see a)", "(as amended)", "(a, b)", "(z, y)", "（abc）", "(z y)(b)(ⅰ)"];
  let servedFake = 0;
  const rand = rng(145);
  for (let index = 0; index < 5000; index += 1) {
    const section = sections[Math.floor(rand() * sections.length)];
    const tree = trees.get(section.citation_label) ?? new Set<string>();
    const real = [...tree].filter((key) => key !== section.citation_label);
    const pin = rand() < 0.5 && real.length > 0
      ? real[Math.floor(rand() * real.length)].slice(section.citation_label.length)
      : garbage[Math.floor(rand() * garbage.length)];
    const input = `The House may sit [${section.citation_label}${pin}].`;
    const assessed = assessCitations(input, [{ citationLabel: section.citation_label, sectionContent: section.content }]);
    if (assessed.reasonCode !== "served") continue;
    const shown = assessed.brackets.map((bracket) => bracket.text).join(" ");
    const missing = [...shown.matchAll(/[(\uFF08]([^)\uFF09]*)[)\uFF09]/g)].some((match) => {
      const group = `(${match[1].replace(/\s+/g, "")})`;
      return ![...tree].some((key) => key.includes(group));
    });
    if (missing) servedFake += 1;
  }
  console.log(JSON.stringify({ pinShapeFuzz: 5000, servedFake }));
  assert.equal(servedFake, 0);
});

test("OO-DEF-148 a spaced parenthesis after a label is left intact", () => {
  const section = "The Speaker may—\n(a) name a member; or\n(b) suspend the sitting.";
  const labels = authorities(["SO 7", "SO 1"], new Map([["SO 7", section], ["SO 1", section]]));
  const intact = [
    "Under SO 7 (as amended) the Speaker may name a member [SO 7].",
    "The Speaker may name a member [SO 7 (as amended)].",
    "The Speaker may name a member [SO 7(a) (as amended)].",
    "The Speaker may name a member [SO 7 (emphasis added)].",
    "Under SO 7 (see note) the Speaker may name a member [SO 7].",
  ];
  for (const input of intact) {
    const assessed = assessCitations(input, labels);
    const rewritten = rewriteByGrammar(input, assessed);
    assert.equal(assessed.reasonCode, "served", input);
    assert.equal(rewritten.text, input, input);
  }
  const parenthetical = "Under SO 1 (and SO 99) the House may sit [SO 1].";
  const parentheticalOut = rewriteByGrammar(parenthetical, assessCitations(parenthetical, labels)).text;
  assert.equal(parentheticalOut, "Under SO 1 (and a provision [citation not verified]) the House may sit [SO 1].");
  const attached = "The Speaker may name a member [SO 7(as amended)].";
  assert.notEqual(assessCitations(attached, labels).reasonCode, "served");
  const prose = "Under SO 7(as amended) the Speaker may name a member [SO 7].";
  const proseOut = rewriteByGrammar(prose, assessCitations(prose, labels)).text;
  assert.equal(proseOut, "Under SO 7 a provision [citation not verified] the Speaker may name a member [SO 7].");
  assert.equal(/[A-Za-z0-9\]]\[citation not verified\]/.test(proseOut), false);
  assert.equal(proseOut.includes("SO 7 "), true);
});

test("C1 a letter range is grounded only when both endpoints exist and are in order", () => {
  const section = "(a) alpha duty of the member\n(b) beta duty of the member\n(c) gamma duty of the member";
  const labels = authorities(["SO 7"], new Map([["SO 7", section]]));
  const nested = "(2) the member must—\n(a) speak once\n(b) sit down\n(c) leave the chamber";
  const deep = authorities(["SO 7"], new Map([["SO 7", nested]]));
  const grounded = assessCitations("The member has those duties [SO 7(a) to (c)].", labels);
  assert.equal(grounded.reasonCode, "served");
  assert.equal(grounded.mentions.some((mention) => mention.status === "grounded" && mention.cpk === "SO 7(a)"), true);
  for (const input of ["[SO 7(a) to (z)]", "[SO 7(c) to (a)]", "[SO 7(a)–(z)]"]) {
    const assessed = assessCitations(`The member has those duties ${input}.`, labels);
    assert.notEqual(assessed.reasonCode, "served", input);
    assert.equal(assessed.mentions.some((mention) => mention.status === "ungrounded"), true, input);
  }
  const phantom = assessCitations("The member must speak [SO 7(2)(a)–(z)].", deep);
  assert.notEqual(phantom.reasonCode, "served");
  assert.equal(phantom.mentions.some((mention) => mention.cpk === "SO 7(2)(z)" || mention.status === "ungrounded"), true);
});

test("C3 a pin number range is grounded only when both endpoints exist in order", () => {
  const section = "(1) first duty of the Speaker\n(2) second duty of the Speaker";
  const labels = authorities(["SO 7"], new Map([["SO 7", section]]));
  const served = assessCitations("Both duties apply [SO 7(1) to (2)].", labels);
  assert.equal(served.reasonCode, "served");
  const dashed = assessCitations("Both duties apply [SO 7(1)–(2)].", labels);
  assert.equal(dashed.reasonCode, "served");
  const missing = assessCitations("Both duties apply [SO 7(1) to (9)].", labels);
  assert.notEqual(missing.reasonCode, "served");
  const reversed = assessCitations("Both duties apply [SO 7(2) to (1)].", labels);
  assert.notEqual(reversed.reasonCode, "served");
  assert.equal(reversed.mentions.some((mention) => mention.code === "ungrounded-range"), true);
});

test("C2 the guard and the legacy validator accept forms the grammar grounds", () => {
  const section = "(1) first duty of the Speaker\n(2) second duty of the Speaker";
  const claims = [
    { id: "join", text: "A member must sit [SO 7(1) and (2)].", citations: ["SO 7(1) and (2)"] },
    { id: "long", text: "A member must sit [Standing Order 7(1)].", citations: ["Standing Order 7(1)"] },
  ];
  const rejected = findOmittedSourceQualifications({
    claims,
    authorities: [{ citationLabel: "SO 7", sectionContent: section }],
  });
  assert.deepEqual(rejected, []);
  assert.equal(sourceLabel("SO 7(1) and (2)"), "SO 7");
  assert.equal(sourceLabel("Standing Order 7(1)"), "SO 7");
  assert.equal(sourceLabel("SO 5(abcde)"), "SO 5(abcde)");
  const legacy = validateAnswerCitations({
    answerText: "The House may sit [SO 7(1) and (2)]. Also [Standing Order 7(1)].",
    authorities: [{ citationLabel: "SO 7" }],
  });
  assert.deepEqual(legacy, { ok: true });
});

test("OO-DEF-153 a group or edition after a range endpoint is not swallowed", () => {
  const section = "(1) first duty of the Speaker\n(2) second duty of the Speaker\n(a) alpha duty\n(b) beta duty\n(c) gamma duty";
  const labels = authorities(["SO 7"], new Map([["SO 7", section]]));
  for (const input of ["[SO 7(1)–(2)(c)]", "[SO 7(1) to (2)(z)]", "[SO 7(1)–(2)(abc)]", "[SO 7(1)–(2) (2023)]", "[SO 7(1)–(2), 2023 edition]"]) {
    const assessed = assessCitations(`The House may sit ${input}.`, labels);
    assert.notEqual(assessed.reasonCode, "served", input);
    assert.equal(assessed.mentions.some((mention) => mention.status === "ungrounded"), true, input);
  }
  const current = assessCitations("The House may sit [SO 7(1)–(2) (2026 edition)].", labels);
  assert.equal(current.reasonCode, "served");
});

test("OO-DEF-155 appendix ranges use the same endpoint checks", () => {
  const letters = "(1) the member must—\n(a) speak once in the House\n(b) sit down after speaking\n(c) leave the chamber afterwards";
  const romans = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix"].map((token) => `(${token}) roman duty ${token} of the member`).join("\n");
  const letterLabels = authorities(["Appendix B cl 1"], new Map([["Appendix B cl 1", letters]]));
  const romanLabels = authorities(["Appendix B cl 1"], new Map([["Appendix B cl 1", romans]]));
  const phantom = assessCitations("The member must speak [Appendix B cl 1(1)(a)–(z)].", letterLabels);
  assert.notEqual(phantom.reasonCode, "served");
  const ordered = assessCitations("The member must speak [Appendix B cl 1(1)(a) to (c)].", letterLabels);
  assert.equal(ordered.reasonCode, "served");
  const reversed = assessCitations("The member must speak [Appendix B cl 1(iv)–(i)].", romanLabels);
  assert.notEqual(reversed.reasonCode, "served");
  assert.equal(reversed.mentions.some((mention) => mention.code === "ungrounded-range"), true);
  const forward = assessCitations("The member must speak [Appendix B cl 1(v) to (ix)].", romanLabels);
  assert.equal(forward.reasonCode, "served");
  const romanReversed = assessCitations("The member must speak [Appendix B cl 1(ix)–(v)].", romanLabels);
  assert.notEqual(romanReversed.reasonCode, "served");
  const current = assessCitations("The House may sit [Appendix B cl 1 (2026 edition)].", letterLabels);
  assert.equal(current.reasonCode, "served");
  const old = assessCitations("The House may sit [Appendix B cl 1 (2023 edition)].", letterLabels);
  assert.notEqual(old.reasonCode, "served");
});

test("OO-DEF-153 range fuzz serves no trailing or phantom label", () => {
  const pack = JSON.parse(readFileSync(new URL("./fixtures/so-pack.json", import.meta.url), "utf8")) as {
    sections: Array<{ citation_label: string; content: string }>;
  };
  const sections = pack.sections.filter((section) => section.citation_label.startsWith("SO ") || / cl \d/.test(section.citation_label));
  const separators = ["-", "–", "—", " to ", " through "];
  const badTails = ["(z)", "(abc)", " (2023)", ", 2023 edition"];
  let servedBad = 0;
  let checked = 0;
  for (const section of sections) {
    const tree = buildProvisionTree(section.citation_label, section.content);
    if (tree.length === 0) continue;
    const root = tree.reduce((best, key) => (key.length < best.length ? key : best));
    const byParent = new Map<string, string[]>();
    for (const key of tree) {
      if (key === root) continue;
      const parent = key.replace(/\([^()]*\)$/, "");
      const list = byParent.get(parent) ?? [];
      list.push(key);
      byParent.set(parent, list);
    }
    const suffix = (key: string) => key.slice(root.length);
    for (const children of byParent.values()) {
      if (children.length < 1) continue;
      const start = children[0];
      const realEnd = children[Math.min(1, children.length - 1)];
      const forms = separators.flatMap((separator) => badTails.map((tail) => `${suffix(start)}${separator}${suffix(realEnd)}${tail}`));
      if (start !== realEnd) forms.push(`${suffix(realEnd)} to ${suffix(start)}`);
      for (const form of forms) {
        checked += 1;
        const input = `The House may sit [${section.citation_label}${form}].`;
        const assessed = assessCitations(input, [{ citationLabel: section.citation_label, sectionContent: section.content }], {
          provisionTree: { [section.citation_label]: tree },
        });
        const reversed = start !== realEnd && form.startsWith(suffix(realEnd));
        if (reversed && suffix(start).startsWith(suffix(realEnd))) continue;
        if (assessed.reasonCode === "served") servedBad += 1;
      }
    }
  }
  console.log(JSON.stringify({ rangeFuzzChecked: checked, servedBad }));
  assert.equal(servedBad, 0);
});

test("G2 a qualification named in another sentence does not cover the cited sentence", () => {
  const section = "(1) A member must not interrupt another member who is speaking unless the Speaker has given leave.";
  const admitted = [{ citationLabel: "SO 80", sectionContent: section }, { citationLabel: "SO 7", sectionContent: "The Speaker may act." }];
  const drops = [
    "The Speaker may act [SO 7]. A member must not interrupt another member who is speaking [SO 80].",
    "A member must not interrupt another member who is speaking [SO 80]. The Speaker may act [SO 7].",
    "The Speaker has given leave elsewhere. A member must not interrupt another member who is speaking [SO 80].",
    "A member must not interrupt another member who is speaking [SO 80]. The Speaker has given leave for a different matter.",
    "Unless the Speaker has given leave, the House may sit. A member must not interrupt another member who is speaking [SO 80].",
    "A member must not interrupt another member who is speaking. The Speaker has given leave [SO 80].",
    "The Speaker may act [SO 7]. A member must not interrupt another member who is speaking [SO 80, 2026 edition].",
    "The Speaker may act [SO 7]. A member must not interrupt another member who is speaking [SO 80 (2026 edition)].",
    "The Speaker may act [SO 7]. A member must not interrupt another member who is speaking [SO 80(1)].",
    "The Speaker may act. A member must not interrupt another member who is speaking [SO 80].",
    "A member must not interrupt another member who is speaking [SO 80]. Debate then continues.",
    "The Speaker may act [SO 7]. A member must not interrupt another member who is speaking [SO 80 and SO 7].",
    "Leave was discussed earlier. A member must not interrupt another member who is speaking [SO 80].",
    "The Speaker may act [SO 7]. A member must not interrupt another member who is speaking [Standing Order 80].",
    "A member must not interrupt another member who is speaking [SO 80]. The Speaker may act [SO 7]. A further point follows.",
    "The Speaker has given leave [SO 7]. A member must not interrupt another member who is speaking [SO 80].",
    "A member must not interrupt another member who is speaking [SO 80]. Unless the Speaker has given leave, something else applies.",
    "The Speaker may act [SO 7]. A member must not interrupt another member who is speaking [SO 80(1) and (2)].",
    "Previously the Speaker acted. A member must not interrupt another member who is speaking [SO 80].",
    "A member must not interrupt another member who is speaking [SO 80]. The Speaker may act.",
    "The Speaker may act [SO 7]. A member must not interrupt another member who is speaking [S.O. 80].",
    "The Speaker may act [SO 7]. A member must not interrupt another member who is speaking [SO 80 (2026 edn)].",
    "The Speaker may act [SO 7]. A member must not interrupt another member who is speaking [SO 80 (2026 revision)].",
    "A member must sit [SO 7]. A member must not interrupt another member who is speaking [SO 80].",
  ];
  let servedDrops = 0;
  for (const text of drops) {
    const rejected = findOmittedSourceQualifications({
      claims: [{ id: "drop", text, citations: [...text.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1]) }],
      authorities: admitted,
    });
    if (rejected.length === 0) servedDrops += 1;
  }
  const faithful = [
    "A member must not interrupt another member who is speaking unless the Speaker has given leave [SO 80].",
    "A member must not interrupt another member who is speaking unless the Speaker has given leave [SO 80]. The House may then proceed.",
    "The Speaker may act [SO 7]. A member must not interrupt another member who is speaking unless the Speaker has given leave [SO 80].",
    "A member must not interrupt another member who is speaking unless the Speaker has given leave [SO 80, 2026 edition].",
  ];
  const nextSentence = [
    "A member must not interrupt another member who is speaking [SO 80]. However, the Speaker may give leave for an interruption [SO 80].",
    "A member must not interrupt another member who is speaking [SO 80]. But the Speaker may give leave for an interruption [SO 80].",
    "A member must not interrupt another member who is speaking [SO 80]. That said, the Speaker may give leave for an interruption [SO 80].",
    "A member must not interrupt another member who is speaking [SO 80]. Unless the Speaker has given leave for an interruption [SO 80].",
    "A member must not interrupt another member who is speaking [SO 80]. Except where the Speaker gives leave for an interruption [SO 80].",
    "A member must not interrupt another member who is speaking [SO 80]. The exception is where the Speaker gives leave for an interruption [SO 80].",
    "A member must not interrupt another member who is speaking [SO 80]. That rule does not apply where the Speaker has given leave [SO 80].",
    "However, the Speaker may give leave for an interruption [SO 80]. A member must not interrupt another member who is speaking [SO 80].",
    "A member must not interrupt another member who is speaking [SO 80]. However, the Speaker may give leave for an interruption.",
    "However, the Speaker may give leave for an interruption. A member must not interrupt another member who is speaking [SO 80].",
    "A member must not interrupt another member who is speaking [SO 80]. But the Speaker may give leave.",
    "The exception is where the Speaker gives leave. A member must not interrupt another member who is speaking [SO 80].",
  ];
  const lookalikes = [
    "The Speaker has given leave for many things [SO 7]. A member must not interrupt another member who is speaking [SO 80].",
    "The Speaker has given leave elsewhere. A member must not interrupt another member who is speaking [SO 80].",
    "The Speaker has given leave for a different matter. A member must not interrupt another member who is speaking [SO 80].",
    "Unless the Speaker has given leave, the House may sit. A member must not interrupt another member who is speaking [SO 80].",
    "The Speaker may act [SO 7]. A member must not interrupt another member who is speaking [SO 80].",
    "A member must not interrupt another member who is speaking [SO 80]. The Speaker may act [SO 7].",
    "The Speaker has given leave for other matters [SO 7]. A member must not interrupt another member who is speaking [SO 80].",
    "A member must not interrupt another member who is speaking [SO 80]. The House may sit if the Speaker has given leave for many things.",
    "Leave was discussed earlier. A member must not interrupt another member who is speaking [SO 80].",
    "The Speaker may act. A member must not interrupt another member who is speaking [SO 80].",
    "A member must not interrupt another member who is speaking [SO 80]. Debate then continues.",
    "Previously the Speaker acted. A member must not interrupt another member who is speaking [SO 80].",
    "The Speaker has given leave [SO 7]. Something else happens. A member must not interrupt another member who is speaking [SO 80].",
    "However, the Speaker may give leave for an interruption [SO 80]. The House may sit. A member must not interrupt another member who is speaking [SO 80].",
    "A member must not interrupt another member who is speaking [SO 80]. The Speaker has given leave for many things [SO 7].",
    "But the House may sit. A member must not interrupt another member who is speaking [SO 80].",
    "The Speaker has given leave for an unrelated matter. A member must not interrupt another member who is speaking [SO 80].",
    "A member must sit [SO 7]. A member must not interrupt another member who is speaking [SO 80].",
    "That said, the House may sit. A member must not interrupt another member who is speaking [SO 80].",
    "The exception is where the House may sit. A member must not interrupt another member who is speaking [SO 80].",
  ];
  const score = (rows: string[]) => rows.filter((text) => findOmittedSourceQualifications({
    claims: [{ id: "row", text, citations: [...text.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1]) }],
    authorities: admitted,
  }).length === 0).length;
  const servedFaithful = score(faithful);
  const servedNext = score(nextSentence);
  const servedLookalikes = score(lookalikes);
  console.log(JSON.stringify({
    qualificationDrops: drops.length,
    servedDrops,
    faithful: faithful.length,
    servedFaithful,
    nextSentence: nextSentence.length,
    servedNext,
    lookalikes: lookalikes.length,
    servedLookalikes,
  }));
  assert.equal(drops.length, 24);
  assert.equal(servedDrops, 0);
  assert.equal(servedFaithful, faithful.length);
  assert.equal(nextSentence.length, 12);
  assert.equal(servedNext, nextSentence.length);
  assert.equal(lookalikes.length, 20);
  assert.equal(servedLookalikes, 0);
});

test("OO-DEF-164 a joined citation is kept only when every label passes", () => {
  const restricted = "(1) A member must not interrupt another member who is speaking unless the Speaker has given leave.";
  const plain = "The House may sit.";
  const authoritiesForGuard = [
    { citationLabel: "SO 80", sectionContent: restricted },
    { citationLabel: "SO 7", sectionContent: plain },
    { citationLabel: "SO 1", sectionContent: plain },
    { citationLabel: "SO 2", sectionContent: plain },
    { citationLabel: "SO 3", sectionContent: plain },
  ];
  const faithful = "A member must not interrupt another member who is speaking unless the Speaker has given leave [SO 80 and SO 7].";
  const omitted = "A member must not interrupt another member who is speaking [SO 80 and SO 7].";
  const kept = findOmittedSourceQualifications({
    claims: [{ id: "keep", text: faithful, citations: ["SO 80 and SO 7"] }],
    authorities: authoritiesForGuard,
  });
  assert.deepEqual(kept, []);
  const cut = findOmittedSourceQualifications({
    claims: [{ id: "cut", text: omitted, citations: ["SO 80 and SO 7"] }],
    authorities: authoritiesForGuard,
  });
  assert.equal(cut.length, 1);
  const range = findOmittedSourceQualifications({
    claims: [{ id: "range", text: "A member must attend [SO 1 to 3].", citations: ["SO 1 to 3"] }],
    authorities: authoritiesForGuard,
  });
  assert.deepEqual(range, []);
  const bare = findOmittedSourceQualifications({
    claims: [{ id: "bare", text: "A member must not interrupt another member who is speaking [SO 1 and 80].", citations: ["SO 1 and 80"] }],
    authorities: authoritiesForGuard,
  });
  assert.equal(bare.length, 1);
});

test("OO-DEF-159 letters stay alphabetical unless the sibling list is roman", () => {
  const letters = "abcdefghijklmnopqrstuvwx".split("").map((letter) => `(${letter}) letter ${letter} duty of the member`).join("\n");
  const labels = authorities(["SO 418"], new Map([["SO 418", letters]]));
  const served = ["(c)–(i)", "(c)–(l)", "(c)–(v)", "(c)–(x)", "(d)–(i)", "(l)–(v)", "(l)–(x)"];
  const withheld = ["(i)–(c)", "(i)–(d)", "(l)–(c)", "(v)–(c)", "(v)–(l)", "(x)–(c)", "(x)–(l)"];
  for (const pins of served) {
    const assessed = assessCitations(`The member has that duty [SO 418${pins}].`, labels);
    assert.equal(assessed.reasonCode, "served", pins);
  }
  for (const pins of withheld) {
    const assessed = assessCitations(`The member has that duty [SO 418${pins}].`, labels);
    assert.notEqual(assessed.reasonCode, "served", pins);
    assert.equal(assessed.mentions.some((mention) => mention.code === "ungrounded-range"), true, pins);
  }
  const romans = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix"].map((token) => `(${token}) roman duty ${token}`).join("\n");
  const romanLabels = authorities(["SO 418"], new Map([["SO 418", romans]]));
  const inserted = assessCitations("The member has that duty [SO 7(c)–(i)].", [{ citationLabel: "SO 7", sectionContent: "(c) one" }], {
    provisionTree: { "SO 7": ["SO 7", "SO 7(c)", "SO 7(i)", "SO 7(ii)"] },
  });
  assert.equal(inserted.reasonCode, "served");
  const insertedBack = assessCitations("The member has that duty [SO 7(i)–(c)].", [{ citationLabel: "SO 7", sectionContent: "(c) one" }], {
    provisionTree: { "SO 7": ["SO 7", "SO 7(c)", "SO 7(i)", "SO 7(ii)"] },
  });
  assert.notEqual(insertedBack.reasonCode, "served");
  assert.equal(assessCitations("The member has that duty [SO 418(v)–(ix)].", romanLabels).reasonCode, "served");
  const backward = assessCitations("The member has that duty [SO 418(ix)–(v)].", romanLabels);
  assert.notEqual(backward.reasonCode, "served");
  assert.equal(backward.mentions.some((mention) => mention.code === "ungrounded-range"), true);
});

test("OO-DEF-158 a current edition still maps, and an unmapped citation is vetoed", () => {
  const section = "(1) A member must not disclose classified material unless the committee consents in writing.";
  const authoritiesForGuard = [{ citationLabel: "SO 80", sectionContent: section }, { citationLabel: "Appendix B cl 1", sectionContent: section }];
  for (const citation of ["SO 80, 2026 edition", "SO 80 , 2026 edition", "SO 80,2026 edition", "SO 80, 2026 Edition", "Appendix B cl 1, 2026 edition", "SO 80 (2026 edition)"]) {
    assert.equal(sourceLabel(citation).replace(/\s+/g, " "), citation.startsWith("Appendix") ? "Appendix B cl 1" : "SO 80", citation);
  }
  const omitted = findOmittedSourceQualifications({
    claims: [{ id: "omit", text: "A member must not disclose classified material [SO 80, 2026 edition].", citations: ["SO 80, 2026 edition"] }],
    authorities: authoritiesForGuard,
  });
  assert.equal(omitted.length, 1);
  assert.equal(omitted[0]?.reason.includes("could not be mapped"), false);
  const kept = findOmittedSourceQualifications({
    claims: [{ id: "keep", text: "A member must not disclose classified material unless the committee consents in writing [SO 80, 2026 edition].", citations: ["SO 80, 2026 edition"] }],
    authorities: authoritiesForGuard,
  });
  assert.deepEqual(kept, []);
  const two = findOmittedSourceQualifications({
    claims: [{ id: "two", text: "A member must not disclose classified material unless the committee consents in writing [SO 80 and SO 7].", citations: ["SO 80 and SO 7"] }],
    authorities: authoritiesForGuard,
  });
  assert.equal(two.length, 1);
  assert.equal(two[0]?.reason.includes("could not be mapped"), true);
});

test("a revoked or ambiguous range endpoint keeps its own reason", () => {
  const revoked = assessCitations("The House may sit [SO 300(3)–(4)].", [{ citationLabel: "SO 300", sectionContent: "(3) one\n(4) two" }], {
    provisionTree: { "SO 300": ["SO 300", "SO 300(3)", "SO 300(4)"] },
  });
  assert.equal(revoked.mentions.some((mention) => mention.code === "ungrounded-revoked"), true);
  const ambiguous = assessCitations("The House may sit [SO 3(1)(a)–(b)].", [{ citationLabel: "SO 3", sectionContent: "(1) one" }], {
    provisionTree: { "SO 3": ["SO 3", "SO 3(1)"] },
  });
  assert.equal(ambiguous.mentions.some((mention) => mention.code === "ambiguous-tree"), true);
});

test("OO-DEF-156 a long-form appeal keeps the pin", () => {
  const section = "(1) first duty of the Speaker in the chamber\n(2) second duty of the Speaker outside";
  const claim = {
    id: "claim-1",
    text: "The Speaker has the first duty [Standing Order 7(1)].",
    citations: ["Standing Order 7(1)"],
    lineIndex: 1,
  };
  const authoritiesForAppeal = [{ citationLabel: "SO 7", sectionContent: section }];
  const outside = corroborateClaimAppeal({
    claim,
    verdict: {
      id: "claim-1",
      supported: true,
      reason: "The cited sub-item states the duty.",
      witnesses: [{ citationLabel: "Standing Order 7(1)", exactQuote: "second duty of the Speaker outside" }],
    },
    authorities: authoritiesForAppeal,
  });
  assert.equal(outside.accepted, false);
  const inside = corroborateClaimAppeal({
    claim,
    verdict: {
      id: "claim-1",
      supported: true,
      reason: "The cited sub-item states the duty.",
      witnesses: [{ citationLabel: "Standing Order 7(1)", exactQuote: "first duty of the Speaker in the chamber" }],
    },
    authorities: authoritiesForAppeal,
  });
  assert.equal(inside.accepted, true);
});

test("OO-DEF-149 a current edition phrase is not a withhold and a superseded year is", () => {
  const labels = authorities(["SO 7"], new Map([["SO 7", "(1) first duty"]]));
  for (const input of ["[SO 7 (2026 edition)]", "[SO 7, 2026 edition]", "[SO 7(2026 edition)]", "[SO 7 (2026 edn)]", "[SO 7 (2026 revision)]"]) {
    const assessed = assessCitations(`The House may sit ${input}.`, labels);
    assert.equal(assessed.reasonCode, "served", input);
    assert.equal(assessed.brackets[0]?.class, "grounded", input);
  }
  const comma = assessCitations("The House may sit [SO 7, 2026 edition].", labels);
  assert.equal(comma.reasonCode, "served");
  const legacy = validateAnswerCitations({
    answerText: "The House may sit [SO 7, 2026 edition].",
    authorities: [{ citationLabel: "SO 7" }],
  });
  assert.deepEqual(legacy, { ok: true });
  for (const input of ["[SO 7 (2023)]", "[SO 7 (2023 edition)]", "[SO 7, 2023 edition]"]) {
    const assessed = assessCitations(`The House may sit ${input}.`, labels);
    assert.notEqual(assessed.reasonCode, "served", input);
    assert.equal(assessed.mentions.some((mention) => mention.code === "ungrounded-edition"), true, input);
  }
});

test("OO-DEF-146 a quote from another sub-item does not corroborate the cited pin", () => {
  const section = [
    "The Speaker may—",
    "(a) name a member who has been disorderly in the chamber; or",
    "(b) suspend the sitting until the House is ready to proceed.",
  ].join("\n");
  const claim = {
    id: "claim-1",
    text: "The Speaker may suspend the sitting [SO 7(b)].",
    citations: ["SO 7(b)"],
    lineIndex: 1,
  };
  const verdict = {
    id: "claim-1",
    supported: true,
    reason: "The cited sub-item allows the Speaker to act.",
    witnesses: [{ citationLabel: "SO 7", exactQuote: "name a member who has been disorderly" }],
  };
  const authorities = [{ citationLabel: "SO 7", sectionContent: section }];
  assert.equal(citedSubitemText(section, "SO 7(b)")?.includes("suspend the sitting"), true);
  assert.equal(citedSubitemText(section, "SO 7(b)")?.includes("name a member"), false);
  const wrong = corroborateClaimAppeal({ claim, verdict, authorities });
  assert.equal(wrong.accepted, false);
  const right = corroborateClaimAppeal({
    claim,
    verdict: { ...verdict, witnesses: [{ citationLabel: "SO 7(b)", exactQuote: "suspend the sitting until the House" }] },
    authorities,
  });
  assert.equal(right.accepted, true);
});

test("OO-DEF-147 letter pins slice at the next letter, and Appendix B cl 5(1)(i) is the letter", () => {
  const pack = JSON.parse(readFileSync(new URL("./fixtures/so-pack.json", import.meta.url), "utf8")) as {
    sections: Array<{ citation_label: string; content: string }>;
  };
  const content = new Map(pack.sections.map((section) => [section.citation_label, section.content]));
  const checks: Array<[string, string, string]> = [
    ["SO 190(h)", "(h) reports of Officers of Parliament", "(i)"],
    ["SO 327(2)(ha)", "(ha) was not published", "(i)"],
    ["SO 406(1)(h)", "(h) a statement setting out the consultations", "(i)"],
    ["SO 418(h)", "(h) as a member, knowingly providing false", "(i)"],
    ["SO 418(u)", "(u) intimidating, preventing, or hindering", "(v)"],
    ["SO 418(w)", "(w) assaulting, threatening, or disadvantaging", "(x)"],
    ["Appendix B cl 5(1)(h)", "(h) the name of each retirement scheme", "(i) the name of each managed"],
    ["Appendix C cl 4(2)(h)", "(h) if the bill affects a charitable trust", "(i)"],
  ];
  for (const [pin, own, sibling] of checks) {
    const parent = pin.replace(/\(.*$/, "");
    const region = citedSubitemText(content.get(parent) ?? "", pin) ?? "";
    assert.equal(region.includes(own), true, pin);
    assert.equal(region.includes(sibling), false, pin);
  }
  const appendix = content.get("Appendix B cl 5") ?? "";
  const letter = citedSubitemText(appendix, "Appendix B cl 5(1)(i)") ?? "";
  const roman = citedSubitemText(appendix, "Appendix B cl 5(1)(d)(i)") ?? "";
  assert.equal(letter.includes("managed investment scheme"), true);
  assert.equal(letter.includes(roman.slice(0, 40)), false);
  assert.equal(roman.includes("ought reasonably to know"), true);
});

test("OO-DEF-144 pin regions match the tree snapshot", () => {
  const pack = JSON.parse(readFileSync(new URL("./fixtures/so-pack.json", import.meta.url), "utf8")) as {
    sections: Array<{ citation_label: string; content: string }>;
  };
  const snapshot = JSON.parse(readFileSync(new URL("./fixtures/pin-regions.json", import.meta.url), "utf8")) as Record<string, string>;
  const built: Record<string, string> = {};
  for (const section of pack.sections) {
    const tree = buildProvisionTree(section.citation_label, section.content);
    if (tree.length === 0) continue;
    const root = tree.reduce((best, key) => (key.length < best.length ? key : best));
    for (const node of tree) {
      if (node === root) continue;
      const citation = `${section.citation_label}${node.slice(root.length)}`;
      built[citation] = (citedSubitemText(section.content, citation) ?? "").replace(/\s+/g, " ").trim();
    }
  }
  assert.deepEqual(built, snapshot);
});

test("OO-DEF-144 an unmappable pin on a categorical claim is rejected", () => {
  const rejections = findOmittedSourceQualifications({
    claims: [{
      id: "claim-1",
      text: "A member must not disclose evidence taken in private [SO 5(abcde)].",
      citations: ["SO 5(abcde)"],
    }, {
      id: "claim-2",
      text: "A member must not disclose evidence taken in private [SO 5(a.)].",
      citations: ["SO 5(a.)"],
    }],
    authorities: [{
      citationLabel: "SO 5",
      sectionContent: "A member must not disclose evidence taken in private unless the House authorises the disclosure.",
    }],
  });
  assert.deepEqual(rejections.map((item) => item.claimId), ["claim-1", "claim-2"]);
  assert.equal(rejections.every((item) => item.reason.includes("could not be mapped")), true);
});

test("OO-DEF-132 every section pin set matches the committed build", () => {
  const pack = JSON.parse(readFileSync(new URL("./fixtures/so-pack.json", import.meta.url), "utf8")) as {
    sections: Array<{ citation_label: string; content: string }>;
  };
  const expected = JSON.parse(readFileSync(new URL("./fixtures/provision-trees.json", import.meta.url), "utf8")) as Record<string, string[]>;
  assert.equal(pack.sections.length, 561);
  assert.equal(Object.keys(expected).length, 561);
  let differences = 0;
  for (const section of pack.sections) {
    const built = buildProvisionTree(section.citation_label, section.content);
    const want = expected[section.citation_label];
    if (!want || built.join("\n") !== want.join("\n")) differences += 1;
  }
  assert.equal(differences, 0);
});

test("OO-DEF-134 an admitted cf see or also cross-reference stays a citation", () => {
  for (const input of ["The House may sit [SO 1 (cf. SO 2)].", "The House may sit [SO 1 (see SO 2)].", "The House may sit [SO 1 (also SO 2)]."]) {
    const assessed = assessCitations(input, authorities(["SO 1", "SO 2"]), { provisionTree: {} });
    assert.equal(assessed.brackets[0]?.class, "grounded", input);
    assert.equal(assessed.reasonCode, "served", input);
  }
  const missing = assessCitations("The House may sit [SO 1 (cf. SO 99)].", authorities(["SO 1"]), { provisionTree: {} });
  assert.equal(missing.brackets[0]?.class, "partial");
});

test("multi-citation prose is not worse than main", () => {
  const pack = JSON.parse(readFileSync(new URL("./fixtures/so-pack.json", import.meta.url), "utf8")) as {
    sections: Array<{ citation_label: string; content: string }>;
  };
  const content = new Map(pack.sections.map((section) => [section.citation_label, section.content]));
  const cases: Array<{ id: string; input: string; labels: string[]; act?: string[]; forum?: string[] }> = [
    { id: "list-and", input: "Bottom line:\nUnder SO 1 and SO 2 the House may sit [SO 1].", labels: ["SO 1", "SO 2"] },
    { id: "list-comma", input: "Bottom line:\nSOs 1, 2 and 3 apply [SO 1].", labels: ["SO 1", "SO 2", "SO 3"] },
    { id: "range", input: "Bottom line:\nStanding Orders 124 to 131 apply [SO 124].", labels: ["SO 124", "SO 125", "SO 126", "SO 127", "SO 128", "SO 129", "SO 130", "SO 131"] },
    { id: "edition", input: "Bottom line:\nStanding Orders 2026 98 applies and the House may sit [SO 1].", labels: ["SO 1"] },
    { id: "ruling-word", input: "Bottom line:\nThe Speaker follows previous rulings [SO 2].", labels: ["SO 2"] },
    { id: "quantity-days", input: "Bottom line:\nUnder SO 1 to 3 days notice is needed [SO 1].", labels: ["SO 1"] },
    { id: "quantity-percent", input: "Bottom line:\nUnder SO 1 and 50% of members [SO 1].", labels: ["SO 1"] },
    { id: "bracket-xref", input: "Bottom line:\nThe House may sit [SO 1 (SO 99)].", labels: ["SO 1", "SO 99"] },
    { id: "residue-ibid", input: "Bottom line:\nThe House may sit [SO 1]. It may also adjourn [ibid].", labels: ["SO 1"] },
    { id: "dual-qualified", input: "What this means:\nThe House may sit [SO 2].", labels: ["SO 2"], act: ["SO 2"], forum: ["SO 2"] },
    { id: "letter-pin", input: "Bottom line:\nUnder Standing Order 7(b) a member may speak [SO 7].", labels: ["SO 7"] },
    { id: "suffix", input: "Bottom line:\nStanding Order 99 (referred to in SO 1; not retrieved) lets the Speaker act [SO 99].", labels: ["SO 1", "SO 99"] },
  ];
  const byClass: Record<string, string[]> = {};
  for (const item of cases) {
    const payload = authorities(item.labels, content);
    const actLabels = item.act ?? [];
    const forumLabels = item.forum ?? [];
    const mainCites = validateAnswerCitations({ answerText: item.input, authorities: payload });
    const mainRewrite = rewriteForbiddenAuthorityMentions({ answerText: item.input, authorities: payload });
    const mainText = mainCites.ok
      ? attachClaimQualifications(mainRewrite.rewrittenText, { actLabels, forumLabels })
      : item.input;
    const mainRoute = !mainCites.ok ? "withheld" : mainRewrite.removedMentions.length > 0 ? "rewritten" : "served";
    const assessed = assessCitations(item.input, payload);
    const headBad = assessed.brackets.some((bracket) => bracket.class === "ungrounded" || bracket.class === "partial");
    const headRewrite = rewriteByGrammar(item.input, assessed);
    const headBody = headBad ? item.input : headRewrite.text;
    const headText = headBad ? item.input : applyStructuredHedge(headBody, assessCitations(headBody, payload), { actLabels, forumLabels });
    const headRoute = headBad ? "withheld" : headRewrite.removed > 0 || headRewrite.text !== item.input ? "rewritten" : "served";
    const classes: string[] = [];
    if (mainRoute !== "served" && headRoute === "served") classes.push("false_authority");
    if (mainText.includes(ACT) && !headText.includes(ACT)) classes.push("lost_qualification");
    if (mainText.includes(FORUM) && !headText.includes(FORUM)) classes.push("lost_qualification");
    if (mainRoute === "served") {
      for (const match of mainText.matchAll(/\[([^\[\]]+)\]/g)) {
        if (!headText.includes(`[${match[1]}]`)) classes.push("deleted_text");
      }
      if (headRoute === "served" && !headText.startsWith(item.input.slice(0, Math.min(item.input.length, 24)))) classes.push("deleted_text");
    }
    for (const kind of new Set(classes)) {
      byClass[kind] = [...(byClass[kind] ?? []), item.id];
    }
    if (classes.length === 0) byClass.same_or_stricter = [...(byClass.same_or_stricter ?? []), item.id];
  }
  console.log(JSON.stringify({ proseSuite: byClass }));
  assert.deepEqual(byClass.false_authority ?? [], []);
  assert.deepEqual(byClass.lost_qualification ?? [], []);
  assert.deepEqual(byClass.deleted_text ?? [], []);
});

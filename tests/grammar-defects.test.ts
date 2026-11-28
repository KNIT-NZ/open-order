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
const PLACEHOLDER = "a provision that was not retrieved";

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
  assert.equal(keptOutside(input, assessed.rewriteSpans).split(PLACEHOLDER).join(""), rewritten.text.split(PLACEHOLDER).join(""));

  const mixed = "Standing Orders 98 and 99 and SO 97 apply. The House may sit [SO 1].";
  const mixedAssessment = assessCitations(mixed, authorities(["SO 1"]), { provisionTree: {} });
  const mixedOut = rewriteByGrammar(mixed, mixedAssessment);
  assert.equal(mixedOut.text.includes("[SO 1]"), true);
  assert.equal(mixedOut.text.includes("apply. The House may sit"), true);
  assert.equal(/[A-Za-z]a provision/.test(mixedOut.text), false);
  assert.equal(keptOutside(mixed, mixedAssessment.rewriteSpans), mixedOut.text.split(PLACEHOLDER).join(""));
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
    if (/[A-Za-z]a provision that was not retrieved/.test(head.text)) glued += 1;
    if (/not retrieved[A-Za-z0-9\]]/.test(head.text)) glued += 1;
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
  assert.equal(rewrite("SO 1 et seq. apply [SO 1]."), "a provision that was not retrieved apply [SO 1].");
  assert.equal(rewrite("SR 2/3 to 5 apply [SO 1]."), "a provision that was not retrieved apply [SO 1].");
  assert.equal(rewrite("SO 12 /9 lets the House sit late."), "a provision that was not retrieved lets the House sit late.");
  assert.equal(rewrite("Under SO 12/9 the House may sit late [SO 1]."), "Under a provision that was not retrieved the House may sit late [SO 1].");
  assert.equal(rewrite("SO 1 and 12/9 apply [SO 1]."), "SO 1 and a provision that was not retrieved apply [SO 1].");
  assert.equal(rewrite("Standing Order one hundred and forty-six applies [SO 1].").includes("forty-six"), false);
  assert.equal(/[A-Za-z]a provision|anda provision|SO 1a provision/.test(rewrite("SO 1 et seq. apply [SO 1].")), false);
});

test("OO-DEF-145 an unreadable pin group is residue and is not served", () => {
  const section = "The Speaker may—\n(a) name a member; or\n(b) suspend the sitting.";
  const labels = authorities(["SO 7"], new Map([["SO 7", section]]));
  for (const shape of ["(abcd)", "(abc)", "(xyz)", "(a.)", "( a )", "(-)", "(ⅰ)", "(a1)", "(b)(xyz)", "(-)(iv)"]) {
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
  const sections = pack.sections.filter((section) => section.citation_label.startsWith("SO "));
  const trees = new Map(sections.map((section) => [section.citation_label, new Set(buildProvisionTree(section.citation_label, section.content))]));
  const garbage = ["(abcd)", "(abc)", "(xyz)", "(a.)", "( a )", "(-)", "(ⅰ)", "(a1)"];
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
    const missing = [...shown.matchAll(/\(([^)]*)\)/g)].some((match) => {
      const group = `(${match[1].replace(/\s+/g, "")})`;
      return ![...tree].some((key) => key.includes(group));
    });
    if (missing) servedFake += 1;
  }
  console.log(JSON.stringify({ pinShapeFuzz: 5000, servedFake }));
  assert.equal(servedFake, 0);
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

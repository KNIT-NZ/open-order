import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderAiAnswerNodes } from "../lib/open-order/answer-markup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { searchParamsSchema } from "../lib/search";
import { normalizeAiProviderError } from "../lib/ai/errors";
import { corroborateClaimAppeal, type AppealVerdict } from "../lib/ai/claim-appeal";
import { buildV40Dossier, validateV40Proposal, type V40Authority, type V40ProposedWitness } from "../lib/ai/scenario-adjudication";
import { verifiedDatabaseUrl } from "../lib/db-transport";

// Synthetic witnesses, not representations of actual parliamentary rules.
const source: V40Authority = {
  sectionId: "fixture-1", citationLabel: "SO 999", documentCorpus: "standing_orders",
  heading: "Synthetic procedure", path: ["House"],
  sectionContent: "A synthetic rule requires an affirmative decision before the fictional procedure may proceed.",
};
const witness: V40ProposedWitness = {
  citationLabel: source.citationLabel, role: "governing", exactQuote: source.sectionContent,
  actorMatches: true, settingMatches: true, actionMatches: true, stageMatches: true,
  rationale: "Synthetic fixture matches the procedural question.",
};
function review(selected: V40ProposedWitness[]) {
  return validateV40Proposal({ question: "What is the synthetic procedure?", candidates: [source],
    proposal: { selected, remainingUncertainties: [], explanation: "Synthetic test" } });
}
test("adjudication accepts an exact governing witness", () => {
  assert.deepEqual(review([witness]).accepted, [source.citationLabel]);
});
test("adjudication rejects fabricated quotations, unknown authorities and scope mismatches", () => {
  for (const invalid of [
    { ...witness, exactQuote: "This fabricated quotation never occurs in the source." },
    { ...witness, citationLabel: "SO 998" },
    { ...witness, actorMatches: false },
  ]) assert.equal(review([invalid]).authorities.length, 0);
});
test("qualifiers alone cannot establish a governing witness", () => {
  assert.equal(review([{ ...witness, role: "qualification" }]).reason, "v40_no_governing_witness");
});
test("duplicate sources and out-of-scope corpora are excluded from the dossier", () => {
  const result = buildV40Dossier({ question: "synthetic procedure", legacySelected: [source, source],
    searches: [{ query: "synthetic", corpus: null, results: [source, { ...source, sectionId: "bad", documentCorpus: "other" }] }] });
  assert.deepEqual(result, [source]);
});
test("independent appeal requires a verbatim witness for every cited source", () => {
  const claim = { id: "c1", text: "Synthetic claim", citations: [source.citationLabel], lineIndex: 0 };
  const verdict: AppealVerdict = { id: "c1", supported: true, reason: "Independent synthetic source review", witnesses: [{ citationLabel: source.citationLabel, exactQuote: source.sectionContent }] };
  const check = (v: AppealVerdict) => corroborateClaimAppeal({ claim, verdict: v, authorities: [source] });
  assert.equal(check(verdict).accepted, true);
  assert.equal(check({ ...verdict, witnesses: [] }).accepted, false);
  assert.equal(check({ ...verdict, id: "different" }).accepted, false);
  assert.equal(check({ ...verdict, witnesses: [{ citationLabel: source.citationLabel, exactQuote: "A false quotation not present in the supplied source." }] }).accepted, false);
});
test("search input enforces pagination limits and rejects empty queries", () => {
  assert.equal(searchParamsSchema.safeParse({ q: "", limit: "10" }).success, false);
  assert.equal(searchParamsSchema.safeParse({ q: "closure", limit: "51" }).success, false);
  assert.equal(searchParamsSchema.safeParse({ q: "closure", offset: "-1" }).success, false);
  const parsed = searchParamsSchema.parse({ q: "closure", limit: "12", offset: "2" });
  assert.equal(parsed.limit, 12);
  assert.equal(parsed.offset, 2);
});
test("structured provider failures classify retryability without publishing raw messages", () => {
  const transient = normalizeAiProviderError({ status: 429 }, "fixture");
  assert.equal(transient.kind, "rate_limited");
  assert.equal(transient.retryable, true);
  assert.equal(normalizeAiProviderError({ status: 401 }, "fixture").retryable, false);
  assert.equal(normalizeAiProviderError(new Error("synthetic private detail"), "fixture").message, "An AI provider request failed.");
});
test("remote database connections require verified TLS; only local development can disable TLS", () => {
  const remote = new URL(verifiedDatabaseUrl("postgresql://user:dummy@example.invalid/db?sslmode=require&ssl=0", "production"));
  assert.equal(remote.searchParams.get("sslmode"), "verify-full");
  assert.equal(remote.searchParams.has("ssl"), false);
  assert.equal(new URL(verifiedDatabaseUrl("postgresql://localhost/db?sslmode=disable", "development")).searchParams.get("sslmode"), "disable");
  assert.equal(new URL(verifiedDatabaseUrl("postgresql://localhost/db?sslmode=disable", "production")).searchParams.get("sslmode"), "verify-full");
  assert.equal(new URL(verifiedDatabaseUrl("postgresql://example.invalid/db?sslmode=no-verify", "development")).searchParams.get("sslmode"), "verify-full");
});

// Rendering must preserve text and supported formatting without an HTML injection sink.
test("answer rendering keeps adversarial HTML inert and preserves authority formatting", () => {
  const input = 'Bottom line: <img src=x onerror=alert(1)> &lt;script&gt; [1/2]';
  const html = renderToStaticMarkup(createElement("div", null, ...renderAiAnswerNodes(input)));
  assert.match(html, /oo-aiInlineLabel/);
  assert.match(html, /oo-aiAuthorityPill/);
  assert.match(html, /&lt;img/);
  assert.match(html, /&amp;lt;script&amp;gt;/);
  assert.doesNotMatch(html, /<(?:img|script|svg)\b/i);
  assert.doesNotMatch(html, /<[^>]+\sonerror=/i);
});
test("answer rendering preserves paragraph, list and separator structure", () => {
  const input = "Bottom line: Example.\n\n- Heading\n- This is a deliberately long item that should appear as a list item rather than a section heading.";
  const html = renderToStaticMarkup(createElement("div", null, ...renderAiAnswerNodes(input)));
  for (const cls of ["oo-aiParagraph", "oo-aiSectionHeading", "oo-aiList", "oo-aiListItem", "oo-aiSectionRule"]) assert.ok(html.includes(cls), cls);
});
test("search schema retains v3 pagination defaults and error shape after migration", () => {
  assert.deepEqual(searchParamsSchema.parse({q: "closure"}), {q: "closure", limit: 10, offset: 0});
  const invalid = searchParamsSchema.safeParse({q: "", limit: "51"});
  assert.equal(invalid.success, false);
  if (!invalid.success) { assert.ok(invalid.error.flatten().fieldErrors.q?.length); assert.ok(invalid.error.flatten().fieldErrors.limit?.length); }
});

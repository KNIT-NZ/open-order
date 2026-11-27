import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveExactSectionKey, deriveExactCitationCompact } from "../lib/search-core";
import { extractStandingOrderNumberAndHeading } from "../lib/text";
import { sourceLabel } from "../lib/ai/claim-appeal";
import { validateAnswerAuthorityMentions, validateAnswerCitations } from "../lib/procedural-reasoning";

test("full multi-letter standing order identity and existing forms", () => {
  for (const [query, key] of [["SO 338AB", "so-338ab"], ["Standing Order 405AA", "so-405aa"], ["SO 38A", "so-38a"], ["SO 109", "so-109"], ["49/5", "49/5"]]) {
    assert.equal(deriveExactSectionKey(query), key);
    assert.equal(deriveExactCitationCompact(query), key.replace(/-/g, ""));
  }
  assert.equal(extractStandingOrderNumberAndHeading("338AB Functions")?.orderNumber, "338AB");
  assert.equal(deriveExactSectionKey("SO 338AB and 338B"), null);
});

test("appendix clauses and table locators are distinct exact keys", () => {
  for (const [query, key] of [["Appendix D clause 1", "appendix-d-cl-1"], ["Appendix C cl 1AA", "appendix-c-cl-1aa"], ["Appendix A table 2 row 10", "appendix-a-table-2-row-10"], ["Appendix E part 2 row 12", "appendix-e-part-2-row-12"], ["Appendix A note", "appendix-a-note"]]) {
    assert.equal(deriveExactSectionKey(query), key);
    assert.equal(deriveExactCitationCompact(query), key.replace(/-/g, ""));
  }
  assert.equal(deriveExactSectionKey("Appendix D"), null);
});

test("qualified sources retain complete parent identity", () => {
  assert.equal(sourceLabel("SO 338AB(2)(g)"), "SO 338AB");
  assert.equal(sourceLabel("Appendix D cl 1(2)"), "Appendix D cl 1");
  assert.equal(sourceLabel("SO 38A(1)"), "SO 38A");
  assert.equal(sourceLabel("49/5"), "49/5");
});

test("prose and bracketed citations do not collapse distinct authority identities", () => {
  const authorities = [{citationLabel:"SO 338AB"}, {citationLabel:"Appendix D cl 1"}];
  assert.equal(validateAnswerAuthorityMentions({answerText:"SO 338AB and Appendix D clause 1.", authorities}).ok, true);
  assert.equal(validateAnswerAuthorityMentions({answerText:"SO 338A and Appendix D cl 2.", authorities}).ok, false);
  assert.equal(validateAnswerCitations({answerText:"[SO 338AB(2)] [Appendix D cl 1(2)]", authorities}).ok,true);
  assert.equal(validateAnswerCitations({answerText:"[SO 338A] [Appendix D cl 2]", authorities}).ok,false);
});

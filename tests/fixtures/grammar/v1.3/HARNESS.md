# Harness instructions v1.3 (reproduce `main_254d6e4`, `main_agrees`, `main_grounding_agrees`, `main_reason_agrees` and `divergence` in golden-corpus-v1.3.jsonl)

v1.3 is a strict delta on v1.2: no field is renamed or removed, and no row ID changes. It adds `expected_rule_codes` per row (GRAMMAR §4.2) and `main_254d6e4.rule_codes` (always `"n/a"`), plus one row, mutation_probe-013.

Read-only. Use a scratch checkout of the product repository at commit `254d6e459a98f3e274d99725702f740721ddca94`, with dependencies installed as for its own tests (`node --import tsx --test`). Never edit the tracked files.

1. **Expose the helpers in a scratch copy.**
   - Copy `lib/procedural-reasoning.ts` to `lib/__grammar_main.ts` in the same folder, so its relative imports still resolve.
   - Append: `export { mentionSpans, allowedSet, extractInlineCitations, citationIsGrounded };`
   - Delete the copy when you are done.
2. **Run each corpus row through the route's detector order.** Leave out the LLM and claim-pruning steps.
   ```ts
   const authorities = row.admitted.map((citationLabel) => ({ citationLabel }));
   const text = normalizeAnswerFormatting(normalizeAnswerCitationLabels({ answerText: row.input, authorities }));
   const cit  = validateAnswerCitations({ answerText: text, authorities });            // per-bracket: grounded unless listed in invalidCitations
   const men  = validateAnswerAuthorityMentions({ answerText: text, authorities });    // per-span: ok unless its whitespace-flattened text is listed
   const before = mentionSpans(text, allowedSet(authorities));
   // v1.1: apply the route's rewrite step, then re-check (the route's own order)
   const rewritten = men.ok ? text
     : normalizeAnswerFormatting(rewriteForbiddenAuthorityMentions({ answerText: text, authorities }).rewrittenText);
   const after = mentionSpans(rewritten, allowedSet(authorities));
   const recheck = validateAnswerAuthorityMentions({ answerText: rewritten, authorities });
   ```
3. **Main verdict, taken AFTER the rewrite step (v1.1).**
   - Brackets: count the grounded brackets (from `cit`) as *good* and the others as *bad*.
   - Mentions: count each span of `after` that is not listed in `recheck.invalidAuthorityMentions` (whitespace-flattened) as *good*, and each listed one as *bad*. Also count as *bad* each placeholder `a provision that was not retrieved` that the rewrite inserted: its count in `rewritten` minus its count in `text`.
   - So an admitted mention whose false `not retrieved` suffix the rewrite strips counts as good (G-XREF). Before v1.1 it counted as bad, which made `mutation_probe-006` a false disagreement.
   - The verdict is `yes` if there is at least one good and no bad, `partial` if there are both, and `no` otherwise.
   - The route outcome is `withheld_invalid_citations` if `cit.ok` is false; otherwise `rewritten` if the first mention check `men` failed, `served` if anything is good, and `served_no_authority` if there is nothing at all.
3a. **Main's grounded label set, in CPK (v1.2).**
   - Collect the text of every grounded bracket (from `cit`, on `text`) and every *good* span of `after`.
   - Read labels from each text, after deleting format characters and dropping parenthesised years 1800–2099:
     - `Appendix X[,] clause|cl N(pins)` and `clause|cl N(pins) of Appendix X` give `APP X cl N(pins)`.
     - `Appendix A note` gives `APP A note`. `Appendix A table T row R` and `Appendix E part P row R` keep their shape with `APP`.
     - `N/M(pins)` gives `R N/M(pins)`.
     - A continued pin (`39(1) and (2)`, `39(1)(a) and (b)`) replaces the last pin level (`SO 39(2)`, `SO 39(1)(b)`).
     - An SO range `a to|–|through b` (width at most 100) expands to every integer.
     - Every remaining number with optional upper-case suffix and pins gives `SO n(pins)`.
   - Keep a label only if it is an admitted label (in CPK) or a pinpoint under one. Anything else main could not have admitted, so it is a quantity or year token, not a grounding.
   - Sort the result: this is `main_254d6e4.grounded_cpk`.
3b. **Main's reason code (v1.2).** Main exposes no per-rule reason, so its reason code is the route outcome from step 3: `main_254d6e4.reason_code`.
3c. **Two kinds of reason code (v1.3). Do not mix them.**
   - **Route-outcome code:** `expected_reason_code` and `main_254d6e4.reason_code`. It takes one of four values (`served`, `rewritten`, `withheld_invalid_citations`, `served_no_authority`). It is compared in step 4 as before.
   - **Rule-level codes:** `expected_rule_codes`. This field comes from the closed enum in GRAMMAR §4.2 and has three entries:
     - `parts`: one code per `expected.mentions` entry, in the same order;
     - `brackets`: one entry per `expected.brackets` entry, either `neutral-bracket` or `null`;
     - `row`: the rollup.
   - **Main emits no rule-level codes**, so `main_254d6e4.rule_codes` is the literal `"n/a"` on every row. It is not compared, and there is no `main_rule_agrees` field. Do not infer main's rule codes from its route or spans.
4. **Agreement.**
   - `main_agrees`: main's verdict equals the row's `grounded`.
   - `main_grounding_agrees`: main's `grounded_cpk` equals the row's `expected_grounded_cpk`. That field holds the `grounded` parts of `expected.mentions` in CPK, with `SO a..b` expanded.
   - `main_reason_agrees`: main's `reason_code` equals the row's `expected_reason_code`.
     - The expected code is the outcome this grammar implies under the **current, unchanged** policy: `withheld_invalid_citations` if any expected bracket is `ungrounded` or `partial`.
     - Otherwise it is `rewritten` if any prose mention is ungrounded, or if a `(referred to in …)` suffix outside brackets is stripped.
     - Otherwise it is `served` if anything is grounded, and `served_no_authority` if nothing is.
   - `divergence`:
     - `main_more_permissive` / `main_more_restrictive` when the verdicts differ, by rank `no < partial < yes`.
     - Else **`verdict_agree_grounding_disagree`** when the grounded sets differ.
     - Else null.
     - Reason-code differences do not change `divergence`. Report them separately.
   - `grounding_subclass`, set only on `verdict_agree_grounding_disagree` rows:
     - `main_grounds_extra_provision` if main grounds a provision (pins stripped) that the grammar does not (false authority);
     - otherwise `main_grounds_fewer_provisions` if main misses one;
     - otherwise `pinpoint_level_only`.
   - The expected result is identical `main_254d6e4` objects for all 419 rows:
     - Agreement: 255 agree, 67 permissive, 74 restrictive, 23 verdict-agree / grounding-disagree (3 extra-provision, 3 fewer-provisions, 17 pinpoint-level).
     - Without the 17 deferred rows: 243 / 63 / 73 / 23.
     - Reason codes differ on 19 otherwise-agreeing rows.
5. **Mutants.** For each row of MUTATION-TESTS.md, apply that one edit to a fresh scratch copy (only one match must be replaced) and re-run steps 2–4. A mutant is killed when any verdict or route changes.
6. **Using the corpus as a test suite for the Batch 3 parser.**
   - For every row, assert that the parser's row verdict equals `grounded`. The per-part statuses must equal `expected.mentions[*].status`.
   - (v1.3) Assert that the parser's part, bracket and row codes equal `expected_rule_codes`. The parser may emit only codes from the GRAMMAR §4.2 enum, and only the identifiers themselves, never any text from the input.
   - Rows tagged `deferred-Q5`, `deferred-quote` or `deferred-ruling-index` describe Batch 3 behaviour in `grounded`. The later target is in `deferred`.
   - Feed `provision_tree` to the existence check (P-EXIST) **in tests only**. A label missing from `provision_tree` has an unknown tree, so every descendant of it fails closed.
   - `provision_tree` uses the canonical provision key notation (CPK, GRAMMAR §4.1). Production must derive trees from each admitted authority's `sectionContent` under the §4.1 tree-building rule, never from draft chunks.
   - Rows tagged `synthetic-tree` carry hand-written trees: regenerate them and re-check the labels when real trees exist.
   - Rows tagged `partial-tree` carry truncated trees: do not reuse those trees as fixtures.
   - Rows tagged `fixture-tree` (25) carry trees derived from the fixture text by a reference build of the §4.1 rule. `unknown-tree` (tree_build-011) deliberately carries no tree.
   - Some inputs contain U+200B on purpose (category `normalisation`). Keep the JSON escapes intact.

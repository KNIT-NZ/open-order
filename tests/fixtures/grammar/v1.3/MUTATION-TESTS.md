# Mutation tests v1.3: guards in main 254d6e4's citation detector

Target: `lib/procedural-reasoning.ts` at commit `254d6e459a98f3e274d99725702f740721ddca94`. Line numbers are at that commit.

Method:
- Each mutant removes or weakens one guard in a **scratch copy** of that file. The corpus `golden-corpus-v1.3.jsonl` is then re-run through the detector pipeline described in HARNESS.md.
- Main's verdict is taken **after its rewrite step** (HARNESS.md step 3, since v1.1). A mutant is killed by a verdict or route change. Grounding-set changes (v1.2) are reported by the harness, but no kill below depends on them.
- No product code was changed.
- Under Q6 no more work goes into the guards. Batch 3 replaces this code with a parser that follows GRAMMAR-v1.3, and these rows become that parser's regression tests.

Kill rules:
- **KILLED (grammar)**: the mutant changes the verdict or route of a row where main agrees with the grammar, or makes a row more permissive than the grammar where it was not before (a new false-authority path).
- **KILLED (pin only)**: it changes only rows where main already diverges.
- **EQUIVALENT**: no corpus row changes, and 40,000 seeded random texts gave no difference in the citation check, the mention check or the rewrite. The argument for each is in the table.
- **SURVIVED (not equivalent)**: no corpus row changes under the after-rewrite verdict, but the random texts do show differences in the raw function outputs.

| Mutant | Line | Guard removed or weakened | Result | Rows that must fail (id: input) |
|---|---|---|---|---|
| M01 | L1898 | SO_NUM all-or-nothing: no backtrack before '/' (D-11) | KILLED (grammar) | `mutation_probe-001`: Standing Orders 1, 23/4 apply [SO 1].; `mutation_probe-002`: SO 1 and 12/9 apply [SO 1]. |
| M02 | L1904 | possessive is not a quantity follower | KILLED (grammar) | `possessive-001`: Under SO 1 and 99 Members' bills proceed [SO 1].; `possessive-002`: Under SO 1 and 99 MPs' bills proceed [SO 1].; `possessive-003`: Under SO 1 and 99 Members’ bills proceed [SO 1]. (+1 more) |
| M03 | L1905 | JOINED stops before a quantity (D-10) | KILLED (grammar) | `bracket_quantity-014`: The House may sit [SO 1 and 2 members].; `gated_count-003`: Under SO 1, 10 speakers or more may speak [SO 1].; `mixed-003`: Under SO 1, 2 members may object [SO 1]. (+24 more) |
| M04 | L1861 | quantity part skipped after an admitted label | KILLED (grammar) | `bracket_quantity-014`: The House may sit [SO 1 and 2 members]. |
| M05 | L1876 | a bracket with no label is not grounded (sawLabel) | EQUIVALENT | Every branch of the part loop either returns false or sets `sawLabel`. The quantity skip needs `parent !== ""`, and `parent` is set only together with `sawLabel`; `citationParts` never returns an empty list. So the guard is an invariant. |
| M06 | L1877 | full mention scan of bracket text (D-15/D-16) | KILLED (grammar) | `ampersand-001`: The House may sit [SO 1 & SO 99].; `ampersand-002`: The House may sit [SO 1 & 99].; `ampersand-005`: The House may sit [SO 1 + SO 99]. (+20 more) |
| M07 | L1973 | long SO spelling of N/M is never admitted (D-9) | KILLED (grammar) | `mutation_probe-003`: Standing Order 2/9 lets the House sit late. |
| M08 | L1952 | range width bound (>100 fails closed) | KILLED (grammar) | `mutation_probe-004`: Standing Orders 1 to 102 apply. |
| M09 | L1952 | reversed range fails closed | KILLED (grammar) | `mutation_probe-005`: Standing Orders 3 to 1 and 2 apply [SO 2]. |
| M10 | L1985 | every list/range token must be admitted (D-6) | KILLED (grammar) | `ampersand-002`: The House may sit [SO 1 & 99].; `ampersand-004`: Under SO 1 & 99, the Speaker may act [SO 1].; `lists-002`: Standing Orders 1 and 99 apply [SO 1]. (+28 more) |
| M11 | L1964 | subclause token falls back to its parent | KILLED (grammar) | `edition-003`: The House may sit [SO 1 (2026)].; `existence-004`: Standing Orders 212A(4) and (5) apply.; `mutation_probe-009`: The House may suspend [SO 39(1)]. It may also adjourn [SO 39(1) and (2 (+5 more) |
| M12 | L2030 | a suffixed span is still invalid in the check (D-1) | KILLED (grammar) | `mutation_probe-006`: Standing Order 1 (referred to in SO 2; not retrieved) applies [SO 1].; `mutation_probe-012`: Standing Order 99 (referred to in SO 1; not retrieved) lets the Speake |
| M13 | L1809 | embedded 'mentioned/referred/cited in' rejects a bracket | KILLED (pin only) (moves 1 row(s) toward the grammar) | `bracket_xref-010`: The House may sit [SO 1 (cited in SO 2)]. |
| M14 | L1913 | N/M never starts inside a longer number | EQUIVALENT | Every use of RULING_NUM follows a prefix, a separator or `\b`, so the character before it is never a digit. |
| M15 | L1914 | bare N/M alternative (D-14) | KILLED (grammar) | `fraction_quantity-003`: A 2/3 vote of the House is needed [SO 1].; `mutation_probe-001`: Standing Orders 1, 23/4 apply [SO 1].; `mutation_probe-002`: SO 1 and 12/9 apply [SO 1]. (+4 more) |
| M16 | L1857 | orphan/unadmitted subclause continuation fails the bracket | KILLED (grammar) | `mutation_probe-013`: The House may sit [(2) and SO 1]. |
| M17 | L1816 | exact-label fast path (expected equivalent) | EQUIVALENT | The loop below repeats the `cited === label` test, so only performance changes. |
| M18 | L1825 | label followed by ':' is allowed | KILLED (grammar) | `mutation_probe-007`: The House may sit [SO 1: quorum]. |
| M19 | L2002 | overlapping spans are skipped | KILLED (grammar) | `mutation_probe-012`: Standing Order 99 (referred to in SO 1; not retrieved) lets the Speake |
| M20 | L1909 | singular intro does not eat a plural 'S.O.s' | EQUIVALENT | PLURAL_INTRO comes before SINGULAR_INTRO in every alternation. A singular match that the guard would block needs a digit where an `s` stands. |
| M21 | L1902 | GRAMMAR-DIRECTED: gate speakers/parties behind 'or more' (r8) | KILLED (grammar) | `gated_count-003`: Under SO 1, 10 speakers or more may speak [SO 1].; `quantity_gated-006`: Under SO 1, 3 parties may object [SO 1].; `quantity_gated-007`: Under SO 1, 10 speakers may speak [SO 1]. |
| M22 | L1835 | 'and' splits bracket parts | KILLED (grammar) | `et_seq-005`: The House may sit [SO 1 and following].; `lists-020`: The House may sit [SO 1 and the Speaker's ruling]. |
| M23 | L1989 | prose scan masks bracket contents | KILLED (grammar) | `bracket_xref-011`: The House may sit [SO 99 (referred to in SO 1; not retrieved)].; `edition-007`: The ruling lets the House sit [SR 48/2 (2019)].; `normalisation-004`: The House may act [SO 212​A]. (+4 more) |
| M24 | L1928 | prefixed ruling label also admits its bare form | EQUIVALENT | Every ruling lookup also checks `sr ${whole}` (L1965, L1976, L1980). |

**Totals:** 24 mutants: 18 KILLED (grammar), 5 EQUIVALENT, 1 KILLED (pin only).

Changes since v1:
- **M12** (L2030, a suffixed span is invalid) has been **KILLED (grammar)** since v1.1. `mutation_probe-006`, and now `mutation_probe-012`, agree with the grammar after the rewrite, and the mutant skips the rewrite.
- **M16** (L1857, an orphan or unadmitted subclause continuation fails the bracket) stays **KILLED (grammar)** in v1.3, now through `mutation_probe-013` (8c-87 #2). Until v1.2 it was guarded by `subclause-010` and `mutation_probe-009`, which admitted the non-pack label `SO 39(1)`. v1.3 re-bases those rows on the pack label `SO 39`. With a pack label the parent of a continuation is always admitted, so the guard is reachable only by an orphan pin at the start of a bracket. Main fails `[(2) and SO 1]` (`no`). The mutant grounds the whole bracket (`yes`), a new false-authority path. The grammar gives `partial`.
- **M19** (L2002, overlapping spans are skipped) survived in v1.1 (not equivalent; a corpus gap). In v1.2 it is **KILLED (grammar)** by `mutation_probe-012` (8c-86 c; register OO-DEF-117). With only SO 99 admitted, main gives `yes`. The mutant also grades the referrer `SO 1` inside the stripped suffix, rewrites the text to `Standing Order 99a provision that was not retrieved; not retrieved) …` and gives `partial`.

Notes:
- **M13** (L1809, the embedded 'cited in' check) moves rows only toward the grammar.
- **M21** gates speakers/parties fully. It is killed by the grammar, because G-COUNT treats `Under SO 1, 3 parties` as a count.
- **The sawLabel half of OO-DEF-082** cannot be tested alone: M05 is equivalent. In the new parser, the rule "at least one grounded part" is pinned directly by the quantity-bracket and not-citation rows.

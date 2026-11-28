# Citation grammar, v1.3

Scope: how the assistant recognises **provision mentions** (in prose and inside brackets) and **citation brackets** for Standing Orders 2026 (SO), Speakers' Rulings 2023 (SR) and the SO appendices, and when a part is **grounded**.

Status:
- This is a **detector specification**. It does not change validation or abstention policy (§6). Batch 3 implements the detector first.
- The baseline is `main` @ `254d6e459a98f3e274d99725702f740721ddca94`, file `lib/procedural-reasoning.ts` L1800–2091.
- It supersedes v1.2 and applies rulings 8c-80 to 8c-87. A later ruling wins where they differ. 8c-85 does not change the grammar.
- **v1.3 is a strict delta on v1.2 (8c-87).** No field is renamed or removed, no row ID changes, and every v1.2 label is unchanged except the four rows listed in 8c-87 #2. v1.3 changes:
  - **§4.2 (new): rule-level reason codes.** A closed enum with one code per part, a bracket code and a row rollup. The corpus gains the field `expected_rule_codes` and keeps `expected_reason_code` (8c-87 #1).
  - The four rows that admitted the non-pack label `SO 39(1)` now admit `SO 39` with its fixture tree. `mutation_probe-013` is added to keep M16 killed (8c-87 #2).
- v1.2 changes, kept (8c-86 and the v1.2 follow-up list):
  - §4.1 rule 6 now reads "under one **parent**", with the whole-parent reading. Roman restarts nest normally.
  - Part statuses are closed: `qualified_xref` is gone (G-XREF).
  - §5 adds the grounded-label-set comparison, reason codes and the class "verdict agrees, grounding disagrees".
- v1.1 changes, kept:
  - P-YEAR is per instrument (8c-82, 8c-83 #1).
  - P-NOTE: a note grounds only if it exists (8c-83 #2).
  - R includes revoked subdivisions and is derived from the source (8c-83 #3, 8c-84 #2).
  - Q3 amended: time-unit possessives are quantities (8c-83 #4).
  - §4.1 adds the tree-building rule, the `sectionContent` interface, the canonical key notation and ruling-index deferral (8c-82 #2, 8c-83 #5, 8c-84 #1).
  - Pack appendix label shapes are added (8c-84 #3).
  - N1 gains its delete and join rules (8c-84 #4).
  - Main is compared after its rewrite step (§5).
- The rows in `golden-corpus-v1.3.jsonl` are probes. Where a row and this text disagree, this text wins and the row is a bug.

Doctrines:
- **D1 authority before assertion.**
- **D2 false authority outranks false withholding.**
- **D3 prefer partial resolution to abstention.**
- **D4 preserve qualifications.**

An ambiguous form takes the reading that cannot create false authority (D2). Within that limit, each part is graded on its own (D3).

## 1. Normalisation (`N`). Applies to draft or answer text **and** to source and corpus text (OO-DEF-095)
- **N1 Separators and joins.** Separators are `\s`, NBSP, U+1680, U+2000–U+200A, U+2028/9, U+202F, U+205F, U+3000. Invisible format characters are U+200B–U+200D, U+2060–U+2064, U+180E, U+FEFF and soft hyphen U+00AD. Separators count as one space.
  - Between two letters or two digits, a format character **joins** them: `Or\u00adder` reads `Order`, `9\u200b9` reads `99`.
  - Between a **digit and an upper-case letter suffix** it **joins** (8c-84 #4): `212\u200bA` reads `212A`. It never reads `212 A`, so it can never ground SO 212.
  - At any other **letter–digit boundary** it counts as one space: `Order\u206399` reads `Order 99`. Both readings give the same mention, and this rule picks one.
  - **Anywhere else, a format character is deleted** (8c-84 #4). This covers a format character next to punctuation, at the start of a line or at the start of the text. For example, the source text of SO 87 opens with `\u200b(1)`, which reads `(1)`, and `[\u200bSO 1]` reads `[SO 1]`.
  - The same N1 applies to admitted source text before it is used for any existence or cross-reference check.
- **N2 Slashes.** `/`, U+2044 and U+FF0F are SLASH. Separators next to a SLASH are dropped (`12 /9` reads `12/9`).
- **N3 Dashes.** `-`, `–` and `—` are DASH.
- **N4 Apostrophes.** `'`, `’` and `ʼ` are APOS.
- **N5 Case.** Matching ignores case, except in G-ADVERB.
- **N6 Sentence-initial** means at text start, after `.` `!` `?` `:` followed by separators, at a line start, or after a list bullet (`-`, `*`, `•`, `1.`).

## 2. Productions (EBNF; `_` = one or more separators, `_?` = optional)
```ebnf
(* ---------- prefixes ---------- *)
so_single   = ( "SO" | "S.O." | "S. O." | "Standing" (_ | "-" | "") "Order" [ "(s)" ] ) [ _? ( "No." | "No" | "Number" | "number" ) ]
            | "Standing" _ "Order" _ "(SO)" ;
so_plural   = "SOs" | "S.O.s" | "Standing" _ "Orders" [ _ "nos." ] | "Standing" _ "Order" _ "nos." ;
sr_prefix   = "SR" | "S.R." | ( "Speaker" | "Speakers" ) [APOS] ["s"] _ ( "ruling" | "rulings" ) | "Ruling" | "Rulings" ;
app_name    = "Appendix" _ LETTER ;                                   (* LETTER = A..F only *)

(* ---------- numbers and pinpoints ---------- *)
digits      = DIGIT { DIGIT } ;                                       (* taken whole (G-WHOLE) *)
pin         = "(" ( digits { UC_LETTER } | lc_letter [ lc_letter ] | roman ) ")" ;  (* (1) (1A) (2A) (a) (aa) (ab) (i) (iv) *)
year_q      = "(" YEAR ")" ;                                          (* YEAR = 1800..2099; beats pin (G-YEAR); graded by P-YEAR *)
so_number   = ( digits [ UC_LETTER { UC_LETTER } | lc_letters(1..4) ] | spelled_cardinal | "(" digits ")" ) { _? pin } ;
                                                                      (* "(" digits ")" only straight after so_single *)
ruling_num  = digits SLASH digits { _? pin } ;                        (* 48/2, 2/3(2) *)
ruling_rng  = ruling_num _? range_op _? ruling_num ;                  (* 2/4–3/1: never expanded arithmetically (G-RRANGE) *)
ordinal_so  = ( digits ("st"|"nd"|"rd"|"th") | spelled_ordinal ) _ "Standing" _ "Order" ;

(* ---------- mentions ---------- *)
so_mention  = ( so_single | so_plural ) _? so_number { joiner so_item } | ordinal_so ;
so_item     = so_number | so_number range_op so_number | pin | so_mention | app_mention | sr_mention ;
so_slash    = ( so_single | so_plural ) _? ( digits SLASH digits | digits pin SLASH digits | digits SLASH digits SLASH digits ) ;  (* G-NOSLASH *)
sr_mention  = sr_prefix _? ( ruling_rng | ruling_num ) { joiner ( ruling_num | digits ) } | ruling_rng | ruling_num ;
app_mention = app_name [ _? "," ] _ clause_word _ so_number           (* "Appendix D, clause 5(3)(b)" (SR form), "Appendix B cl 8A", "Appendix C cl 1AA" *)
            | clause_word _ so_number { joiner so_number } _ "of" _ app_name   (* "clause 10(3) of Appendix F", "clauses 7 and 10 of Appendix F" *)
            | "Part" _ digits _ "of" _ app_name
            | app_name _ ( "note" | "table" _ digits _ "row" _ digits | ( "part" | "Part" ) _ digits [ _ "row" _ digits ] )   (* "Appendix A table 2 row 5", "Appendix E part 2 row 4" (8c-84 #3) *)
            | app_name
            | "Appendix" [ _ digits ] ;                               (* letterless: malformed, fails closed *)
clause_word = "clause" | "clauses" | "cl" | "cl." ;                   (* "cl" is NOT an SO form; see G-CL *)
open_range  = ( so_mention | sr_mention ) _? ( "et seq" ["."] | "ff" ["."] | "and following" ) ;
xref_suffix = mention _? "(" "referred to in" _ mention ";" _ "not retrieved" ")" ;
title       = ( "Standing Orders" | "Speakers' Rulings" [ _ "Supplement" ] ) _ YEAR ;

(* ---------- joiners: ONE production for prose lists and bracket splitting ---------- *)
joiner      = _? ( "," [ _ ("and"|"or") ] | ";" | ":" | "and" | "or" | "&" | "+"
                 | "see" | "see also" | "cf." | "cf" | "with" ) _? ;  (* includes the v0 B5 splitters *)
range_op    = _? ( DASH | "to" | "through" ) _? ;

(* ---------- quantities: never provisions ---------- *)
quantity    = number _? unit
            | number _ ("or more"|"or fewer"|"or less") _ ( unit | gated_noun )
            | count_noun_after_singular_comma                          (* G-COUNT *)
            | clock
            | ruling_num _ "majority" | spelled_fraction [ _ "majority" ] ;   (* "2/3 majority", "two-thirds" *)
number      = digits | spelled_cardinal ;
unit        = people_unit | time_unit | "per cent" | "percent" | "%" | "vote" | "votes" | "time" | "times" ;
people_unit = "member" | "members" | "MP" | "MPs" | "people" | "person" | "persons" ;
time_unit   = "second(s)"|"sec(s)"|"minute(s)"|"min(s)"|"hour(s)"|"hr(s)"|"day(s)"|"calendar day(s)"|"working day(s)"|"sitting day(s)"|"week(s)"|"month(s)"|"year(s)" ;
                                                                       (* a unit followed by APOS is NOT a unit (G-FOLLOW c) *)
gated_noun  = "bill(s)" | "question(s)" | "motion(s)" | "amendment(s)" | "reading(s)" | "speaker(s)" | "party" | "parties" ;
clock       = hour12 _? ( "am" | "pm" | "a.m." | "p.m." | "o'clock" ) | "12" _ "noon" ;

(* ---------- brackets ---------- *)
bracket     = "[" content ( "]" | IMPLICIT_CLOSE ) ;
IMPLICIT_CLOSE = lookahead( "[" | NEWLINE | END ) ;
content     = part { joiner part } ;
part        = citation_part [ _? year_q ] | quantity | editorial | residue ;
citation_part = so_mention | sr_mention | app_mention | so_slash | open_range
              | so_number                                             (* continues the previous prefix: "[SO 1, 2]" *)
              | pin                                                   (* continues the previous label: "[SO 39(1) and (2)]" *)
              | backref | prefix_only ;                               (* "[SO]", "[Appendix]", "[ibid]" alone *)
editorial   = text with no digit, number word or prefix ("see note", "ibid" beside a label, "quorum", te reo words, a URL) ;
residue     = any other text containing a digit or number word        (* "para 2", "at 2", "note 99" *) ;
```

### 2.1 Disambiguation (priority order)
1. **G-WHOLE.** Numbers are taken whole. `SO 1234567` is never SO 1, and `12/9` is never 12 or 9.
2. **G-YEAR.** A parenthesised 4-digit token from 1800 to 2099 directly after a label is always `year_q`, never a `pin`. So `SO 39(2020)` is SO 39 qualified by the year 2020. It is not subclause 2020. Whether the qualifier is neutral or fails closed is decided by P-YEAR (§4).
3. **G-NOSLASH (Q2, 8c-81; OO-DEF-101 is a fix).** No SO number contains a slash. Every `so_slash` is **ungrounded**, even when ruling N/M is admitted. This covers `SO 2/9`, `S.O. 12/34`, `Standing Order 2/9`, `Standing Orders 1/99`, `SO 12 /9`, `SO 1⁄9`, `SO 12(2)/9` and `SO 1/2/3`. Only a bare `N/M` and `SR`-family prefixes (`SR`, `S.R.`, `Speakers' ruling`, `Ruling`) name a ruling. Inside an SO list (`Standing Orders 1, 23/4`), the N/M item is a `so_slash` and is ungrounded.
4. **G-SR (Q1).** `N/M`, `SR N/M` and the long forms are one canonical ruling `R N/M`. Each grounds when **either** the bare label `N/M` or `SR N/M` is admitted. A ruling never collapses to its numerator.
5. **G-FOLLOW.** In a list, a number followed by a quantity ends the list (`SO 1, 40 members`; `SO 1 to 3 days`):
   - (a) A `unit` is a follower when bare. A `gated_noun` is a follower only after `or more`, `or fewer` or `or less`, or under G-COUNT.
   - (b) `am`/`pm` makes a clock time only after an hour from 1 to 12.
   - (c) **Q3 amended (8c-83 #4; reverses 8c-80):** a **time unit** followed by APOS **is** a follower. So `7 days’ notice`, `2 weeks' notice` and `3 months' notice` are quantities and never ground an SO, even when that SO number is admitted (`Under SO 1 and 7 days’ notice`, with SO 7 admitted, does not cite SO 7). The same holds for spelled numbers (`seven days’ notice`).
     - A **people unit** followed by APOS is still not a follower (`99 Members' bills`), so the number continues the list and is graded as a provision.
   - (d) A hyphenated compound is not a follower (`99 member-led`).
   - (e) **Q3 (8c-81):** `N/M` is a quantity only before `majority`. `a 2/3 vote` is still ruling 2/3, because ruling 2/3 exists.
6. **G-COUNT (8c-81 #10).** After a **singular** prefix mention, `"," number speaker(s)|party|parties` is a count (`Under SO 1, 3 parties may object`). Source practice never uses a singular prefix for comma lists. After a plural prefix, or after `and`/`or`/`&`/a range operator, these nouns stay gated (`SO 1 and 3 parties` names SO 3).
7. **G-ADVERB.** A lower-case `so`, or a sentence-initial `So` (N6), followed by a quantity is the adverb. `so N` without a quantity is a mention, so it fails closed. Upper-case `SO` is always a prefix.
8. **G-LIST.** Every list member is graded on its own. A list is never admitted on its first number.
9. **G-RANGE.** SO ranges `a DASH|to|through b` expand to the integers a..b. A range that is reversed or wider than 100 is one ungrounded part.
10. **G-RRANGE.** A ruling range `N/M–P/Q` is **not** expanded, because ruling entries are not contiguous integers. It is one part. The later target: it grounds only when an ordered ruling index exists and every entry from N/M to P/Q is in it and admitted. **Until a ruling index exists it fails closed (8c-82, deferred; §4.1).** A short continuation (`SR 2/3 to 5`) is unspecified and fails closed.
11. **G-OPEN.** `et seq.`, `ff.` and `and following` add an open-range part that is always ungrounded (OO-DEF-085). The base label is graded on its own.
12. **G-SPELLED.** Spelled cardinals and ordinals attached to a prefix are numbers.
13. **G-CL.** `cl` is a statute-schedule abbreviation, not an SO form. It is parsed only so that the mention can be graded (D2: never ignore a form that might be authority). A `cl` mention grounds only when it exactly matches an admitted label written with `cl`, the house label form (`Appendix D cl 1`). The forms `clause N of Appendix X` (SO 2026 wording) and `Appendix X, clause N` (the SR 2023 editorial form; it does not occur in SO 2026) canonicalise to the same clause.
14. **G-TITLE (8c-81 #8).** `Standing Orders 2026` and `Speakers' Rulings 2023` are the current titles and are neutral. Any other year (`Standing Orders 2023`, `Standing Orders 2020`, `Speakers' Rulings Supplement 2019`) is a **superseded title**: one ungrounded part, so it is not current authority.
15. **G-XREF (Q5, 8c-74).** Batch 3 keeps cross-references fail-closed. A mention with a `(referred to in X; not retrieved)` suffix is graded like any other mention, so an unretrieved provision is ungrounded however the suffix reads. A false suffix on an **admitted** provision is **stripped** and the provision stays grounded, as main does now (L2051).
    - The referrer inside a suffix (`SO 1` in `(referred to in SO 1; not retrieved)`) is **not a separate mention**. It is neither graded nor credited (OO-DEF-117, row mutation_probe-012).
    - **Part statuses are closed (v1.2 #4):** `grounded`, `ungrounded` or `not_citation`. There is no `qualified_xref` status. In Batch 3 an unretrieved provision carrying a suffix is `ungrounded` (xref_suffix-004/010; their verdicts are unchanged).
    - Verified cross-references are a later target, deferred under Q5. They need the referrer's source text, normalised by N1, at check time. Even when verified, they would license only a pointer claim ("SO 1 refers to SO 99"), never an assertion about what the unretrieved provision does (D1).

## 3. Brackets: structure
- **B1** A `]` with no open bracket is a stray and is ignored.
- **B2** An unclosed `[` closes at the next `[`, newline or end of text. It never swallows the next bracket (OO-DEF-084).
- **B3** `[[X]]` is one bracket. In `[A [B]]`, B is a part of the outer bracket.
- **B4** Empty `[]` is not a bracket. A blank `[ ]` is not a citation.
- **B5** Parts are separated only by the `joiner` production in §2.
- **B6 (deferred-quote).** The SR text contains editorial insertions such as `[Standing Order 236]`, and the SO text contains pointers such as `[Revoked – see Standing Order 134(5)]`. Inside text that the answer quotes, these are not the answer's own citations.
  - Recognising quotation scope is **out of Batch 3 scope**. In Batch 3 such brackets are graded like any other bracket, which fails closed: the 2023 numbering in an SR insertion is graded against 2026 admissions.
  - The corpus tags these rows `deferred-quote` and records the later target.

## 4. Grounding
- **Admitted set A.** These are the canonical forms (CPK, §4.1) of the request's admitted labels.
  - The SO pack's label shapes (8c-84 #3) are `SO n`, `Appendix X cl N` (including `cl 8A` and `cl 1AA`), `Appendix A note`, `Appendix A table T row R` and `Appendix E part P row R`. Rulings are `N/M`.
  - The pack has **no whole-appendix label** (`Appendix B`), so a bare `Appendix X` part never grounds from a clause admission.
- **Provision tree T.** For each admitted label, T is the set of its existing subdivisions, taken from the admitted source text after N1. A label without an entry has an **unknown** tree. Where T comes from is set by §4.1.
- **R set (8c-83 #3, 8c-84 #2).** R is **derived from the source**: every section, and every structural subdivision, whose text after N1 starts with `[Revoked`. It is also **listed explicitly**, and the derived set must equal the list:
  - Revoked SOs: 135, 136, 150, 208, 265, 282, 283.
  - Revoked subdivisions: **SO 300(4)**, **SO 408(3)**, **Appendix B cl 15**, **Appendix B cl 19**.
  - A revoked node is never added to T, and its pointer text (`[Revoked – see …]`) never adds nodes to T.

**Part status.**
1. **P-REVOKED (8c-81 #7, 8c-83 #3).** A part naming a provision or subdivision in R is **ungrounded**, even if that provision, or its parent, is admitted. Its pointer target (for example 263A for 265) is a different provision and is graded on its own.
2. **P-EXACT.** A part whose canonical form is in A is **grounded**.
3. **P-EXIST (8c-81 #1).** A descendant pinpoint grounds **only if it exists in T** under an admitted ancestor. Descendants are SO `n(k)`, `n(k)(x)` and `(aa)`, ruling `N/M(k)`, and clause pins `APP X cl n(k)(x)`.
   - Ruling pinpoints `N/M(k)` are deferred: they fail closed until a ruling index exists (§4.1).
   - So, with SO 39 admitted and T = {(1), (1)(a)–(c), (2)}: `SO 39(1)(c)` grounds, while `SO 39(3)` and `SO 39(1)(aa)` are ungrounded.
   - An unknown tree fails closed: every descendant is ungrounded.
   - **No parent-level credit**, with no exceptions (8c-83 #2 removed the P-NOTE exception). A non-existent pinpoint does not ground its parent. The parent grounds only where it is cited as its own part, for example `[SO 1 and (99)]`, which is SO 1 grounded plus SO 1(99) ungrounded, so partial.
   - An ancestor is never grounded by a descendant: `[SO 39]` with only `SO 39(1)` admitted is ungrounded.
4. **P-NOTE (8c-83 #2; overrides 8c-81 #5).** An `Appendix X note` part grounds only if that appendix actually contains a note and the note is admitted (pack label `Appendix A note`).
   - Only Appendix A has a note.
   - Any other `Appendix X note` is **ungrounded**. It is not capped at the appendix, and it gets no parent-level credit, so there is no longer any parent-level exception to P-EXIST.
5. **P-YEAR (Q4; 8c-82 and 8c-83 #1, replacing the 8c-80 reading).** A `year_q` after a label is graded per instrument:
   - The **current edition year** is a neutral qualifier, preserved for display (D4). That is `(2026)` after an SO or appendix label and `(2023)` after a ruling label. The label is graded on its own. So `[SO 1 (2026)]` grounds when SO 1 is admitted, and `[48/2 (2023)]` or `[SR 48/2 (2023)]` grounds when ruling 48/2 is admitted.
   - **Any other year** binds to the label as **one** part, and that part is **ungrounded**. This includes the other instrument's year: `(2026)` qualifies only the SO (and its appendices), and `(2023)` only the SR. So `[SO 1 (2023)]` and `[48/2 (2026)]` are both ungrounded (rows edition-008/009). So `[SO 1 (2019)]` and `[SR 48/2 (2019)]` are ungrounded brackets.
   - The current years are the same ones G-TITLE treats as current titles (`Standing Orders 2026`, `Speakers' Rulings 2023`).
6. **Not citations.** Quantities, editorial text, titles that are current, URLs and word-only brackets are `not_citation` and neutral. A backref beside a grounded part is editorial. Alone (`[ibid]`) it is ungrounded.
7. **Residue.** Everything else is ungrounded: prefix-only parts, orphan pins, bare number markers, open ranges, `so_slash`, malformed appendices and numeric residue (`para 2`; `para` is not an SO pinpoint form).

### 4.1 Interface requirements (8c-82, 8c-83 #5, 8c-84 #1)
- **Real provision trees.** The existence check (P-EXIST, P-NOTE) must use provision trees derived from the **admitted corpus source**, i.e. the fixed SO source fixture that the product already admits.
  - T is built from the admitted 2026 edition text only. Per-edition trees are not needed, because a non-current year never grounds (P-YEAR).
  - The structure is still to be **confirmed against the official published source document**. The answer-key author does this in the answer-key work package.
- **Validator interface.** The citation and mention validators receive, per admitted authority, `{ citationLabel, sectionContent }`, or a tree precomputed from that content.
  - `sectionContent` is the full section text the route already holds in `finalAuthorities[].sectionContent`.
  - T is **never** built from draft chunks, retrieved excerpts, model output or the draft.
  - A missing or empty `sectionContent` means an **unknown tree**, so every descendant fails closed.
- **Tree-building rule.**
  1. Apply N1 to the section text first, including the delete and join rules.
  2. **Only structural markers count.** A structural marker is a parenthesised marker at the start of a paragraph or line that opens that paragraph. Inline parenthesised references are never nodes. For example, `Standing Order 254(2)(a)` inside SO 67 does not make `SO 67(2)` exist. In the current fixture, 25 provisions contain an inline parenthesised token that is not a node of their own tree. The count is 29 if tokens that happen to coincide with a real node are included. Examples: SO 3, 67, 192, 243 and 276.
  3. **Nesting** goes number (`(1)`, `(1A)`, `(2A)`), then letter (`(a)`, and inserted double letters `(aa)`, `(ab)`, `(ba)` at the same level), then roman (`(i)`, `(ii)`). A letter list with no number above it hangs directly off the section (`SO 67(d)`).
  4. **Roman versus letter.** `(i)` straight after `(h)` is a **letter**, as in Appendix C cl 4(2)(h), (i). Otherwise `(i)` opens a roman list, and a later roman token is roman only when it continues that list.
  5. **Literal labels, literal order (8c-83 #5).** Inserted paragraphs are literal text and can sit out of alphabetical order. `(ab)` follows `(a)` in SO 146(4), while `(aa)`/`(ab)` precede `(a)` in Appendix C cl 4(2). Take labels from the text, never from a numbering sequence or by generating them alphabetically.
  6. **Repeated letters fail closed (8c-84 #1 as scoped by 8c-86).** A parent is a numbered paragraph, or the provision itself when a letter list hangs directly off it.
     - Where a letter is **truly repeated under one parent**, **every** pinpoint under that parent is ambiguous (8c-86 whole-parent reading). That includes letters that occur only once. They are left out of T with their descendants.
     - The parent itself is unaffected. So `SO 3(1)(c)` and `SO 3(1)(e)` are ungrounded, while `SO 3(1)` grounds.
     - `Appendix F cl 2` has no numbered paragraphs, and its letters repeat directly under the clause, so `[Appendix F, clause 2(a)]` is ungrounded.
     - The rule defines the scope, not a count. The current fixture has **3** such parents: SO 3(1), App B cl 2(1) and App F cl 2.
     - **Roman lists that restart under different letters are under different parents**, so they nest normally and ground: SO 35(2), SO 144(7), SO 266(1), App B cl 5(1) and App B cl 8(1). For example, `SO 35(2)(c)(ii)` grounds.
  7. **Revoked nodes** (text starting `[Revoked`) go to R, never to T.
- **Canonical provision key (CPK) notation.** T's keys and entries, and A, use one notation:
  - SOs: `SO n` and `SO n(k)(x)(r)`, e.g. `SO 39(1)(a)`, `SO 300(1A)(a)`.
  - Rulings: `R n/m` and `R n/m(k)`. `48/2`, `SR 48/2` and the long forms all map to `R 48/2`.
  - Appendix clauses: `APP X cl N` and `APP X cl N(k)…`, e.g. `APP C cl 4(2)(aa)`, `APP B cl 8A`.
  - Other appendix labels: `APP A note`, `APP A table T row R`, `APP E part P row R`.
  - The corpus field `provision_tree` uses CPK.
- **Synthetic, partial and fixture trees in the corpus.**
  - `synthetic-tree` (20 rows): the verdict depends on a hand-written `provision_tree`. Regenerate the tree and re-check the label when real trees exist. A label that changes then is a fixture correction, not a grammar change.
  - `partial-tree` (6 rows): truncated trees for App C cl 4, SO 212A and App D cl 5. Each row's label is right, but the tree is **not reusable** as a fixture, because e.g. `SO 212A(1)` would wrongly fail closed. Marked `provision_tree_status`.
  - `fixture-tree` (25 rows; v1.3 adds subclause-004/005/010 and mutation_probe-009): the tree was derived from the fixture's section text by a reference build of this rule. It is still subject to confirmation against the official document.
  - `unknown-tree` (1 row, tree_build-011): deliberately no tree, to probe the unknown-tree fail-closed rule.
- **Ruling index (deferred, Q5 family).** Ruling pinpoints (`2/3(2)`, `SR 2/3(1)`) and ruling ranges (`2/4–3/1`, `237/4–238/5`, `SR 2/3 to 5`) need an ordered ruling index with per-ruling paragraphs. None exists yet.
  - Until one does, every such part **fails closed** (ungrounded) in Batch 3, even when the bare ruling is admitted.
  - Rows are tagged `deferred-ruling-index` (7 rows). The later target is in each row's `deferred.later_target`.

**Bracket class.**
- `grounded`: at least one grounded part and none ungrounded.
- `partial`: at least one grounded part and at least one ungrounded part.
- `ungrounded`: at least one ungrounded part and none grounded.
- `not_citation`: no citation part.

**Row verdict (corpus field `grounded`).** Over all bracket parts and prose mentions: `yes` when there is at least one grounded part and none ungrounded, `partial` when there are both, `no` otherwise. A row whose only bracket is `not_citation` is **uncited**, so it is `no` (D1).

## 4.2 Rule-level reason codes (v1.3, 8c-87 #1)
Every grammar outcome has exactly one code. The enum is **closed**: a parser must emit only these identifiers, and a new outcome needs a ruling and a new code. Codes are fixed identifiers; they never carry draft, answer, query or source text, or anything derived from it.

**Part codes.** One code per part, in the order of `expected.mentions` (each bracket part and each prose mention).
- A part's code is fixed by its status, then by the first rule below that decides it.
- `grounded` parts: `grounded` when the canonical form is admitted (incl. a fully admitted SO range), `grounded-pinpoint` otherwise (P-EXIST).
- `not_citation` parts: `quantity`, `grounded-qualifier` (the current-edition year, P-YEAR) or `neutral`.
- `ungrounded` parts, in decision order:
  1. Deferrals first, by row tag:
     - `deferred-ruling-index`: a ruling pinpoint or range.
     - `deferred-Q5`: a prose mention.
     - `deferred-quote`: a bracket part.
  2. Then: `ungrounded-edition`, `ungrounded-superseded`, `ungrounded-open-range`, `ungrounded-residue`, `ungrounded-misattributed`, `ungrounded-revoked`, `ungrounded-range`.
  3. For a pinpoint under an admitted ancestor:
     - `unknown-tree` if the ancestor's tree is unknown;
     - `ambiguous-tree` under rule 6;
     - otherwise `ungrounded-nonexistent`.
  4. An appendix note other than Appendix A's is `ungrounded-nonexistent` (P-NOTE).
  5. Everything else is `ungrounded-not-admitted`.

| Code | Definition | Emitted by | Parts |
|---|---|---|---|
| `grounded` | part's canonical form is an admitted label (incl. an SO range all of whose members are admitted) | P-EXACT, G-SR, G-RANGE | 401 |
| `grounded-pinpoint` | pinpoint that exists in T under an admitted ancestor | P-EXIST, §4.1 | 35 |
| `grounded-qualifier` | current-edition year qualifier on a label: (2026) after SO/appendix, (2023) after a ruling; neutral, preserved | P-YEAR, G-YEAR | 2 |
| `quantity` | a quantity, count, clock time or fraction-majority; never a provision | quantity production, G-FOLLOW, G-COUNT, G-ADVERB | 58 |
| `neutral` | editorial text, a current instrument title, a URL, a backref beside a grounded part, or the referrer inside an xref suffix | §4 Part status 6, G-TITLE, G-XREF | 21 |
| `ungrounded-not-admitted` | well-formed label that is not admitted and has no admitted ancestor (incl. whole-appendix and non-pack forms) | P-EXACT, G-WHOLE, G-LIST, G-CL, §4 admitted set | 141 |
| `ungrounded-nonexistent` | pinpoint or appendix note under an admitted ancestor that does not exist in a known T | P-EXIST, P-NOTE | 20 |
| `ambiguous-tree` | pinpoint under a parent with a truly repeated letter (whole-parent reading) | §4.1 rule 6 (8c-86) | 4 |
| `unknown-tree` | pinpoint under an admitted ancestor whose tree is unknown (no section content) | P-EXIST, §4.1 interface | 2 |
| `ungrounded-revoked` | names a provision or subdivision in R | P-REVOKED | 11 |
| `ungrounded-edition` | label bound to a non-current or cross-instrument year | P-YEAR, G-YEAR | 7 |
| `ungrounded-superseded` | superseded instrument title cited as authority | G-TITLE | 2 |
| `ungrounded-misattributed` | SO prefix with a slash number (so_slash); no SO number has a slash | G-NOSLASH | 15 |
| `ungrounded-open-range` | et seq. / ff. / and following | G-OPEN | 7 |
| `ungrounded-range` | SO range that is reversed or wider than 100 | G-RANGE | 4 |
| `ungrounded-residue` | prefix-only part, orphan pin, bare number marker, malformed appendix, numeric residue (para N), backref alone | §4 Part status 7, B-rules | 24 |
| `deferred-ruling-index` | ruling pinpoint or ruling range; fails closed until a ruling index exists | G-RRANGE, P-EXIST (8c-82 #2) | 7 |
| `deferred-Q5` | unretrieved provision carrying a cross-reference suffix in a row whose later target is a verified pointer | G-XREF (Q5, 8c-74) | 6 |
| `deferred-quote` | bracket inside quoted source text graded as the answer's own citation in Batch 3 | B6 (8c-81 #9) | 2 |

**Bracket code.** One entry per `expected.brackets` item. A `not_citation` bracket is `neutral-bracket` (23 brackets); every other bracket has `null`, because its parts carry the codes.

**Row rollup.** `row` is the first code present among the parts, in this precedence order (false-authority traps first, deferrals last):
`ungrounded-revoked` > `ungrounded-misattributed` > `ungrounded-nonexistent` > `ambiguous-tree` > `ungrounded-edition` > `ungrounded-superseded` > `ungrounded-open-range` > `ungrounded-range` > `ungrounded-not-admitted` > `ungrounded-residue` > `unknown-tree` > `deferred-ruling-index` > `deferred-Q5` > `deferred-quote` > `grounded-pinpoint` > `grounded`.
- If no part has any of these codes, `row` is `uncited` (the row is `no` under D1).
- The rollup does not change `grounded`. It names the deciding rule.

**Not codes.**
- `partial-tree` is a corpus tag on a truncated fixture tree; no grammar rule emits it. A part in such a row gets the code its rule gives.
- There is no `bracket-malformed`: B1–B4 normalise every bracket structure into parts, and an unclosed or doubled bracket is graded by its parts.

**Corpus field** `expected_rule_codes = {"parts": [...], "brackets": [...], "row": "..."}`. Main 254d6e4 exposes no rule-level reason, so `main_254d6e4.rule_codes` is `"n/a"` on every row. It is not compared. `expected_reason_code` remains the route-outcome code (§5).

Counts over the v1.3 corpus (419 rows), by row rollup: `ungrounded-not-admitted` 138, `grounded` 124, `grounded-pinpoint` 27, `ungrounded-residue` 24, `uncited` 20, `ungrounded-nonexistent` 20, `ungrounded-misattributed` 15, `ungrounded-revoked` 10, `deferred-ruling-index` 7, `ungrounded-edition` 7, `ungrounded-open-range` 7, `deferred-Q5` 6, `ambiguous-tree` 4, `ungrounded-range` 4, `deferred-quote` 2, `ungrounded-superseded` 2, `unknown-tree` 2.

## 5. Divergences from main 254d6e4 (v1.3 corpus, 419 rows)
These are detector-level counts; LLM and claim-pruning steps are not included.
- **Comparison point (since v1.1).** Main's verdict is taken **after its rewrite step**. An admitted mention whose false `not retrieved` suffix is stripped counts as grounded. Each placeholder the rewrite inserts counts as one ungrounded mention.
- **Three comparisons per row (v1.2, 8c-86 b):**
  1. Row verdict.
  2. **Grounded label set** in CPK (`expected_grounded_cpk` against main's). Main's set is read from its grounded brackets and its passing mention spans. A token counts only if it is an admitted label or a pinpoint under one, so a quantity or year inside a bracket grounded on SO 1 is not a grounding.
  3. **Reason code** (`expected_reason_code` against main's route outcome). Main exposes no per-rule reason, so the code is the route outcome: `served`, `rewritten`, `withheld_invalid_citations` or `served_no_authority`. The expected code is the outcome this grammar implies under the **current, unchanged** policy (§6).
- **Disagreement classes:** `main_more_permissive` and `main_more_restrictive` (the verdicts differ), and **`verdict_agree_grounding_disagree`** (the verdicts agree but the grounded label sets differ). Reason-code differences are reported separately and do not form a class.
- **All 419 rows:** **255** agree. **67** are permissive, **74** restrictive, and **23** are verdict-agree / grounding-disagree.
- **Leaving out the 17 deferred rows (402 rows):** **243** agree, **63** permissive, **73** restrictive, **23** verdict-agree / grounding-disagree.
- **Changes from v1.2 (8c-87 #2):**
  - subclause-010 moves from restrictive to agree.
  - subclause-005 and mutation_probe-009 move from agree to pinpoint-level grounding disagreement, because main serves `SO 39(2)` / `SO 39(1)` as `SO 39`.
  - The new mutation_probe-013 is restrictive: main fails the whole bracket, and the grammar gives `partial`.
- **Verdict-agree / grounding-disagree, by kind:**
  - **3 where main grounds an extra provision (false authority):** quantity_follower-022/024/025 (OO-DEF-108). Main reads `SO 1 and 7` as a list and grounds the admitted SO 7.
  - **3 where main grounds fewer provisions:** lists-004, ranges-002 and mixed-005. Main's all-or-nothing list check drops SO 2 or SO 3, which the grammar grounds part by part. Both verdicts are `partial`.
  - **17 at pinpoint level only.** Main normalises a cited pinpoint to its parent label (`[SO 39(1)]` is served as `[SO 39]`), or misses a continued pinpoint (`212A(4) and (5)`). These are D4 qualification losses, not false authority.
- **Reason codes:** 19 rows agree on verdict and grounding but differ on reason code. In 18 of them (bracket_quantity-001…009 and not_citation-001…009), main withholds an answer whose only bracket is not a citation; the grammar treats such a bracket as neutral. In bracket_structure-002, the grammar implies a withhold and main rewrites.

Permissive divergences, by register entry:

| Entry | What main does |
|---|---|
| OO-DEF-048 | Does not see spelled-out numbers, ordinals or the unusual prefix forms. |
| OO-DEF-085 | Grounds text after an admitted label: `et seq.`, `ff.`, spelled secondary references, `note 99`, `Appendix 99`. |
| OO-DEF-065, OO-DEF-100 | Reads a Unicode slash, or a spaced or pinned slash, as SO N. |
| OO-DEF-101 | Accepts `SO N/M` as a ruling. |
| OO-DEF-102 | Grounds non-current edition years (`(2019)` on an SO or a ruling). The current year now agrees (P-YEAR, 8c-82). |
| OO-DEF-103 | Accepts a ruling range continuation. |
| OO-DEF-099 | Treats `99 PM` as a clock time. |
| OO-DEF-079 | Treats `member-led` as a people count. |
| OO-DEF-080 | Treats speakers/parties after `and` or a plural prefix as quantities (narrowed by G-COUNT). |

New since v1:

| Rule | What main does |
|---|---|
| P-EXIST | Grounds non-existent pinpoints. |
| P-REVOKED | Grounds revoked SOs. |
| Gated count | Treats `SO 1 and 3 parties` as a count. |
| Ruling index (v1.1, deferred) | Grounds ruling pinpoints such as `2/3(2)`, which fail closed until a ruling index exists. |
| P-YEAR per instrument (v1.1) | Grounds `[SO 1 (2023)]` and `[48/2 (2026)]`. |
| P-REVOKED subdivisions (v1.1) | Grounds `SO 300(4)` and `SO 408(3)` through the subclause fallback. |
| Tree build (v1.1) | Grounds inline-reference markers (`SO 67(2)`), ambiguous restarted letters (`SO 3(1)(c)`) and pinpoints with no section content. |
| Q3 amended (v1.1) | Grounds an admitted SO number before a time-unit possessive (parse level). |

Restrictive divergences:
- the `[SR 48/2]` family (OO-DEF-087) and official appendix forms;
- all-or-nothing brackets;
- quantity brackets split from their label;
- unclosed and doubled brackets;
- `2/3 majority`;
- the adverb `so`;
- time-unit possessives as quantities (Q3 amended);
- inserted paragraphs `(ab)`, clause suffixes `cl 1AA`, and N1's delete and join rules (e.g. `[\u200bSO 1]`, `SO 212\u200bA(4)`).

## 6. What the grammar implies for policy (not changed here)
- D3 means a `partial` bracket keeps its grounded parts and drops or discloses the ungrounded ones. Main withholds the whole answer on any failing bracket (`invalid_citations`). Changing that is a **separate validation-policy spec**. The restrictive divergences become wins only once that spec exists.
- Batch 3 ships the detector first.

## 7. Open items
- **P-YEAR** is settled by 8c-82 and 8c-83 #1 (per instrument).
- **Repeated letters** are settled by 8c-86 (rule-defined scope, whole-parent reading).
- **Real provision trees and ruling index** (§4.1).
  - Re-check the 20 `synthetic-tree` rows when real trees exist, and replace the 6 `partial-tree` trees.
  - Re-label the 7 `deferred-ruling-index` rows to their `later_target` when a ruling index exists.
- **G-COUNT vs register entry OO-DEF-080.** Under 8c-81 #10, a count after a singular-prefix comma is a quantity. Under OO-DEF-080, the gate stays for every other position.
- **Equivalent mutants** M05, M14, M17, M20 and M24 are recorded as equivalent. No further effort is planned (Q6).
- **M19** is killed by mutation_probe-012 (OO-DEF-117).
- **Non-pack admitted labels:** resolved in v1.3 (8c-87 #2).
  - subclause-004/005/010 and mutation_probe-009 now admit `SO 39`. No corpus row admits a label that the pack never produces.
  - M16 is guarded by mutation_probe-013 (an orphan pin at the start of a bracket), which is the only path to it with pack labels.
  - The v1.2 probes "parent cited, only child admitted" and "sibling not admitted" cannot arise with pack labels. The ancestor rule stays in §4, and the nonexistent-sibling case is subclause-008.

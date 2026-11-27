# PR15 forum-identity spec v2.30 (engineer-safe)

v2.30 = v2.29 plus public rows S-324 to S-344. The rows are proposed as binding from r5v. S-328 is deferred ('proposed, pending ruling', 8c-34) and is not graded. v2.29 is left unedited, and no v2.29 expectation changes.

## Oracle
The oracle is v2.29 plus addendum 8c supplements 6 and 7 (8c-30 to 8c-39; file sha dd045b31…).
- **8c-30.** 'Withheld' at a whole-House-family leaf is the code's reject. This is the existing outcome mapping, so no change.
- **8c-31.** Under a family heading alone, a Committee-of-the-whole or family-member setting is supported, and a named committee is qualified (S-302, S-303, S-319; new rows S-324 and S-325).
- **8c-32.** 8c-27 applies only when the setting IS a family phrase. This was already the v2.29 reading.
- **8c-33.** 'her' is a possessive determiner (non-content) only directly before a class word or COMMITTEE. Elsewhere it is a pronoun and therefore content (8c-7), so 'COMMITTEE FOR HER' is named. This is an oracle change. v2.28 and v2.29 treated 'her' as non-content everywhere, and no earlier row depended on it.
- **8c-34 (PROPOSED).** A generic committee setting under a family heading alone is qualified (S-328, deferred). The rationale is below.
- **8c-35.** 8c-21 is general. Every generator-emitted seed word is the name word when it is the only word before SELECT, SUBJECT or COMMITTEE, and an own heading matches. The emitted set at b3267e19 has 30 words:
  - `lib/domain-vocabulary-data.js` `headingPrefixes` (23 words), emitted by `scripts/gen-corpus-proceedings.ts` `renderDomainVocabularyModule` from `scripts/generator-seeds.ts` `HEADING_PREFIX_SEED`;
  - `lib/corpus-proceedings-data.js` `corpusProceedingHeads` (9 words), emitted by `renderCorpusProceedingsModule` from `PROCEEDING_HEAD_NOUNS`;
  - 2 words (motion, question) are in both.

  The oracle's named test already counted these words as content, so no change.
- **8c-36.** 8c-21 does not reach across 'of'. A seed word directly followed by 'of' names the proceeding, so 'REPORT OF SELECT COMMITTEE' is generic and a generic setting under it is supported. This is an oracle change.
- **8c-37 / 8c-38 / 8c-39.** Code and Batch-2 log items, with no forum-row outcome.
- **Zero drift** on any v2.16 or v2.21–v2.29 row, in either portion, on the corpus matrix v1.2 and on the self-match. No existing row changes under 8c-33 or 8c-36.

## 8c-34 proposal: generic setting under a family heading alone → qualified_partial
A family heading ('HOUSE IN COMMITTEE', or the canonical COMMITTEES OF THE WHOLE HOUSE) gives its subtree Committee-of-the-whole identity (8c-11). The source therefore governs one particular committee forum. A generic setting ('a committee') asks about committees as a class, so the source is narrower authority than the question: it can support the answer only for that forum, which is qualified, not supported. This mirrors 8a in the other direction. Under 8a, a CotWH setting under a generic plural heading is match, because the narrower setting sits inside the broader heading. A bare COMMITTEE OF THE WHOLE is qualified, because the identity is incomplete. The value is not withheld, for two reasons. First, ancestors only cap and never withhold (A3, Ruling B, 8c-25). Second, the Committee of the whole House is a committee, so it is not a different body. Qualified also equals what 8c-31 gives a named committee under the same heading. So the family heading caps every committee-type setting except the family's own identity (CotWH or a family-member setting), which is match. At b3267e19 the code gives uncertain (= qualified) for this shape.

## New shared rows (both routes)
| Row | Setting | Path | Expected | Clause |
|---|---|---|---|---|
| S-324 | the House in committee | Chapter 2 > HOUSE IN COMMITTEE > SO 5 > Time limits | supported | 8c-31 |
| S-325 | Gadget Review Committee | Chapter 2 > HOUSE IN COMMITTEE > SO 5 > Time limits | qualified_partial | 8c-31 |
| S-326 | a committee | Chapter 4 > HER COMMITTEE > SO 5 > Meetings | supported | 8c-33 |
| S-327 | a committee | Chapter 4 > COMMITTEE FOR HER > SO 5 > Meetings | qualified_partial | 8c-33 |
| S-328 | a committee | Chapter 2 > HOUSE IN COMMITTEE > SO 5 > Time limits | qualified_partial (deferred: proposed, pending ruling) | 8c-34 (PROPOSED) |
| S-329 | a committee | Chapter 4 > MOTION SELECT COMMITTEE > SO 5 > Meetings | qualified_partial | 8c-35 |
| S-330 | Motion Select Committee | Chapter 4 > MOTION SELECT COMMITTEE > SO 5 > Meetings | supported | 8c-35 |
| S-331 | a committee | Chapter 4 > MOTION SUBJECT COMMITTEE > SO 5 > Meetings | qualified_partial | 8c-35 |
| S-332 | Motion Subject Committee | Chapter 4 > MOTION SUBJECT COMMITTEE > SO 5 > Meetings | supported | 8c-35 |
| S-333 | a committee | Chapter 4 > QUESTION SELECT COMMITTEE > SO 5 > Meetings | qualified_partial | 8c-35 |
| S-334 | Question Select Committee | Chapter 4 > QUESTION SELECT COMMITTEE > SO 5 > Meetings | supported | 8c-35 |
| S-335 | a committee | Chapter 4 > QUESTION SUBJECT COMMITTEE > SO 5 > Meetings | qualified_partial | 8c-35 |
| S-336 | Question Subject Committee | Chapter 4 > QUESTION SUBJECT COMMITTEE > SO 5 > Meetings | supported | 8c-35 |
| S-337 | a committee | Chapter 4 > DEBATE SELECT COMMITTEE > SO 5 > Meetings | qualified_partial | 8c-35 |
| S-338 | Debate Select Committee | Chapter 4 > DEBATE SELECT COMMITTEE > SO 5 > Meetings | supported | 8c-35 |
| S-339 | a committee | Chapter 4 > DEBATE SUBJECT COMMITTEE > SO 5 > Meetings | qualified_partial | 8c-35 |
| S-340 | Debate Subject Committee | Chapter 4 > DEBATE SUBJECT COMMITTEE > SO 5 > Meetings | supported | 8c-35 |
| S-341 | a committee | Chapter 4 > AMENDMENT SELECT COMMITTEE > SO 5 > Meetings | qualified_partial | 8c-35 |
| S-342 | Statement Subject Committee | Chapter 4 > STATEMENT SUBJECT COMMITTEE > SO 5 > Meetings | supported | 8c-35 |
| S-343 | a committee | Chapter 4 > REPORT OF SELECT COMMITTEE > SO 5 > Meetings | supported | 8c-36 |
| S-344 | the Caddermere debate | Chapter 4 > REPORT OF SELECT COMMITTEE > SO 5 > Caddermere debate | supported | 8c-36 |

## Changelog
- v2.30 (r5v) = v2.29 + S-324..S-344 for addendum 8c supplements 6 and 7 (file dd045b31). 8c-31: under a family heading alone, a family-member or CotWH setting is match and a named committee is qualified. 8c-33: 'her' is a possessive (non-content) only directly before a class word; elsewhere it is content. 8c-34: S-328 is PROPOSED (deferred, pending ruling): a generic setting under a family heading alone is qualified. 8c-35: every generator-emitted seed word (lib/domain-vocabulary-data.js headingPrefixes and lib/corpus-proceedings-data.js corpusProceedingHeads) is the name word when it is the only word before SELECT/SUBJECT/COMMITTEE; own heading matches. 8c-36: not across 'of' (REPORT OF SELECT COMMITTEE is generic). 8c-30/8c-32 need no row change. Oracle ruling_v2_30.

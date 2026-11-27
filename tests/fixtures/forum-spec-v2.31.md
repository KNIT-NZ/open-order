# PR15 forum-identity spec v2.31 (engineer-safe)

v2.31 = v2.30 plus public rows S-345 to S-348. The rows are proposed as binding from r5v. v2.30 is left unedited, and no v2.30 expectation changes. S-328 stays deferred (8c-34 proposed).

## Oracle
The oracle is v2.30 plus addendum 8c supplement 8 (8c-40 to 8c-43; file sha 8b08a748…).
- **8c-40.** 8c-22 is subject to ancestors (A3 / Ruling B). Take a named committee setting, listed or unlisted, that matches only through its own heading above a neutral leaf. If another heading on the path names a different specific committee (listed, or named under 8b-1 / 8c-7), the result is capped to qualified and is never match. Generic, structural and whole-House-family headings do not cap.
  - Scope: this applies to the own-HEADING match only.
  - Open question: should a same-named LEAF under a different named heading also be capped? Today it is supported under the existing rules.
- **8c-41.** Every file under tests/fixtures is listed in a committed manifest with its sha256. A test fails on a mismatch, an unlisted file or a missing entry. This is a test rule with no row outcome.
- **8c-42.** Closed-class membership is tested on the whole word before any suffix trimming, including in the dossier ranker. A test pins the ranker's drop behaviour. This is a code rule with no forum-row outcome.
- **8c-43.** A named headed-debate setting under a family heading stays uncertain (R9; Batch 2). v2.30 already gives qualified there, so no change.
- **Zero drift** on any v2.16 or v2.21–v2.30 row, in either portion, on the corpus matrix v1.2 and on the self-match.

## New shared rows (both routes)
| Row | Setting | Path | Expected | Clause |
|---|---|---|---|---|
| S-345 | Kestle Committee | Chapter 4 > BRINDLE COMMITTEE > KESTLE COMMITTEE > SO 5 > Meetings | qualified_partial | 8c-40 |
| S-346 | Kestle Committee | Chapter 4 > WIDGET COMMITTEE > KESTLE COMMITTEE > SO 5 > Meetings | qualified_partial | 8c-40 |
| S-347 | Widget Committee | Chapter 4 > BRINDLE COMMITTEE > WIDGET COMMITTEE > SO 5 > Meetings | qualified_partial | 8c-40 |
| S-348 | Kestle Committee | Chapter 4 > SELECT COMMITTEES > KESTLE COMMITTEE > SO 5 > Meetings | supported | 8c-40 |

## Changelog
- v2.31 (r5v) = v2.30 + S-345..S-348 for addendum 8c supplement 8 (file 8b08a748). 8c-40: 8c-22 is subject to ancestors: an own-heading match (a named committee setting at its own heading above a neutral leaf) is capped to qualified when another heading names a different specific committee, listed or unlisted; a generic ancestor does not cap. 8c-41 / 8c-42 are code and test rules (fixture manifest; closed-class test before suffix trimming) with no row outcome. 8c-43: no change (T441 stays uncertain). Oracle ruling_v2_31.

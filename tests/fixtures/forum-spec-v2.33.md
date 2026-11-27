# PR15 forum-identity spec v2.33 (engineer-safe)

v2.33 = v2.32 plus rows S-352 to S-360, binding from r5w. v2.32 (json eacb3f20, md 4b080f53) is binding from r5w (8c-54) and is left unedited. No v2.32 row changes.

## Oracle
The oracle is v2.32 plus addendum 8c supplement 11 (8c-50 to 8c-54; file sha 90f52ee8…).
- **8c-51 / 8c-52.** Closed-class membership is tested on the whole word before any plural folding. A setting made of closed-class words plus a whole-House family phrase is a family-member setting (8c-27), with the same outcome as 'the House in committee'. A content word outside the closed classes still excludes it (8c-32).
- 8c-50 and 8c-53 are code and test rules with no forum-row outcome.
- **Zero drift** on any v2.16 or v2.21–v2.32 row, in either portion, on the corpus matrix v1.2 and on the self-match.
- Each 8c-52 row has the same expected value as the same row with the setting 'the House in committee'.

## New rows (both routes)
| Row | Setting | Path | Expected | Clause |
|---|---|---|---|---|
| S-352 | this House in committee | Chapter 3 > COMMITTEES OF THE WHOLE HOUSE > SO 5 > Debate in committee of the whole House | supported | 8c-52 (whole-House leaf) |
| S-353 | this House in committee | Chapter 2 > HOUSE IN COMMITTEE > SO 5 > Time limits | supported | 8c-52 / 8c-31 (family heading alone) |
| S-354 | this House in committee | Select committees > Hollin Committee | withheld | 8c-52 (listed committee leaf; as S-322) |
| S-355 | this House in committee | Chapter 4 > HOLLIN COMMITTEE > SO 5 > Meetings | withheld | 8c-52 (listed committee heading; plain family setting's value) |
| S-356 | House in committee whereas | Chapter 2 > HOUSE IN COMMITTEE > SO 5 > Time limits | supported | 8c-52 / 8c-18 |
| S-357 | House in committee whereas | Select committees > Hollin Committee | withheld | 8c-52 |
| S-358 | these Houses in committee | Chapter 3 > COMMITTEES OF THE WHOLE HOUSE > SO 5 > Debate in committee of the whole House | supported | 8c-52 (plural alias) |
| S-359 | the upper House in committee | Chapter 3 > COMMITTEES OF THE WHOLE HOUSE > SO 5 > Debate in committee of the whole House | qualified_partial | 8c-32 control (content word) |
| S-360 | the upper House in committee | Chapter 2 > HOUSE IN COMMITTEE > SO 5 > Time limits | qualified_partial | 8c-32 control |

## Changelog
- v2.33 (bindingFrom r5w) = v2.32 + S-352..S-360 for addendum 8c supplement 11 (file 90f52ee8). 8c-51/8c-52: closed-class membership is tested on the whole word before plural folding, so closed-class words plus a whole-House family phrase ('this House in committee', 'House in committee whereas', 'these Houses in committee') make a family-member setting, with the same outcome as 'the House in committee'. A content word ('the upper House in committee') still excludes it (8c-32 controls). No v2.32 expectation changes (0 drift). 8c-54: v2.32 binding from r5w. Oracle ruling_v2_33.

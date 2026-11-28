import assert from "node:assert/strict";
import test from "node:test";
import { validateAnswerCitations } from "../lib/procedural-reasoning";
import { mainValidateAnswerCitations } from "./frozen/main-citation-2ca3449";

/**
 * Known gap, pinned, not fixed in this batch.
 * Main 2ca3449 rejects [SR 48/2] when the admitted label is the bare ruling 48/2.
 * Only [48/2] passes its citation check. The head does the same, so this is not
 * a Batch 2 regression.
 */
test("known gap: [SR 48/2] is ungrounded for a bare 48/2 label on main and on the head", (t) => {
  const authorities = [{ citationLabel: "48/2" }];
  const prefixed = "The ruling lets the House sit [SR 48/2].";
  const bare = "The ruling lets the House sit [48/2].";
  const mainPrefixed = mainValidateAnswerCitations({ answerText: prefixed, authorities });
  const mainBare = mainValidateAnswerCitations({ answerText: bare, authorities });
  const headPrefixed = validateAnswerCitations({ answerText: prefixed, authorities });
  const headBare = validateAnswerCitations({ answerText: bare, authorities });
  t.diagnostic(`main [SR 48/2] ok=${mainPrefixed.ok}; main [48/2] ok=${mainBare.ok}; head [SR 48/2] ok=${headPrefixed.ok}; head [48/2] ok=${headBare.ok}`);
  assert.equal(mainPrefixed.ok, false);
  assert.equal(mainBare.ok, true);
  assert.equal(headPrefixed.ok, false);
  assert.equal(headBare.ok, true);
});

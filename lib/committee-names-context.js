/**
 * Test-only overlay for committee names. Not imported by the app.
 * Node's async_hooks stay out of the page bundle.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { compileCommitteeLabels, installCommitteeRecordReader } from "./committee-names.js";

const overlay = new AsyncLocalStorage();
installCommitteeRecordReader(() => overlay.getStore() ?? null);

/** Test isolation. Production reads the generated corpus records. */
export function withCorpusCommitteeNames(labels, run) {
  return overlay.run(compileCommitteeLabels(labels), run);
}

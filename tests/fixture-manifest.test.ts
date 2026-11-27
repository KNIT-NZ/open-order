import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

/** Changing the manifest requires editing this constant in the same commit. */
const MANIFEST_SHA256 = "dbc558a9f9c3270fe3eda7b3af2ae3e139acc5476e62144cf4e29998464bdbdb";

const manifestBytes = readFileSync(new URL("./fixture-sha256.json", import.meta.url));
const manifest = JSON.parse(manifestBytes.toString("utf8")) as { files: Record<string, string> };

test("every fixture file is pinned by the sha256 manifest", () => {
  assert.equal(createHash("sha256").update(manifestBytes).digest("hex"), MANIFEST_SHA256);
  const present = readdirSync(new URL("./fixtures/", import.meta.url)).sort();
  const listed = Object.keys(manifest.files).sort();
  assert.deepEqual(present, listed, "a fixture file is missing from the manifest, or the manifest names a file that is not there");
  for (const name of present) {
    const bytes = readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), manifest.files[name], name);
  }
});

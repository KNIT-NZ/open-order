import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

/** Changing the manifest requires editing this constant in the same commit. */
const MANIFEST_SHA256 = "bec27852a8e0e209f3a2a972c944027e55f82ebd73a1e105f05533e46e2156ff";

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

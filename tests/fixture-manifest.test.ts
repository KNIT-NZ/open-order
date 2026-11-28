import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

/** Changing the manifest requires editing this constant in the same commit. */
const MANIFEST_SHA256 = "c857171079b70caed72f537692d4f3c9099baf4db1c754e65a3bce04285ffd6d";

const manifestBytes = readFileSync(new URL("./fixture-sha256.json", import.meta.url));
const manifest = JSON.parse(manifestBytes.toString("utf8")) as { files: Record<string, string> };

function fixtureFiles(dir: URL, prefix = ""): string[] {
  const names: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) names.push(...fixtureFiles(new URL(`${entry.name}/`, dir), rel));
    else if (entry.isFile()) names.push(rel);
  }
  return names;
}

test("every fixture file is pinned by the sha256 manifest", () => {
  assert.equal(createHash("sha256").update(manifestBytes).digest("hex"), MANIFEST_SHA256);
  const present = fixtureFiles(new URL("./fixtures/", import.meta.url)).sort();
  const listed = Object.keys(manifest.files).sort();
  assert.deepEqual(present, listed, "a fixture file is missing from the manifest, or the manifest names a file that is not there");
  for (const name of Object.keys(manifest.files)) {
    const bytes = readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), manifest.files[name], name);
  }
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const manifest = JSON.parse(readFileSync(new URL("./fixture-sha256.json", import.meta.url), "utf8")) as {
  files: Record<string, string>;
};

test("every fixture file is pinned by the sha256 manifest", () => {
  const present = readdirSync(new URL("./fixtures/", import.meta.url)).filter((name) => !name.startsWith(".")).sort();
  const listed = Object.keys(manifest.files).sort();
  assert.deepEqual(present, listed, "a fixture file is missing from the manifest, or the manifest names a file that is not there");
  for (const name of present) {
    const bytes = readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), manifest.files[name], name);
  }
});

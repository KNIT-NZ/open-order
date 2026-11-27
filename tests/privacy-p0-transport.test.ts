import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readPrivateSearchParams, SEARCH_BODY_MAX_BYTES } from "../lib/open-order/private-search-transport";

const canary = "OO_SYNTHETIC_PRIVACY_CANARY_76f1\r\n";
const request = (body: string, type = "application/json") => new Request("https://example.invalid/api/search", { method: "POST", headers: { "content-type": type }, body });

test("private search accepts transient query and preserves pagination/filtering", async () => {
  const result = await readPrivateSearchParams(request(JSON.stringify({ q: canary, corpus: "standing_orders", limit: "10", offset: 20 })));
  assert.equal(result?.get("q"), canary);
  assert.equal(result?.get("corpus"), "standing_orders");
  assert.equal(result?.get("limit"), "10");
  assert.equal(result?.get("offset"), "20");
});
test("private search accepts a bounded citation focus and rejects malformed focus", async () => {
  const accepted = await readPrivateSearchParams(request(JSON.stringify({ q: "SO 12", focus: "so-12" })));
  assert.equal(accepted?.get("focus"), "so-12");
  const label = await readPrivateSearchParams(request(JSON.stringify({ q: "49/5", focus: "Speakers' ruling 49/5" })));
  assert.equal(label?.get("focus"), "Speakers' ruling 49/5");
  for (const focus of ["", "  so-12", "../so-12", "<script>", "x".repeat(121), "so-12\nso-13", "so--12"]) {
    assert.equal(await readPrivateSearchParams(request(JSON.stringify({ q: "SO 12", focus }))), null, focus);
  }
});
test("private search rejects malformed, oversized and unknown-field inputs", async () => {
  for (const body of ["{", "null", "[]", JSON.stringify({ q: canary, debug: { query: canary } }), JSON.stringify({ q: {} }), JSON.stringify({ q: "x".repeat(4097) }), "x".repeat(SEARCH_BODY_MAX_BYTES + 1)]) {
    assert.equal(await readPrivateSearchParams(request(body)), null);
  }
  assert.equal(await readPrivateSearchParams(request(JSON.stringify({ q: canary }), "text/plain")), null);
});
test("source boundary no longer writes query logs or transports ordinary queries in URLs", () => {
  const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  const route = source("../app/api/search/route.ts");
  assert.doesNotMatch(route, /insert\s+into\s+query_logs/i);
  assert.doesNotMatch(route, /response\.debug/);
  assert.match(route, /status: 405/);
  assert.match(route, /private, no-store/);
  const hook = source("../hooks/useOpenOrderSearch.ts");
  assert.ok(hook.includes('fetch("/api/search", {'));
  assert.ok(hook.includes('method: "POST"'));
  assert.ok(source("../lib/open-order/url.ts").includes('params.delete("q")'));
  assert.doesNotMatch(source("../app/api/ai/answer/route.ts"), /"Cache-Control": "no-cache, no-transform"/);
});

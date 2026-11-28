import assert from "node:assert/strict";
import test from "node:test";
import { AiProviderError } from "../lib/ai/errors";
import {
  CLOUDFLARE_FREE_TIER_MODEL,
  CLOUDFLARE_MAX_TOKENS,
  generateJson,
  isCloudflareConfigured,
  resetCloudflareQuotaForTests,
  setCloudflareClockForTests,
  streamText,
} from "../lib/ai/cloudflare";
import { classifyAiError, runClaimValidationWithRetry } from "../lib/ai/provider-resilience";
import { getAiCandidates } from "../lib/ai/routes";

const ACCOUNT = "a".repeat(32);
const SECRET_BODY = "SECRET_PROVIDER_BODY do not keep this";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("cloudflare stays off unless both credentials are present", () => {
  const previous = {
    token: process.env.CLOUDFLARE_API_TOKEN,
    account: process.env.CLOUDFLARE_ACCOUNT_ID,
    allow: process.env.OPEN_ORDER_ALLOW_NON_GEMINI,
    mode: process.env.OPEN_ORDER_INFERENCE_MODE,
    override: process.env.AI_ROUTE_OVERRIDE,
    geminiModel: process.env.GEMINI_MODEL,
    geminiKey: process.env.GEMINI_API_KEY,
  };
  delete process.env.CLOUDFLARE_API_TOKEN;
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  delete process.env.OPEN_ORDER_ALLOW_NON_GEMINI;
  delete process.env.AI_ROUTE_OVERRIDE;
  process.env.OPEN_ORDER_INFERENCE_MODE = "";
  try {
    assert.equal(isCloudflareConfigured(), false);
    assert.deepEqual(getAiCandidates("answer.generate"), ["gemini"]);
    process.env.OPEN_ORDER_INFERENCE_MODE = "zero-billed-test";
    process.env.GEMINI_MODEL = "gemini-3.5-flash-lite";
    process.env.GEMINI_API_KEY = "test-key";
    process.env.CLOUDFLARE_API_TOKEN = "token";
    assert.throws(() => getAiCandidates("answer.generate"), /non-Gemini/);
    delete process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.GEMINI_MODEL;
    delete process.env.GEMINI_API_KEY;
    process.env.OPEN_ORDER_INFERENCE_MODE = "";
    process.env.CLOUDFLARE_API_TOKEN = "token";
    assert.equal(isCloudflareConfigured(), false);
    process.env.CLOUDFLARE_ACCOUNT_ID = ACCOUNT;
    assert.equal(isCloudflareConfigured(), true);
    assert.deepEqual(getAiCandidates("answer.generate"), ["gemini", "cloudflare"]);
  } finally {
    if (previous.token === undefined) delete process.env.CLOUDFLARE_API_TOKEN;
    else process.env.CLOUDFLARE_API_TOKEN = previous.token;
    if (previous.account === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID;
    else process.env.CLOUDFLARE_ACCOUNT_ID = previous.account;
    if (previous.allow === undefined) delete process.env.OPEN_ORDER_ALLOW_NON_GEMINI;
    else process.env.OPEN_ORDER_ALLOW_NON_GEMINI = previous.allow;
    if (previous.mode === undefined) delete process.env.OPEN_ORDER_INFERENCE_MODE;
    else process.env.OPEN_ORDER_INFERENCE_MODE = previous.mode;
    if (previous.override === undefined) delete process.env.AI_ROUTE_OVERRIDE;
    else process.env.AI_ROUTE_OVERRIDE = previous.override;
    if (previous.geminiModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = previous.geminiModel;
    if (previous.geminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previous.geminiKey;
  }
});

test("cloudflare maps a mocked answer and does not keep a provider error body", async () => {
  process.env.CLOUDFLARE_API_TOKEN = "token";
  process.env.CLOUDFLARE_ACCOUNT_ID = ACCOUNT;
  try {
    const answer = await generateJson<{ bottomLine: string }>({
      task: "answer.generate",
      systemInstruction: "Reply with JSON.",
      prompt: "May the House sit?",
    }, async () => jsonResponse(200, { success: true, result: { response: "{\"bottomLine\":\"Yes. [SO 1]\"}" } }));
    assert.equal(answer.bottomLine, "Yes. [SO 1]");
    assert.equal(CLOUDFLARE_FREE_TIER_MODEL, "@cf/google/gemma-4-26b-a4b-it");

    const limited = await generateJson({
      task: "answer.generate",
      systemInstruction: "Reply with JSON.",
      prompt: "sit",
    }, async () => jsonResponse(429, { success: false, errors: [{ code: 10429, message: SECRET_BODY }] })).catch((error: unknown) => error);
    assert.ok(limited instanceof AiProviderError);
    assert.equal(limited.kind, "rate_limited");
    assert.equal(limited.retryable, true);
    assert.equal(`${limited.message} ${limited.rawMessage ?? ""}`.includes(SECRET_BODY), false);

    const unavailable = await streamText({
      task: "answer.generate",
      systemInstruction: "Answer.",
      prompt: "sit",
    }, async () => jsonResponse(503, { success: false, errors: [{ code: 7003, message: SECRET_BODY }] })).catch((error: unknown) => error);
    assert.ok(unavailable instanceof AiProviderError);
    assert.equal(unavailable.kind, "unavailable");
    assert.equal(unavailable.retryable, true);
    assert.equal(`${unavailable.message} ${unavailable.rawMessage ?? ""}`.includes(SECRET_BODY), false);

    let outcome = "";
    const timedOut = await generateJson({
      task: "answer.generate",
      systemInstruction: "Reply with JSON.",
      prompt: "sit",
      onProviderAttempt: (attempt) => { outcome = attempt.outcome; },
    }, async () => { throw new DOMException("timed out", "AbortError"); }).catch((error: unknown) => error);
    assert.ok(timedOut instanceof DOMException);
    assert.equal(outcome, "timeout");
  } finally {
    delete process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    resetCloudflareQuotaForTests();
  }
});

test("cloudflare model, quota, and response-shape failures stay classified", async () => {
  process.env.CLOUDFLARE_API_TOKEN = "token";
  process.env.CLOUDFLARE_ACCOUNT_ID = ACCOUNT;
  const secret = "SECRET_PROVIDER_BODY do not keep this";
  let calls = 0;
  const fetchImpl = async (_url: string, init?: RequestInit) => {
    calls += 1;
    const body = JSON.parse(String(init?.body));
    assert.equal(typeof body.max_tokens, "number");
    assert.equal(body.max_tokens, CLOUDFLARE_MAX_TOKENS);
    assert.equal(body.temperature, 0);
    assert.equal(body.model, "@cf/google/gemma-4-26b-a4b-it");
    return jsonResponse(410, { success: false, errors: [{ code: 5028, message: secret }] });
  };
  try {
    const deprecated = await generateJson({
      task: "answer.validate",
      systemInstruction: "JSON only.",
      prompt: "check",
      temperature: 0,
    }, fetchImpl).catch((error: unknown) => error);
    assert.ok(deprecated instanceof AiProviderError);
    assert.equal(deprecated.kind, "configuration");
    assert.equal(deprecated.retryable, false);
    assert.equal(deprecated.providerCode, 5028);
    assert.equal(`${deprecated.message} ${deprecated.rawMessage ?? ""}`.includes(secret), false);
    const diagnosed = classifyAiError(deprecated, "claim_validation");
    assert.equal(diagnosed.retryable, false);
    assert.equal(diagnosed.code, "CF_5028");

    setCloudflareClockForTests(() => Date.parse("2026-11-28T23:00:00.000Z"));
    calls = 0;
    const exhausted = await generateJson({
      task: "answer.validate",
      systemInstruction: "JSON only.",
      prompt: "check",
      temperature: 0,
    }, async () => jsonResponse(429, { success: false, errors: [{ code: 3036, message: secret }] })).catch((error: unknown) => error);
    assert.ok(exhausted instanceof AiProviderError);
    assert.equal(exhausted.retryable, false);
    assert.equal(exhausted.providerCode, 3036);
    assert.equal(classifyAiError(exhausted, "claim_validation").retryable, false);
    let invokes = 0;
    await runClaimValidationWithRetry({
      invoke: async () => {
        invokes += 1;
        throw exhausted;
      },
      requestStartedAt: Date.parse("2026-11-28T23:00:00.000Z"),
      now: () => Date.parse("2026-11-28T23:00:00.000Z"),
      sleep: async () => undefined,
    }).catch(() => undefined);
    assert.equal(invokes, 1);
    calls = 0;
    await generateJson({
      task: "answer.generate",
      systemInstruction: "Answer.",
      prompt: "sit",
    }, async () => {
      calls += 1;
      return jsonResponse(200, { choices: [{ message: { content: "{\"bottomLine\":\"Yes\"}" } }] });
    }).catch(() => undefined);
    assert.equal(calls, 0);
    setCloudflareClockForTests(() => Date.parse("2026-11-29T00:00:00.000Z"));
    const afterMidnight = await generateJson<{ bottomLine: string }>({
      task: "answer.generate",
      systemInstruction: "Answer.",
      prompt: "sit",
    }, async () => jsonResponse(200, { choices: [{ message: { content: "{\"bottomLine\":\"Yes\"}" } }] }));
    assert.equal(afterMidnight.bottomLine, "Yes");

    const capacity = await generateJson({
      task: "answer.generate",
      systemInstruction: "Answer.",
      prompt: "sit",
    }, async () => jsonResponse(429, { success: false, errors: [{ code: 3040, message: secret }] })).catch((error: unknown) => error);
    assert.ok(capacity instanceof AiProviderError);
    assert.equal(capacity.retryable, true);
    assert.equal(capacity.providerCode, 3040);
    assert.equal(classifyAiError(capacity, "drafting").retryable, true);

    const legacy = await generateJson<{ bottomLine: string }>({
      task: "answer.generate",
      systemInstruction: "Answer.",
      prompt: "sit",
      temperature: 0.2,
    }, async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.temperature, 0.2);
      assert.equal(typeof body.max_tokens, "number");
      return jsonResponse(200, { result: { response: "{\"bottomLine\":\"From legacy\"}" } });
    });
    assert.equal(legacy.bottomLine, "From legacy");
    const objectShape = await generateJson<{ bottomLine: string }>({
      task: "answer.validate",
      systemInstruction: "JSON.",
      prompt: "check",
      temperature: 0,
    }, async () => jsonResponse(200, { choices: [{ message: { content: { bottomLine: "From object" } } }] }));
    assert.equal(objectShape.bottomLine, "From object");
    const unknown = await streamText({
      task: "answer.generate",
      systemInstruction: "Answer.",
      prompt: "sit",
    }, async () => jsonResponse(200, { result: { unexpected: secret } })).catch((error: unknown) => error);
    assert.ok(unknown instanceof AiProviderError);
    assert.equal(unknown.kind, "parse");
    assert.equal(`${unknown.message} ${unknown.rawMessage ?? ""}`.includes(secret), false);
  } finally {
    resetCloudflareQuotaForTests();
    delete process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
  }
});

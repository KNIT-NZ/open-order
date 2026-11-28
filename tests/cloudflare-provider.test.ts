import assert from "node:assert/strict";
import test from "node:test";
import { AiProviderError } from "../lib/ai/errors";
import {
  CLOUDFLARE_FREE_TIER_MODEL,
  generateJson,
  isCloudflareConfigured,
  resetCloudflareModelWarningForTests,
  resetCloudflareQuotaForTests,
  resetCloudflareRequestTimeoutForTests,
  setCloudflareClockForTests,
  setCloudflareRequestTimeoutForTests,
  streamText,
} from "../lib/ai/cloudflare";
import { generateJson as routeGenerateJson, preferDiagnosedError } from "../lib/ai";
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
    assert.deepEqual(getAiCandidates("answer.generate"), ["gemini"]);
    process.env.OPEN_ORDER_ALLOW_NON_GEMINI = "1";
    assert.deepEqual(getAiCandidates("answer.generate"), ["gemini", "cloudflare", "openai-compatible"]);
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
    assert.equal(body.max_completion_tokens, 1500);
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
      assert.equal(body.max_completion_tokens, 3000);
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
    delete process.env.CLOUDFLARE_AI_MODEL;
  }
});

test("recognised Cloudflare codes are read from either error shape", async () => {
  process.env.CLOUDFLARE_API_TOKEN = "token";
  process.env.CLOUDFLARE_ACCOUNT_ID = ACCOUNT;
  const secret = "SECRET_PROVIDER_BODY do not keep this";
  const cases = [
    { code: 3036, status: 429, kind: "unavailable", retryable: false },
    { code: 5028, status: 410, kind: "configuration", retryable: false },
    { code: 3042, status: 404, kind: "configuration", retryable: false },
    { code: 5007, status: 400, kind: "configuration", retryable: false },
    { code: 10429, status: 200, kind: "rate_limited", retryable: true },
  ];
  try {
    for (const item of cases) {
      for (const shape of ["errors", "openai"] as const) {
        resetCloudflareQuotaForTests();
        const body = shape === "errors"
          ? { success: false, errors: [{ code: String(item.code), message: secret }, { code: 1, message: secret }] }
          : { success: false, error: { code: item.code, type: String(item.code), message: secret } };
        const error = await generateJson({
          task: "answer.validate",
          systemInstruction: "JSON.",
          prompt: "check",
          temperature: 0,
        }, async () => jsonResponse(item.status, body)).catch((caught: unknown) => caught);
        assert.ok(error instanceof AiProviderError, `${item.code} ${shape}`);
        assert.equal(error.kind, item.kind, `${item.code} ${shape}`);
        assert.equal(error.retryable, item.retryable, `${item.code} ${shape}`);
        assert.equal(error.providerCode, item.code, `${item.code} ${shape}`);
        assert.equal(`${error.message} ${error.rawMessage ?? ""}`.includes(secret), false);
        if (item.code === 3036) {
          let calls = 0;
          await generateJson({
            task: "answer.generate", systemInstruction: "A", prompt: "B",
          }, async () => { calls += 1; return jsonResponse(200, { choices: [{ message: { content: "{\"a\":1}" } }] }); }).catch(() => undefined);
          assert.equal(calls, 0);
          assert.equal(classifyAiError(error, "claim_validation").retryable, false);
        }
      }
    }
    const truncated = await generateJson({
      task: "answer.validate", systemInstruction: "JSON.", prompt: "check", temperature: 0,
    }, async () => jsonResponse(200, {
      choices: [{ finish_reason: "length", message: { content: secret } }],
    })).catch((error: unknown) => error);
    assert.ok(truncated instanceof AiProviderError);
    assert.equal(truncated.kind, "parse");
    assert.equal(`${truncated.message} ${truncated.rawMessage ?? ""}`.includes(secret), false);
    const transport = await generateJson({
      task: "answer.generate", systemInstruction: "A", prompt: "B",
    }, async () => { throw Object.assign(new Error("fetch failed"), { code: "ECONNRESET" }); }).catch((error: unknown) => error);
    assert.equal(classifyAiError(transport, "drafting").retryable, true);
    const stopped = await generateJson({
      task: "answer.generate", systemInstruction: "A", prompt: "B",
    }, async () => jsonResponse(501, { errors: [{ code: 1, message: secret }] })).catch((error: unknown) => error);
    assert.ok(stopped instanceof AiProviderError);
    assert.equal(stopped.retryable, false);
    const edge = await generateJson({
      task: "answer.generate", systemInstruction: "A", prompt: "B",
    }, async () => jsonResponse(520, { errors: [{ message: secret }] })).catch((error: unknown) => error);
    assert.ok(edge instanceof AiProviderError);
    assert.equal(edge.retryable, true);
    assert.equal(`${edge.message} ${edge.rawMessage ?? ""}`.includes(secret), false);
    let startedBeforeFetch = false;
    let fetched = false;
    await streamText({
      task: "answer.generate",
      systemInstruction: "A",
      prompt: "B",
      onProviderAttemptStart: () => { startedBeforeFetch = !fetched; },
    }, async (_url, init) => {
      fetched = true;
      const body = JSON.parse(String(init?.body));
      assert.ok(init?.signal);
      assert.equal(body.max_completion_tokens, 3000);
      return jsonResponse(200, { choices: [{ finish_reason: "stop", message: { content: "Yes" } }] });
    });
    assert.equal(startedBeforeFetch, true);
    process.env.CLOUDFLARE_AI_MODEL = "@cf/meta/llama-3.1-8b-instruct";
    const rejected = await generateJson({
      task: "answer.generate", systemInstruction: "A", prompt: "B",
    }, async () => jsonResponse(200, { choices: [{ message: { content: "no" } }] })).catch((error: unknown) => error);
    assert.ok(rejected instanceof AiProviderError);
    assert.equal(rejected.kind, "configuration");
    const primary = new AiProviderError({
      message: "limited", kind: "rate_limited", statusCode: 429, retryable: true, provider: "gemini",
    });
    const kept = preferDiagnosedError(primary, rejected);
    assert.equal(kept.provider, "gemini");
    assert.equal(kept.kind, "rate_limited");
    assert.equal(kept.retryable, true);
    delete process.env.CLOUDFLARE_AI_MODEL;
    resetCloudflareModelWarningForTests();
    resetCloudflareQuotaForTests();
    const later = await generateJson({
      task: "answer.generate", systemInstruction: "A", prompt: "B",
    }, async () => jsonResponse(429, { errors: [{ code: 1111, message: secret }, { code: "3036", message: secret }] })).catch((error: unknown) => error);
    assert.ok(later instanceof AiProviderError);
    assert.equal(later.providerCode, 3036);
    assert.equal(later.retryable, false);
    let skipped = 0;
    await generateJson({
      task: "answer.generate", systemInstruction: "A", prompt: "B",
    }, async () => { skipped += 1; return jsonResponse(200, { choices: [{ message: { content: "{\"a\":1}" } }] }); }).catch(() => undefined);
    assert.equal(skipped, 0);
    resetCloudflareQuotaForTests();
    const unknown = await generateJson({
      task: "answer.validate", systemInstruction: "JSON.", prompt: "check", temperature: 0,
    }, async () => jsonResponse(400, { error: { code: "1234", message: secret } })).catch((error: unknown) => error);
    assert.ok(unknown instanceof AiProviderError);
    assert.equal(unknown.providerCode, 1234);
    assert.equal(unknown.retryable, false);
    assert.equal(classifyAiError(unknown, "claim_validation").code, "CF_1234");
    assert.equal(`${unknown.message} ${unknown.rawMessage ?? ""}`.includes(secret), false);
    resetCloudflareModelWarningForTests();
    process.env.CLOUDFLARE_AI_MODEL = "@cf/openai/gpt-oss-120b";
    await generateJson({
      task: "answer.validate", systemInstruction: "JSON.", prompt: "check", temperature: 0,
    }, async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.max_tokens, 1500);
      assert.equal(body.max_completion_tokens, undefined);
      return jsonResponse(200, { choices: [{ message: { content: "{\"ok\":true}" } }] });
    });
    const warnings: string[] = [];
    const outcomes: string[] = [];
    const originalWarn = console.warn;
    console.warn = (message?: unknown) => { warnings.push(String(message ?? "")); };
    process.env.CLOUDFLARE_AI_MODEL = "@cf/meta/llama-3.1-8b-instruct";
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await generateJson({
          task: "answer.generate",
          systemInstruction: "A",
          prompt: "B",
          onProviderAttempt: (item) => { outcomes.push(item.outcome); },
        }, async () => jsonResponse(200, { choices: [{ message: { content: "no" } }] })).catch(() => undefined);
      }
    } finally {
      console.warn = originalWarn;
    }
    assert.equal(warnings.length, 1);
    assert.deepEqual(outcomes, ["other", "other"]);
    delete process.env.CLOUDFLARE_AI_MODEL;
    setCloudflareRequestTimeoutForTests(40);
    const stalled = await generateJson({
      task: "answer.generate", systemInstruction: "A", prompt: "B",
    }, async () => new Response(new ReadableStream({ start() { /* stalled */ } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })).catch((error: unknown) => error);
    assert.equal(stalled instanceof DOMException && stalled.name === "AbortError", true);
  } finally {
    resetCloudflareQuotaForTests();
    resetCloudflareModelWarningForTests();
    resetCloudflareRequestTimeoutForTests();
    delete process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_AI_MODEL;
  }
});

test("a 200 with a null or malformed choice is a non-retryable parse failure", async () => {
  process.env.CLOUDFLARE_API_TOKEN = "token";
  process.env.CLOUDFLARE_ACCOUNT_ID = ACCOUNT;
  const bodies = [null, { choices: null }, { choices: [null] }, { choices: ["nope"] }, { choices: [{ message: null }] }];
  try {
    for (const body of bodies) {
      const error = await generateJson({
        task: "answer.generate",
        systemInstruction: "A",
        prompt: "B",
      }, async () => jsonResponse(200, body)).catch((caught: unknown) => caught);
      assert.ok(error instanceof AiProviderError, JSON.stringify(body));
      assert.equal(error.kind, "parse", JSON.stringify(body));
      assert.equal(error.retryable, false, JSON.stringify(body));
    }
  } finally {
    delete process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
  }
});

test("an abort while the Cloudflare body is still open stops the chain", async () => {
  const saved = {
    gemini: process.env.GEMINI_API_KEY,
    mode: process.env.OPEN_ORDER_INFERENCE_MODE,
    allow: process.env.OPEN_ORDER_ALLOW_NON_GEMINI,
    token: process.env.CLOUDFLARE_API_TOKEN,
    account: process.env.CLOUDFLARE_ACCOUNT_ID,
    base: process.env.AI_OPENAI_COMPATIBLE_BASE_URL,
    model: process.env.AI_OPENAI_COMPATIBLE_MODEL,
  };
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  let fetches = 0;
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPEN_ORDER_INFERENCE_MODE;
  process.env.OPEN_ORDER_ALLOW_NON_GEMINI = "1";
  process.env.CLOUDFLARE_API_TOKEN = "token";
  process.env.CLOUDFLARE_ACCOUNT_ID = ACCOUNT;
  process.env.AI_OPENAI_COMPATIBLE_BASE_URL = "https://example.test/v1";
  process.env.AI_OPENAI_COMPATIBLE_MODEL = "local";
  globalThis.fetch = async () => {
    fetches += 1;
    return new Response(new ReadableStream({
      start() { setTimeout(() => controller.abort(), 15); },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const error = await routeGenerateJson({
      task: "answer.generate",
      systemInstruction: "A",
      prompt: "B",
      signal: controller.signal,
    }).catch((caught: unknown) => caught);
    assert.equal(error instanceof DOMException && error.name === "AbortError", true);
    assert.equal(fetches, 1);
  } finally {
    globalThis.fetch = originalFetch;
    const restore = (name: string, value: string | undefined) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };
    restore("GEMINI_API_KEY", saved.gemini);
    restore("OPEN_ORDER_INFERENCE_MODE", saved.mode);
    restore("OPEN_ORDER_ALLOW_NON_GEMINI", saved.allow);
    restore("CLOUDFLARE_API_TOKEN", saved.token);
    restore("CLOUDFLARE_ACCOUNT_ID", saved.account);
    restore("AI_OPENAI_COMPATIBLE_BASE_URL", saved.base);
    restore("AI_OPENAI_COMPATIBLE_MODEL", saved.model);
  }
});

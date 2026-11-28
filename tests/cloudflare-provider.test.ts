import assert from "node:assert/strict";
import test from "node:test";
import { AiProviderError } from "../lib/ai/errors";
import {
  CLOUDFLARE_FREE_TIER_MODEL,
  generateJson,
  isCloudflareConfigured,
  streamText,
} from "../lib/ai/cloudflare";
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
  };
  delete process.env.CLOUDFLARE_API_TOKEN;
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  delete process.env.OPEN_ORDER_ALLOW_NON_GEMINI;
  delete process.env.AI_ROUTE_OVERRIDE;
  process.env.OPEN_ORDER_INFERENCE_MODE = "";
  try {
    assert.equal(isCloudflareConfigured(), false);
    assert.deepEqual(getAiCandidates("answer.generate"), ["gemini"]);
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
    assert.equal(CLOUDFLARE_FREE_TIER_MODEL.startsWith("@cf/"), true);

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
  }
});

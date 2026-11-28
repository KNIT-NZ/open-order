import { AiProviderError } from "./errors";
import type { AiGenerateJsonRequest, AiStreamTextRequest, ProviderAttempt } from "./types";

const PROVIDER_ID = "cloudflare";

/**
 * Current Workers AI free-tier instruct model. Llama 3.1 8B was deprecated on
 * 30 May 2026 (HTTP 410 / CF 5028). Gemma 4 26B A4B is the included-allocation
 * replacement that can follow a system prompt. A paid model is never the default.
 */
export const CLOUDFLARE_FREE_TIER_MODEL = "@cf/google/gemma-4-26b-a4b-it";

/** Gemini does not set a token cap. Cloudflare's own default is 256, which truncates answers and JSON. */
export const CLOUDFLARE_MAX_TOKENS = 4096;

const MODEL_ID = /^@cf\/[a-z0-9][a-z0-9._/-]{0,120}$/i;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

let nowMillis = (): number => Date.now();
let quotaSkippedUntil = 0;

function nextUtcMidnight(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

export function cloudflareQuotaSkipped(at = nowMillis()): boolean {
  return at < quotaSkippedUntil;
}

function rememberDailyAllocationExhausted(at = nowMillis()): void {
  quotaSkippedUntil = nextUtcMidnight(at);
}

export function setCloudflareClockForTests(clock: (() => number) | null): void {
  nowMillis = clock ?? (() => Date.now());
}

export function resetCloudflareQuotaForTests(): void {
  quotaSkippedUntil = 0;
  nowMillis = () => Date.now();
}

export function cloudflareQuotaSkipError(): AiProviderError {
  return new AiProviderError({
    message: "The AI provider's daily allocation is exhausted.",
    kind: "unavailable",
    retryable: false,
    provider: PROVIDER_ID,
    providerCode: 3036,
    rawMessage: "cloudflare_quota_skipped",
  });
}

function accountId(): string | null {
  const value = process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? "";
  return /^[a-f0-9]{32}$/i.test(value) ? value : null;
}

function apiToken(): string | null {
  const value = process.env.CLOUDFLARE_API_TOKEN?.trim() ?? "";
  return value.length > 0 ? value : null;
}

export function cloudflareModel(): string {
  const configured = process.env.CLOUDFLARE_AI_MODEL?.trim() ?? "";
  return MODEL_ID.test(configured) ? configured : CLOUDFLARE_FREE_TIER_MODEL;
}

export function isCloudflareConfigured(): boolean {
  return Boolean(accountId() && apiToken());
}

function endpoint(): string {
  const id = accountId();
  if (!id || !apiToken()) {
    throw new AiProviderError({
      message: "AI model configuration is missing on the server.",
      kind: "configuration",
      provider: PROVIDER_ID,
      retryable: false,
    });
  }
  return `https://api.cloudflare.com/client/v4/accounts/${id}/ai/v1/chat/completions`;
}

function modelConfigError(status: number, errorCode: number | null): AiProviderError {
  return new AiProviderError({
    message: "The configured AI model is not available.",
    kind: "configuration",
    statusCode: status,
    retryable: false,
    provider: PROVIDER_ID,
    providerCode: errorCode,
    rawMessage: errorCode === null ? `cloudflare_http_${status}` : `cloudflare_http_${status} code ${errorCode}`,
  });
}

function classifyStatus(status: number, errorCode: number | null): AiProviderError {
  const codeNote = errorCode === null ? "" : ` code ${errorCode}`;
  if (errorCode === 3036) {
    rememberDailyAllocationExhausted();
    return new AiProviderError({
      message: "The AI provider's daily allocation is exhausted.",
      kind: "unavailable",
      statusCode: status,
      retryable: false,
      provider: PROVIDER_ID,
      providerCode: 3036,
      rawMessage: `cloudflare_http_${status}${codeNote}`,
    });
  }
  if (errorCode === 5028 || status === 410 || errorCode === 3042 || (status === 404 && errorCode === 3042) || errorCode === 5007 || (status === 400 && errorCode === 5007)) {
    return modelConfigError(status, errorCode);
  }
  // 10429 and 971 are not in Cloudflare's own error catalogue. They are kept
  // because third-party reports use them for rate limits.
  if (errorCode === 10429 || errorCode === 971 || (status === 429 && errorCode !== 3040)) {
    return new AiProviderError({
      message: "The AI model is temporarily rate limited. Please try again.",
      kind: "rate_limited",
      statusCode: status,
      retryable: true,
      provider: PROVIDER_ID,
      providerCode: errorCode,
      rawMessage: `cloudflare_http_${status}${codeNote}`.trim(),
    });
  }
  if (errorCode === 3040) {
    return new AiProviderError({
      message: "The AI provider is temporarily unavailable.",
      kind: "unavailable",
      statusCode: status,
      retryable: true,
      provider: PROVIDER_ID,
      providerCode: 3040,
      rawMessage: `cloudflare_http_${status}${codeNote}`.trim(),
    });
  }
  if (status === 503 || status === 500 || status === 502 || status === 504 || status === 408) {
    return new AiProviderError({
      message: "The AI provider is temporarily unavailable.",
      kind: status === 503 ? "unavailable" : "upstream",
      statusCode: status,
      retryable: true,
      provider: PROVIDER_ID,
      providerCode: errorCode,
      rawMessage: `cloudflare_http_${status}${codeNote}`.trim(),
    });
  }
  if (status === 401 || status === 403) {
    return new AiProviderError({
      message: "AI model configuration is missing on the server.",
      kind: "configuration",
      statusCode: status,
      retryable: false,
      provider: PROVIDER_ID,
      providerCode: errorCode,
      rawMessage: `cloudflare_http_${status}`,
    });
  }
  return new AiProviderError({
    message: `The AI provider returned HTTP ${status}.`,
    kind: "upstream",
    statusCode: status,
    retryable: false,
    provider: PROVIDER_ID,
    providerCode: errorCode,
    rawMessage: `cloudflare_http_${status}${codeNote}`.trim(),
  });
}

function numericCode(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function firstErrorCode(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const errors = (payload as { errors?: Array<{ code?: unknown }> }).errors;
  return numericCode(errors?.[0]?.code);
}

type Content = { kind: "text"; text: string } | { kind: "object"; value: unknown } | { kind: "missing" };

function contentFromMessage(message: unknown): Content {
  if (!message || typeof message !== "object") return { kind: "missing" };
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string" && content.trim()) return { kind: "text", text: content.trim() };
  if (content && typeof content === "object" && !Array.isArray(content)) return { kind: "object", value: content };
  return { kind: "missing" };
}

function choicesContent(value: unknown): Content {
  if (!value || typeof value !== "object") return { kind: "missing" };
  const choices = (value as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return { kind: "missing" };
  const message = (choices[0] as { message?: unknown }).message;
  return contentFromMessage(message);
}

/** OpenAI chat shape, or the older Workers AI result.response shape. Anything else fails closed. */
export function cloudflareMessage(payload: unknown): Content {
  const direct = choicesContent(payload);
  if (direct.kind !== "missing") return direct;
  if (!payload || typeof payload !== "object") return { kind: "missing" };
  const result = (payload as { result?: unknown }).result;
  const nested = choicesContent(result);
  if (nested.kind !== "missing") return nested;
  if (typeof result === "string" && result.trim()) return { kind: "text", text: result.trim() };
  if (result && typeof result === "object") {
    const response = (result as { response?: unknown }).response;
    if (typeof response === "string" && response.trim()) return { kind: "text", text: response.trim() };
    if (response && typeof response === "object" && !Array.isArray(response)) return { kind: "object", value: response };
  }
  return { kind: "missing" };
}

function shapeError(): AiProviderError {
  return new AiProviderError({
    message: "The AI provider returned a response that could not be read.",
    kind: "parse",
    provider: PROVIDER_ID,
    retryable: false,
    rawMessage: "cloudflare_shape",
  });
}

function generationBody(systemInstruction: string, prompt: string, temperature: number | undefined): string {
  return JSON.stringify({
    model: cloudflareModel(),
    messages: [
      { role: "system", content: systemInstruction },
      { role: "user", content: prompt },
    ],
    // Gemini's own default is 0.2. A validator call passes 0 and must stay at 0.
    temperature: temperature ?? 0.2,
    max_tokens: CLOUDFLARE_MAX_TOKENS,
  });
}

async function complete(
  systemInstruction: string,
  prompt: string,
  temperature: number | undefined,
  signal: AbortSignal | undefined,
  fetchImpl: FetchLike,
): Promise<Exclude<Content, { kind: "missing" }>> {
  if (cloudflareQuotaSkipped()) throw cloudflareQuotaSkipError();
  if (signal?.aborted) throw new DOMException("The answer deadline elapsed.", "AbortError");
  let response: Response;
  try {
    response = await fetchImpl(endpoint(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken() ?? ""}`,
        "Content-Type": "application/json",
      },
      body: generationBody(systemInstruction, prompt, temperature),
      signal,
    });
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw new DOMException("The answer deadline elapsed.", "AbortError");
    }
    throw new AiProviderError({
      message: "The AI provider is temporarily unavailable.",
      kind: "unavailable",
      retryable: true,
      provider: PROVIDER_ID,
      rawMessage: "cloudflare_transport",
    });
  }
  if (!response.ok) throw classifyStatus(response.status, firstErrorCode(await response.json().catch(() => null)));
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new AiProviderError({
      message: "The AI provider returned a response that could not be read.",
      kind: "parse",
      provider: PROVIDER_ID,
      retryable: false,
      rawMessage: "cloudflare_parse",
    });
  }
  const record = payload as { success?: unknown };
  if (record.success === false) {
    const code = firstErrorCode(payload);
    throw code === null ? shapeError() : classifyStatus(200, code);
  }
  const content = cloudflareMessage(payload);
  if (content.kind === "missing") throw shapeError();
  return content;
}

function noteAttempt(request: { onProviderAttempt?: (attempt: ProviderAttempt) => void; onProviderAttemptStart?: (model: string) => void }, outcome: ProviderAttempt["outcome"]): void {
  const model = cloudflareModel();
  request.onProviderAttemptStart?.(model);
  request.onProviderAttempt?.({ model, outcome });
}

function parseJsonText(text: string): unknown {
  return JSON.parse(text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, ""));
}

export async function generateJson<T>(request: AiGenerateJsonRequest, fetchImpl: FetchLike = fetch): Promise<T> {
  try {
    const content = await complete(request.systemInstruction, request.prompt, request.temperature, request.signal, fetchImpl);
    const parsed = (content.kind === "object" ? content.value : parseJsonText(content.text)) as T;
    request.validate?.(parsed);
    noteAttempt(request, "ok");
    return parsed;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      noteAttempt(request, "timeout");
      throw error;
    }
    if (error instanceof AiProviderError) {
      noteAttempt(request, error.kind === "rate_limited" ? "429" : error.retryable ? "5xx" : "other");
      throw error;
    }
    noteAttempt(request, "other");
    throw new AiProviderError({
      message: "The AI provider returned a response that could not be read.",
      kind: "parse",
      provider: PROVIDER_ID,
      retryable: false,
      rawMessage: "cloudflare_parse",
    });
  }
}

export async function streamText(request: AiStreamTextRequest, fetchImpl: FetchLike = fetch): Promise<string> {
  try {
    const content = await complete(request.systemInstruction, request.prompt, request.temperature, request.signal, fetchImpl);
    const text = content.kind === "text" ? content.text : JSON.stringify(content.value);
    request.onChunk?.(text);
    noteAttempt(request, "ok");
    return text;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      noteAttempt(request, "timeout");
      throw error;
    }
    if (error instanceof AiProviderError) {
      noteAttempt(request, error.kind === "rate_limited" ? "429" : error.retryable ? "5xx" : "other");
      throw error;
    }
    noteAttempt(request, "other");
    throw error;
  }
}

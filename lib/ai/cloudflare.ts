import { AiProviderError } from "./errors";
import type { AiGenerateJsonRequest, AiStreamTextRequest, ProviderAttempt } from "./types";

const PROVIDER_ID = "cloudflare";

/**
 * Current Workers AI free-tier instruct model. Llama 3.1 8B was deprecated on
 * 30 May 2026 (HTTP 410 / CF 5028). Gemma 4 26B A4B is the included-allocation
 * replacement that can follow a system prompt. A paid model is never the default.
 */
export const CLOUDFLARE_FREE_TIER_MODEL = "@cf/google/gemma-4-26b-a4b-it";

/** Gemini does not set a token cap. These ceilings replace Cloudflare's 256-token default. */
export const CLOUDFLARE_ANSWER_MAX_TOKENS = 2000;
export const CLOUDFLARE_JSON_MAX_TOKENS = 1500;
export const CLOUDFLARE_JSON_TIMEOUT_MS = 30_000;
export const CLOUDFLARE_DRAFT_TIMEOUT_MS = 75_000;

const ALLOWED_MODELS = new Set([
  "@cf/google/gemma-4-26b-a4b-it",
  "@cf/openai/gpt-oss-120b",
]);

const RECOGNISED_CF_CODES = new Set([3036, 3040, 3042, 5007, 5028, 971, 10429]);

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

let invalidModelWarned = false;

export function resetCloudflareModelWarningForTests(): void {
  invalidModelWarned = false;
}

export function cloudflareModel(): string {
  const configured = process.env.CLOUDFLARE_AI_MODEL?.trim() ?? "";
  if (!configured) return CLOUDFLARE_FREE_TIER_MODEL;
  if (!ALLOWED_MODELS.has(configured)) {
    if (!invalidModelWarned) {
      invalidModelWarned = true;
      console.warn("CLOUDFLARE_AI_MODEL is not an allowed Workers AI model.");
    }
    throw new AiProviderError({
      message: "The configured AI model is not available.",
      kind: "configuration",
      provider: PROVIDER_ID,
      retryable: false,
      rawMessage: "cloudflare_model_allowlist",
    });
  }
  return configured;
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

function classifyStatus(status: number, recognised: number | null, providerCode: number | null): AiProviderError {
  const codeNote = providerCode === null ? "" : ` code ${providerCode}`;
  if (recognised === 3036) {
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
  if (recognised === 5028 || status === 410 || recognised === 3042 || (status === 404 && recognised === 3042) || recognised === 5007 || (status === 400 && recognised === 5007)) {
    return modelConfigError(status, providerCode);
  }
  // 10429 and 971 are not in Cloudflare's own error catalogue. They are kept
  // because third-party reports use them for rate limits.
  if (recognised === 10429 || recognised === 971 || (status === 429 && recognised !== 3040)) {
    return new AiProviderError({
      message: "The AI model is temporarily rate limited. Please try again.",
      kind: "rate_limited",
      statusCode: status,
      retryable: true,
      provider: PROVIDER_ID,
      providerCode,
      rawMessage: `cloudflare_http_${status}${codeNote}`.trim(),
    });
  }
  if (recognised === 3040) {
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
  if (status === 501) {
    return new AiProviderError({
      message: `The AI provider returned HTTP ${status}.`,
      kind: "upstream",
      statusCode: status,
      retryable: false,
      provider: PROVIDER_ID,
      providerCode,
      rawMessage: `cloudflare_http_${status}${codeNote}`.trim(),
    });
  }
  if (status === 408 || status === 500 || status === 502 || status === 503 || status === 504 || (status >= 520 && status <= 529)) {
    return new AiProviderError({
      message: "The AI provider is temporarily unavailable.",
      kind: status === 503 ? "unavailable" : "upstream",
      statusCode: status,
      retryable: true,
      provider: PROVIDER_ID,
      providerCode,
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
      providerCode,
      rawMessage: `cloudflare_http_${status}`,
    });
  }
  return new AiProviderError({
    message: `The AI provider returned HTTP ${status}.`,
    kind: "upstream",
    statusCode: status,
    retryable: false,
    provider: PROVIDER_ID,
    providerCode,
    rawMessage: `cloudflare_http_${status}${codeNote}`.trim(),
  });
}

function errorCodes(payload: unknown): number[] {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as {
    errors?: Array<{ code?: unknown }>;
    error?: { code?: unknown; type?: unknown };
  };
  const candidates: unknown[] = [];
  if (Array.isArray(record.errors)) {
    for (const item of record.errors) candidates.push(item?.code);
  }
  if (record.error && typeof record.error === "object") {
    candidates.push(record.error.code, record.error.type);
  }
  const codes: number[] = [];
  for (const candidate of candidates) {
    const code = numericCode(candidate);
    if (code !== null) codes.push(code);
  }
  return codes;
}

function classifiedCode(payload: unknown): { recognised: number | null; providerCode: number | null } {
  const codes = errorCodes(payload);
  const recognised = codes.find((code) => RECOGNISED_CF_CODES.has(code)) ?? null;
  return { recognised, providerCode: recognised ?? codes[0] ?? null };
}

function numericCode(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

function finishReason(payload: unknown): string | null {
  const sources = [payload, payload && typeof payload === "object" ? (payload as { result?: unknown }).result : null];
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    const choices = (source as { choices?: unknown }).choices;
    if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") continue;
    const reason = (choices[0] as { finish_reason?: unknown }).finish_reason;
    if (typeof reason === "string") return reason;
  }
  return null;
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
  const choice = choices[0];
  if (!choice || typeof choice !== "object") return { kind: "missing" };
  const message = (choice as { message?: unknown }).message;
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

/** Thinking stays off unless CLOUDFLARE_DISABLE_THINKING is exactly "0". */
export function cloudflareThinkingDisabled(): boolean {
  return process.env.CLOUDFLARE_DISABLE_THINKING?.trim() !== "0";
}

/** Gemma-family models accept enable_thinking. The free-tier default is one of them, not the key. */
export function cloudflareThinkingKwargs(model: string): { chat_template_kwargs?: { enable_thinking: false } } {
  if (!cloudflareThinkingDisabled() || !/gemma/i.test(model)) return {};
  return { chat_template_kwargs: { enable_thinking: false } };
}

function draftTask(task: string, drafting: boolean): boolean {
  return drafting || task === "answer.generate" || task === "answer.repair";
}

function readTimeoutMs(raw: string | undefined, fallback: number): number {
  const text = raw?.trim() ?? "";
  if (!text) return fallback;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(120_000, Math.max(10_000, Math.trunc(parsed)));
}

let timeoutOverrideMs: number | null = null;

/** Drafting and answer generation use the longer timeout. Other tasks stay at the JSON timeout. */
export function cloudflareRequestTimeoutMs(task: string, drafting = false): number {
  if (timeoutOverrideMs !== null) return timeoutOverrideMs;
  return draftTask(task, drafting)
    ? readTimeoutMs(process.env.CLOUDFLARE_DRAFT_TIMEOUT_MS, CLOUDFLARE_DRAFT_TIMEOUT_MS)
    : readTimeoutMs(process.env.CLOUDFLARE_JSON_TIMEOUT_MS, CLOUDFLARE_JSON_TIMEOUT_MS);
}

const REQUEST_BUDGET_MARGIN_MS = 1_000;

/** The armed timer is the task timeout, or the time left before the 270s request deadline. */
export function cloudflareArmedTimeoutMs(task: string, drafting = false, now = Date.now(), budgetDeadlineAt?: number): number {
  const taskTimeout = cloudflareRequestTimeoutMs(task, drafting);
  if (budgetDeadlineAt === undefined || !Number.isFinite(budgetDeadlineAt)) return taskTimeout;
  const remaining = Math.trunc(budgetDeadlineAt - now - REQUEST_BUDGET_MARGIN_MS);
  return Math.min(taskTimeout, Math.max(0, remaining));
}

function generationBody(task: AiGenerateJsonRequest["task"] | AiStreamTextRequest["task"], systemInstruction: string, prompt: string, temperature: number | undefined, drafting: boolean, model: string): string {
  const cap = draftTask(task, drafting)
    ? CLOUDFLARE_ANSWER_MAX_TOKENS
    : CLOUDFLARE_JSON_MAX_TOKENS;
  const limit = model === "@cf/openai/gpt-oss-120b"
    ? { max_tokens: cap }
    : { max_completion_tokens: cap };
  return JSON.stringify({
    model,
    messages: [
      { role: "system", content: systemInstruction },
      { role: "user", content: prompt },
    ],
    // Gemini's own default is 0.2. A validator call passes 0 and must stay at 0.
    temperature: temperature ?? 0.2,
    ...limit,
    ...cloudflareThinkingKwargs(model),
  });
}

function providerTimeoutError(): AiProviderError {
  return new AiProviderError({
    message: "The AI provider timed out.",
    kind: "unavailable",
    retryable: true,
    provider: PROVIDER_ID,
    statusCode: null,
    rawMessage: "cloudflare_timeout",
    cause: { code: "DEADLINE_EXCEEDED" },
  });
}

function aborted(error: unknown, signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted || (error instanceof Error && error.name === "AbortError"));
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

async function readPayload(response: Response, signal: AbortSignal): Promise<unknown> {
  if (signal.aborted) throw new DOMException("The answer deadline elapsed.", "AbortError");
  const fail = (error: unknown): never => {
    if (aborted(error, signal)) throw new DOMException("The answer deadline elapsed.", "AbortError");
    throw new AiProviderError({
      message: "The AI provider returned a response that could not be read.",
      kind: "parse",
      provider: PROVIDER_ID,
      retryable: false,
      rawMessage: "cloudflare_parse",
    });
  };
  const body = response.body;
  if (!body) {
    try {
      return await response.json();
    } catch (error) {
      return fail(error);
    }
  }
  const reader = body.getReader();
  const onAbort = () => { reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", onAbort, { once: true });
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      if (signal.aborted) throw new DOMException("The answer deadline elapsed.", "AbortError");
      const next = await reader.read();
      if (next.done) break;
      if (next.value) chunks.push(next.value);
    }
    if (signal.aborted) throw new DOMException("The answer deadline elapsed.", "AbortError");
  } catch (error) {
    return fail(error);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
  try {
    return JSON.parse(new TextDecoder().decode(concatBytes(chunks)));
  } catch (error) {
    return fail(error);
  }
}

export function setCloudflareRequestTimeoutForTests(ms: number): void {
  timeoutOverrideMs = ms;
}

export function resetCloudflareRequestTimeoutForTests(): void {
  timeoutOverrideMs = null;
}

async function complete(
  task: AiGenerateJsonRequest["task"],
  systemInstruction: string,
  prompt: string,
  temperature: number | undefined,
  callerSignal: AbortSignal | undefined,
  fetchImpl: FetchLike,
  onStart: (() => void) | undefined,
  drafting: boolean,
  model: string,
  budgetDeadlineAt?: number,
): Promise<Exclude<Content, { kind: "missing" }>> {
  if (cloudflareQuotaSkipped()) throw cloudflareQuotaSkipError();
  if (callerSignal?.aborted) throw new DOMException("The answer deadline elapsed.", "AbortError");
  const armed = cloudflareArmedTimeoutMs(task, drafting, Date.now(), budgetDeadlineAt);
  if (armed <= 0) throw providerTimeoutError();
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), armed);
  const signal = callerSignal ? AbortSignal.any([callerSignal, timeout.signal]) : timeout.signal;
  try {
    onStart?.();
    const response = await fetchImpl(endpoint(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken() ?? ""}`,
        "Content-Type": "application/json",
      },
      body: generationBody(task, systemInstruction, prompt, temperature, drafting, model),
      signal,
    });
    const payload = await readPayload(response, signal);
    const codes = classifiedCode(payload);
    if (!response.ok) throw classifyStatus(response.status, codes.recognised, codes.providerCode);
    if (finishReason(payload) === "length") {
      throw new AiProviderError({
        message: "The AI provider response was truncated.",
        kind: "parse",
        provider: PROVIDER_ID,
        retryable: false,
        rawMessage: "cloudflare_truncated",
      });
    }
    const record = payload && typeof payload === "object" ? payload as { success?: unknown } : null;
    if (record?.success === false) {
      throw codes.recognised === null && codes.providerCode === null
        ? shapeError()
        : classifyStatus(200, codes.recognised, codes.providerCode);
    }
    const content = cloudflareMessage(payload);
    if (content.kind === "missing") throw shapeError();
    return content;
  } catch (error) {
    if (error instanceof AiProviderError) throw error;
    if (callerSignal?.aborted) {
      throw new DOMException("The answer deadline elapsed.", "AbortError");
    }
    if (timeout.signal.aborted) throw providerTimeoutError();
    if (aborted(error, signal)) {
      throw new DOMException("The answer deadline elapsed.", "AbortError");
    }
    const errno = error instanceof Error && "code" in error ? (error as { code?: string }).code : undefined;
    throw new AiProviderError({
      message: "The AI provider is temporarily unavailable.",
      kind: "unavailable",
      retryable: true,
      provider: PROVIDER_ID,
      rawMessage: "cloudflare_transport",
      cause: { code: errno === "ETIMEDOUT" || errno === "EAI_AGAIN" ? errno : "ECONNRESET" },
    });
  } finally {
    clearTimeout(timer);
  }
}

function noteOutcome(request: { onProviderAttempt?: (attempt: ProviderAttempt) => void }, outcome: ProviderAttempt["outcome"], model: string): void {
  request.onProviderAttempt?.({ model, outcome });
}

function resolveModel(request: { onProviderAttempt?: (attempt: ProviderAttempt) => void }): string {
  try {
    return cloudflareModel();
  } catch (error) {
    request.onProviderAttempt?.({ model: CLOUDFLARE_FREE_TIER_MODEL, outcome: "other" });
    throw error;
  }
}

function parseJsonText(text: string): unknown {
  return JSON.parse(text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, ""));
}

export async function generateJson<T>(request: AiGenerateJsonRequest, fetchImpl: FetchLike = fetch): Promise<T> {
  const model = resolveModel(request);
  try {
    const content = await complete(
      request.task, request.systemInstruction, request.prompt, request.temperature, request.signal, fetchImpl,
      () => request.onProviderAttemptStart?.(model), false, model, request.budgetDeadlineAt,
    );
    const parsed = (content.kind === "object" ? content.value : parseJsonText(content.text)) as T;
    request.validate?.(parsed);
    noteOutcome(request, "ok", model);
    return parsed;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      noteOutcome(request, "timeout", model);
      throw error;
    }
    if (error instanceof AiProviderError) {
      noteOutcome(request, error.rawMessage === "cloudflare_timeout" ? "timeout" : error.kind === "rate_limited" ? "429" : error.retryable ? "5xx" : "other", model);
      throw error;
    }
    noteOutcome(request, "other", model);
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
  const model = resolveModel(request);
  try {
    const content = await complete(
      request.task, request.systemInstruction, request.prompt, request.temperature, request.signal, fetchImpl,
      () => request.onProviderAttemptStart?.(model), true, model, request.budgetDeadlineAt,
    );
    const text = content.kind === "text" ? content.text : JSON.stringify(content.value);
    request.onChunk?.(text);
    noteOutcome(request, "ok", model);
    return text;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      noteOutcome(request, "timeout", model);
      throw error;
    }
    if (error instanceof AiProviderError) {
      noteOutcome(request, error.rawMessage === "cloudflare_timeout" ? "timeout" : error.kind === "rate_limited" ? "429" : error.retryable ? "5xx" : "other", model);
      throw error;
    }
    noteOutcome(request, "other", model);
    throw error;
  }
}

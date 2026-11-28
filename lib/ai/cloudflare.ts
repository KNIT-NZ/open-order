import { AiProviderError } from "./errors";
import type { AiGenerateJsonRequest, AiStreamTextRequest, ProviderAttempt } from "./types";

const PROVIDER_ID = "cloudflare";

/**
 * Workers AI free-tier instruct model. It is on Cloudflare's included allocation
 * (no per-token charge inside that allocation) and can follow a system prompt,
 * which the answer route needs. A paid model is never the default.
 */
export const CLOUDFLARE_FREE_TIER_MODEL = "@cf/meta/llama-3.1-8b-instruct";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function accountId(): string | null {
  const value = process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? "";
  return /^[a-f0-9]{32}$/i.test(value) ? value : null;
}

function apiToken(): string | null {
  const value = process.env.CLOUDFLARE_API_TOKEN?.trim() ?? "";
  return value.length > 0 ? value : null;
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
  return `https://api.cloudflare.com/client/v4/accounts/${id}/ai/run/${CLOUDFLARE_FREE_TIER_MODEL}`;
}

function classifyStatus(status: number, errorCode: number | null): AiProviderError {
  const codeNote = errorCode === null ? "" : ` code ${errorCode}`;
  if (status === 429 || errorCode === 10429 || errorCode === 971) {
    return new AiProviderError({
      message: "The AI model is temporarily rate limited. Please try again.",
      kind: "rate_limited",
      statusCode: status,
      retryable: true,
      provider: PROVIDER_ID,
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
      rawMessage: `cloudflare_http_${status}`,
    });
  }
  return new AiProviderError({
    message: `The AI provider returned HTTP ${status}.`,
    kind: "upstream",
    statusCode: status,
    retryable: false,
    provider: PROVIDER_ID,
    rawMessage: `cloudflare_http_${status}${codeNote}`.trim(),
  });
}

async function numericErrorCode(response: Response): Promise<number | null> {
  try {
    const body = await response.json() as { errors?: Array<{ code?: unknown }> };
    const code = body.errors?.[0]?.code;
    return typeof code === "number" && Number.isInteger(code) ? code : null;
  } catch {
    return null;
  }
}

function responseText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as { result?: unknown; success?: unknown };
  const result = record.result;
  if (typeof result === "string") return result;
  if (result && typeof result === "object") {
    const text = (result as { response?: unknown }).response;
    if (typeof text === "string") return text;
  }
  return "";
}

async function complete(systemInstruction: string, prompt: string, signal: AbortSignal | undefined, fetchImpl: FetchLike): Promise<string> {
  if (signal?.aborted) throw new DOMException("The answer deadline elapsed.", "AbortError");
  let response: Response;
  try {
    response = await fetchImpl(endpoint(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken() ?? ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: prompt },
        ],
      }),
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
  if (!response.ok) throw classifyStatus(response.status, await numericErrorCode(response));
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
  const record = payload as { success?: unknown; errors?: Array<{ code?: unknown }> };
  if (record.success === false) {
    const code = record.errors?.[0]?.code;
    const note = typeof code === "number" ? ` code ${code}` : "";
    throw new AiProviderError({
      message: "The AI provider returned a response that could not be read.",
      kind: "upstream",
      provider: PROVIDER_ID,
      retryable: false,
      rawMessage: `cloudflare_unsuccessful${note}`,
    });
  }
  const text = responseText(payload).trim();
  if (!text) {
    throw new AiProviderError({
      message: "The AI provider returned a response that could not be read.",
      kind: "parse",
      provider: PROVIDER_ID,
      retryable: false,
      rawMessage: "cloudflare_empty",
    });
  }
  return text;
}

function noteAttempt(request: { onProviderAttempt?: (attempt: ProviderAttempt) => void; onProviderAttemptStart?: (model: string) => void }, outcome: ProviderAttempt["outcome"]): void {
  request.onProviderAttemptStart?.(CLOUDFLARE_FREE_TIER_MODEL);
  request.onProviderAttempt?.({ model: CLOUDFLARE_FREE_TIER_MODEL, outcome });
}

export async function generateJson<T>(request: AiGenerateJsonRequest, fetchImpl: FetchLike = fetch): Promise<T> {
  try {
    const text = await complete(request.systemInstruction, request.prompt, request.signal, fetchImpl);
    const parsed = JSON.parse(text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "")) as T;
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
    const text = await complete(request.systemInstruction, request.prompt, request.signal, fetchImpl);
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

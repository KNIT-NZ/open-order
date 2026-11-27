import { reserveTesterModelAttempt } from "./tester-admission";
// lib/ai/gemini.ts
import { GoogleGenAI } from "@google/genai";
import { AiProviderError } from "./errors";

export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";

const FREE_TIER_MODEL_PATTERN = /^gemini-[a-z0-9][a-z0-9._-]{0,60}$/i;

/** Ordered free-tier models with separate quotas. Tester mode stays on the pinned model. */
export function geminiFreeTierChain(): string[] {
  if (process.env.OPEN_ORDER_INFERENCE_MODE?.trim() === "zero-billed-test") {
    return [GEMINI_MODEL];
  }
  const listed = (process.env.GEMINI_FREE_TIER_MODELS ?? "gemini-3.5-flash-lite,gemini-3.6-flash")
    .split(",")
    .map((model) => model.trim())
    .filter((model) => FREE_TIER_MODEL_PATTERN.test(model));
  const chain: string[] = [];
  const preferred = process.env.GEMINI_MODEL?.trim();
  if (preferred && FREE_TIER_MODEL_PATTERN.test(preferred)) chain.push(preferred);
  for (const model of listed) if (!chain.includes(model)) chain.push(model);
  return chain.length > 0 ? chain : ["gemini-3.5-flash-lite", "gemini-3.6-flash"];
}

// Disable application-managed retries for the zero-billed tester mode.
// An SDK-level retry audit is still required before live tester authorisation.
const GEMINI_MAX_RETRIES =
  process.env.OPEN_ORDER_INFERENCE_MODE?.trim() === "zero-billed-test" ? 0 : 2;
const GEMINI_INITIAL_BACKOFF_MS = 700;
const GEMINI_MAX_BACKOFF_MS = 2500;

export { AiProviderError } from "./errors";
export type { AiErrorKind } from "./errors";

function getApiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new AiProviderError({
      message: "Missing GEMINI_API_KEY in server environment.",
      kind: "configuration",
      retryable: false,
    });
  }

  return apiKey;
}

async function getClient(): Promise<GoogleGenAI> {
  // Defence in depth if a future caller imports the Gemini adapter directly.
  if (process.env.OPEN_ORDER_INFERENCE_MODE?.trim() === "zero-billed-test") {
    if (GEMINI_MODEL !== "gemini-3.5-flash-lite") {
      throw new Error("Tester mode rejected a non-allowlisted Gemini model.");
    }
  }
  const apiKey = getApiKey();
  await reserveTesterModelAttempt();
  return new GoogleGenAI({ apiKey });
}

export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

function stripCodeFences(input: string): string {
  return input
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function extractLikelyJson(input: string): string {
  const cleaned = stripCodeFences(input);

  const objectStart = cleaned.indexOf("{");
  const objectEnd = cleaned.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    return cleaned.slice(objectStart, objectEnd + 1);
  }

  const arrayStart = cleaned.indexOf("[");
  const arrayEnd = cleaned.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    return cleaned.slice(arrayStart, arrayEnd + 1);
  }

  return cleaned;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeBackoffMs(attempt: number): number {
  const base = Math.min(
    GEMINI_INITIAL_BACKOFF_MS * Math.pow(2, attempt),
    GEMINI_MAX_BACKOFF_MS,
  );

  const jitter = Math.floor(Math.random() * 250);
  return base + jitter;
}

function safeJsonParse(input: string): unknown | null {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function extractStatusCode(error: unknown): number | null {
  const seen = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object" && !seen.has(current); depth += 1) {
    seen.add(current);
    const record = current as Record<string, unknown>;
    const nested = record.error && typeof record.error === "object"
      ? record.error as Record<string, unknown> : null;
    for (const raw of [record.status, record.statusCode, nested?.code]) {
      const status = typeof raw === "number" ? raw :
        typeof raw === "string" && /^[45]\d\d$/.test(raw) ? Number(raw) : null;
      if (status !== null && Number.isInteger(status) && status >= 400 && status <= 599) return status;
    }
    current = record.cause;
  }
  // Some SDK versions embed only a JSON error body in the exception message.
  const message = error instanceof Error ? error.message : "";
  const parsed = safeJsonParse(message);
  if (parsed && typeof parsed === "object" && "error" in parsed &&
      parsed.error && typeof parsed.error === "object" && "code" in parsed.error) {
    const code = parsed.error.code;
    if (typeof code === "number" && Number.isInteger(code) && code >= 400 && code <= 599) return code;
  }
  return null;
}

function extractErrorCode(error: unknown): string | null {
  const seen = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object" && !seen.has(current); depth += 1) {
    seen.add(current);
    const value = current as Record<string, unknown>;
    const nested = value.error && typeof value.error === "object"
      ? value.error as Record<string, unknown> : null;
    for (const raw of [value.code, value.status, nested?.status, nested?.code]) {
      if (typeof raw === "string" && /^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(raw)) return raw.toUpperCase();
    }
    current = value.cause;
  }
  return null;
}

function extractRawMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === "string") {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function isRetryableStatus(statusCode: number | null): boolean {
  return (
    statusCode === 429 ||
    statusCode === 500 ||
    statusCode === 502 ||
    statusCode === 503 ||
    statusCode === 504
  );
}

function classifyError(error: unknown): AiProviderError {
  if (error instanceof AiProviderError) return error;
  const rawMessage = extractRawMessage(error);
  const statusCode = extractStatusCode(error);
  const errorCode = extractErrorCode(error);
  const codeTransient = errorCode !== null && ["UNAVAILABLE", "RESOURCE_EXHAUSTED",
    "DEADLINE_EXCEEDED", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN"].includes(errorCode);
  const retryable = isRetryableStatus(statusCode) || codeTransient;
  if (statusCode === 429 || errorCode === "RESOURCE_EXHAUSTED") {
    return new AiProviderError({ message: "The AI model is temporarily rate limited. Please try again.",
      kind: "rate_limited", statusCode, retryable: true, provider: "gemini", rawMessage, cause: error });
  }
  if (statusCode === 503 || errorCode === "UNAVAILABLE") {
    return new AiProviderError({ message: "The AI provider is temporarily unavailable.",
      kind: "unavailable", statusCode, retryable: true, provider: "gemini", rawMessage, cause: error });
  }
  if (retryable) {
    return new AiProviderError({ message: "The AI provider is temporarily unavailable.",
      kind: "upstream", statusCode, retryable: true, provider: "gemini", rawMessage, cause: error });
  }
  if (statusCode !== null) {
    return new AiProviderError({ message: statusCode === 404
      ? `The configured Gemini model "${GEMINI_MODEL}" was not found or is unavailable.`
      : `The AI provider returned HTTP ${statusCode}.`, kind: "upstream", statusCode,
      retryable: false, provider: "gemini", rawMessage, cause: error });
  }
  if (rawMessage.includes("Missing GEMINI_API_KEY") || rawMessage.includes("server environment")) {
    return new AiProviderError({ message: "AI model configuration is missing on the server.",
      kind: "configuration", provider: "gemini", retryable: false, rawMessage, cause: error });
  }
  return new AiProviderError({ message: "An unexpected AI provider error occurred.",
    kind: "unknown", provider: "gemini", retryable: false, rawMessage, cause: error });
}

export async function runGeminiChain<T>(
  operation: (model: string) => Promise<T>,
  hooks?: { sleep?: (ms: number) => Promise<void>; onRetry?: () => void },
): Promise<T> {
  const pause = hooks?.sleep ?? sleep;
  const chain = geminiFreeTierChain();
  let lastError: AiProviderError | null = null;
  for (const model of chain) {
    const attempts = GEMINI_MAX_RETRIES > 0 ? 2 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await operation(model);
      } catch (error) {
        const classified = classifyError(error);
        lastError = classified;
        const rateLimited = classified.kind === "rate_limited" || classified.statusCode === 429;
        if (classified.retryable && attempt + 1 < attempts) {
          hooks?.onRetry?.();
          await pause(computeBackoffMs(attempt));
          continue;
        }
        if (rateLimited || classified.retryable) break;
        throw classified;
      }
    }
  }
  throw lastError ?? new AiProviderError({
    message: "The AI provider failed after retries.",
    kind: "unknown",
    retryable: false,
    provider: "gemini",
  });
}

export async function generateJson<T>({
  systemInstruction,
  prompt,
  temperature = 0.2,
  onProviderRetry,
}: {
  systemInstruction: string;
  prompt: string;
  temperature?: number;
  onProviderRetry?: () => void;
}): Promise<T> {
  return runGeminiChain(async (model) => {
    const gemini = await getClient();

    const response = await gemini.models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction,
        temperature,
        responseMimeType: "application/json",
      },
    });

    const text = response.text ?? "";
    const jsonText = extractLikelyJson(text);

    try {
      return JSON.parse(jsonText) as T;
    } catch (error) {
      throw new AiProviderError({
        message: "Failed to parse AI JSON response.",
        kind: "parse",
        retryable: false,
        rawMessage: `Raw response:\n${text}\n\nParsed candidate:\n${jsonText}\n\nError: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  }, { onRetry: onProviderRetry });
}

export async function streamText({
  systemInstruction,
  prompt,
  temperature = 0.2,
  onChunk,
  onProviderRetry,
}: {
  systemInstruction: string;
  prompt: string;
  temperature?: number;
  onChunk?: (text: string) => void;
  onProviderRetry?: () => void;
}): Promise<string> {
  return runGeminiChain(async (model) => {
    const gemini = await getClient();

    // The answer route has no onChunk consumer: avoid an unnecessary streaming
    // transport while retaining true streaming for callers that request it.
    if (!onChunk) {
      const response = await gemini.models.generateContent({
        model,
        contents: prompt,
        config: { systemInstruction, temperature },
      });
      return response.text ?? "";
    }

    const response = await gemini.models.generateContentStream({
      model,
      contents: prompt,
      config: { systemInstruction, temperature },
    });

    let fullText = "";

    for await (const chunk of response) {
      const text = chunk.text ?? "";
      if (!text) continue;

      fullText += text;
      onChunk?.(text);
    }

    return fullText;
  }, { onRetry: onProviderRetry });
}

import { GoogleGenAI } from "@google/genai";

export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const GEMINI_MAX_RETRIES = 2;
const GEMINI_INITIAL_BACKOFF_MS = 700;
const GEMINI_MAX_BACKOFF_MS = 2500;

export type AiErrorKind =
  | "configuration"
  | "rate_limited"
  | "unavailable"
  | "upstream"
  | "parse"
  | "unknown";

export class AiProviderError extends Error {
  kind: AiErrorKind;
  statusCode: number | null;
  retryable: boolean;
  provider: string;
  rawMessage?: string;

  constructor(params: {
    message: string;
    kind: AiErrorKind;
    statusCode?: number | null;
    retryable?: boolean;
    provider?: string;
    rawMessage?: string;
  }) {
    super(params.message);
    this.name = "AiProviderError";
    this.kind = params.kind;
    this.statusCode = params.statusCode ?? null;
    this.retryable = params.retryable ?? false;
    this.provider = params.provider ?? "gemini";
    this.rawMessage = params.rawMessage;
  }
}

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

function getClient(): GoogleGenAI {
  return new GoogleGenAI({ apiKey: getApiKey() });
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
  if (!error || typeof error !== "object") return null;

  const directStatus =
    "status" in error && typeof error.status === "number"
      ? error.status
      : null;

  if (directStatus) return directStatus;

  const message =
    "message" in error && typeof error.message === "string"
      ? error.message
      : "";

  if (!message) return null;

  const parsed = safeJsonParse(message);
  if (
    parsed &&
    typeof parsed === "object" &&
    parsed !== null &&
    "error" in parsed &&
    parsed.error &&
    typeof parsed.error === "object" &&
    "code" in parsed.error &&
    typeof parsed.error.code === "number"
  ) {
    return parsed.error.code;
  }

  const codeMatch = message.match(/"code"\s*:\s*(\d{3})/);
  if (codeMatch) {
    return Number(codeMatch[1]);
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
  return statusCode === 429 || statusCode === 500 || statusCode === 502 || statusCode === 503 || statusCode === 504;
}

function classifyError(error: unknown): AiProviderError {
  if (error instanceof AiProviderError) {
    return error;
  }

  const rawMessage = extractRawMessage(error);
  const statusCode = extractStatusCode(error);

  if (statusCode === 429) {
    return new AiProviderError({
      message: "The AI model is temporarily rate limited. Please try again.",
      kind: "rate_limited",
      statusCode,
      retryable: true,
      rawMessage,
    });
  }

  if (statusCode === 503) {
    return new AiProviderError({
      message:
        "The AI model is temporarily unavailable due to high demand. Search still works, and you can retry in a moment.",
      kind: "unavailable",
      statusCode,
      retryable: true,
      rawMessage,
    });
  }

  if (statusCode !== null && isRetryableStatus(statusCode)) {
    return new AiProviderError({
      message:
        "The AI provider is temporarily unavailable. Search still works, and you can retry in a moment.",
      kind: "upstream",
      statusCode,
      retryable: true,
      rawMessage,
    });
  }

  if (statusCode !== null) {
    return new AiProviderError({
      message: `The AI provider returned an error${statusCode ? ` (${statusCode})` : ""}.`,
      kind: "upstream",
      statusCode,
      retryable: false,
      rawMessage,
    });
  }

  if (
    rawMessage.includes("Missing GEMINI_API_KEY") ||
    rawMessage.includes("server environment")
  ) {
    return new AiProviderError({
      message: "AI model configuration is missing on the server.",
      kind: "configuration",
      retryable: false,
      rawMessage,
    });
  }

  return new AiProviderError({
    message: "An unexpected AI provider error occurred.",
    kind: "unknown",
    retryable: false,
    rawMessage,
  });
}

async function withRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: AiProviderError | null = null;

  for (let attempt = 0; attempt <= GEMINI_MAX_RETRIES; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const classified = classifyError(error);
      lastError = classified;

      const shouldRetry =
        classified.retryable && attempt < GEMINI_MAX_RETRIES;

      if (!shouldRetry) {
        throw classified;
      }

      await sleep(computeBackoffMs(attempt));
    }
  }

  throw (
    lastError ??
    new AiProviderError({
      message: "The AI provider failed after retries.",
      kind: "unknown",
      retryable: false,
    })
  );
}

export async function generateJson<T>({
  systemInstruction,
  prompt,
  temperature = 0.2,
}: {
  systemInstruction: string;
  prompt: string;
  temperature?: number;
}): Promise<T> {
  return withRetry(async () => {
    const gemini = getClient();

    const response = await gemini.models.generateContent({
      model: GEMINI_MODEL,
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
  });
}

export async function streamText({
  systemInstruction,
  prompt,
  temperature = 0.2,
  onChunk,
}: {
  systemInstruction: string;
  prompt: string;
  temperature?: number;
  onChunk?: (text: string) => void;
}): Promise<string> {
  return withRetry(async () => {
    const gemini = getClient();

    const response = await gemini.models.generateContentStream({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        systemInstruction,
        temperature,
      },
    });

    let fullText = "";

    for await (const chunk of response) {
      const text = chunk.text ?? "";
      if (!text) continue;

      fullText += text;
      onChunk?.(text);
    }

    return fullText;
  });
}
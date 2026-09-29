import { AiProviderError } from "./errors";
import type {
  AiGenerateJsonRequest,
  AiStreamTextRequest,
  AiTask,
} from "./types";

const PROVIDER_ID = "openai-compatible";
const MAX_RETRIES = 2;
const INITIAL_BACKOFF_MS = 700;
const MAX_BACKOFF_MS = 2500;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getBaseUrl(): string | null {
  const value = process.env.AI_OPENAI_COMPATIBLE_BASE_URL?.trim();
  if (!value) return null;
  return value.replace(/\/+$/, "");
}

function getModel(task: AiTask): string | null {
  const taskSpecific =
    task === "query.plan"
      ? process.env.AI_OPENAI_COMPATIBLE_QUERY_MODEL?.trim()
      : process.env.AI_OPENAI_COMPATIBLE_ANSWER_MODEL?.trim();

  return taskSpecific || process.env.AI_OPENAI_COMPATIBLE_MODEL?.trim() || null;
}

function getApiKey(): string | null {
  return process.env.AI_OPENAI_COMPATIBLE_API_KEY?.trim() || null;
}

export function isOpenAiCompatibleConfigured(task: AiTask): boolean {
  return Boolean(getBaseUrl() && getModel(task));
}

function getEndpoint(): string {
  const baseUrl = getBaseUrl();
  if (!baseUrl) {
    throw new AiProviderError({
      message: "AI OpenAI-compatible base URL is not configured.",
      kind: "configuration",
      provider: PROVIDER_ID,
    });
  }

  try {
    return new URL(`${baseUrl}/chat/completions`).toString();
  } catch {
    throw new AiProviderError({
      message: "AI OpenAI-compatible base URL is invalid.",
      kind: "configuration",
      provider: PROVIDER_ID,
    });
  }
}

function getHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const apiKey = getApiKey();
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
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
    INITIAL_BACKOFF_MS * Math.pow(2, attempt),
    MAX_BACKOFF_MS,
  );
  return base + Math.floor(Math.random() * 250);
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

function classifyStatus(
  statusCode: number,
  rawMessage: string,
  model: string,
): AiProviderError {
  if (statusCode === 429) {
    return new AiProviderError({
      message: "The AI model is temporarily rate limited. Please try again.",
      kind: "rate_limited",
      statusCode,
      retryable: true,
      provider: PROVIDER_ID,
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
      provider: PROVIDER_ID,
      rawMessage,
    });
  }

  return new AiProviderError({
    message:
      statusCode === 404
        ? `The configured AI model "${model}" was not found or is not available to this provider.`
        : `The AI provider returned an error (${statusCode}).`,
    kind: "upstream",
    statusCode,
    retryable: isRetryableStatus(statusCode),
    provider: PROVIDER_ID,
    rawMessage,
  });
}

function classifyThrown(error: unknown): AiProviderError {
  if (error instanceof AiProviderError) {
    return error;
  }

  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error);

  return new AiProviderError({
    message:
      "The AI provider is temporarily unavailable. Search still works, and you can retry in a moment.",
    kind: "upstream",
    retryable: true,
    provider: PROVIDER_ID,
    rawMessage,
  });
}

async function withRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: AiProviderError | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const classified = classifyThrown(error);
      lastError = classified;

      if (!classified.retryable || attempt >= MAX_RETRIES) {
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
      provider: PROVIDER_ID,
    })
  );
}

function buildRequestBody(params: {
  task: AiTask;
  systemInstruction: string;
  prompt: string;
  temperature: number;
  stream: boolean;
}): JsonRecord {
  const model = getModel(params.task);
  if (!model) {
    throw new AiProviderError({
      message: "AI OpenAI-compatible model is not configured.",
      kind: "configuration",
      provider: PROVIDER_ID,
    });
  }

  return {
    model,
    messages: [
      { role: "system", content: params.systemInstruction },
      { role: "user", content: params.prompt },
    ],
    temperature: params.temperature,
    stream: params.stream,
  };
}

async function readErrorResponse(
  response: Response,
  model: string,
): Promise<AiProviderError> {
  let rawMessage = "";
  try {
    rawMessage = (await response.text()).slice(0, 4000);
  } catch {
    rawMessage = response.statusText;
  }
  return classifyStatus(response.status, rawMessage, model);
}

function extractCompletionText(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) {
    throw new AiProviderError({
      message: "The AI provider returned an unexpected completion shape.",
      kind: "upstream",
      provider: PROVIDER_ID,
      rawMessage: JSON.stringify(payload).slice(0, 4000),
    });
  }

  const first = payload.choices[0];
  if (!isRecord(first) || !isRecord(first.message)) {
    throw new AiProviderError({
      message: "The AI provider returned an unexpected completion message.",
      kind: "upstream",
      provider: PROVIDER_ID,
      rawMessage: JSON.stringify(payload).slice(0, 4000),
    });
  }

  return typeof first.message.content === "string"
    ? first.message.content
    : "";
}

function extractDeltaText(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) {
    return "";
  }

  const first = payload.choices[0];
  if (!isRecord(first) || !isRecord(first.delta)) {
    return "";
  }

  return typeof first.delta.content === "string"
    ? first.delta.content
    : "";
}

function containsProviderError(payload: unknown): boolean {
  return isRecord(payload) && "error" in payload;
}

export async function generateJson<T>(
  request: AiGenerateJsonRequest,
): Promise<T> {
  return withRetry(async () => {
    const model = getModel(request.task);
    if (!model) {
      throw new AiProviderError({
        message: "AI OpenAI-compatible model is not configured.",
        kind: "configuration",
        provider: PROVIDER_ID,
      });
    }

    const response = await fetch(getEndpoint(), {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify(
        buildRequestBody({
          task: request.task,
          systemInstruction: request.systemInstruction,
          prompt: request.prompt,
          temperature: request.temperature ?? 0.2,
          stream: false,
        }),
      ),
    });

    if (!response.ok) {
      throw await readErrorResponse(response, model);
    }

    const payload: unknown = await response.json();
    const text = extractCompletionText(payload);
    const jsonText = extractLikelyJson(text);

    try {
      return JSON.parse(jsonText) as T;
    } catch (error) {
      throw new AiProviderError({
        message: "Failed to parse AI JSON response.",
        kind: "parse",
        retryable: false,
        provider: PROVIDER_ID,
        rawMessage: `Raw response:\n${text}\n\nParsed candidate:\n${jsonText}\n\nError: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  });
}

async function consumeSse(
  response: Response,
  onChunk?: (text: string) => void,
): Promise<string> {
  if (!response.body) {
    throw new AiProviderError({
      message: "The AI provider returned no streaming response body.",
      kind: "upstream",
      provider: PROVIDER_ID,
    });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  const processLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(":")) return;
    if (!trimmed.startsWith("data:")) return;

    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") return;

    let payload: unknown;
    try {
      payload = JSON.parse(data) as unknown;
    } catch {
      throw new AiProviderError({
        message: "The AI provider returned invalid streaming JSON.",
        kind: "parse",
        provider: PROVIDER_ID,
        rawMessage: data.slice(0, 4000),
      });
    }

    if (containsProviderError(payload)) {
      throw new AiProviderError({
        message: "The AI provider returned a streaming error.",
        kind: "upstream",
        provider: PROVIDER_ID,
        rawMessage: JSON.stringify(payload).slice(0, 4000),
      });
    }

    const text = extractDeltaText(payload);
    if (!text) return;

    fullText += text;
    onChunk?.(text);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex < 0) break;

      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      processLine(line);
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    processLine(buffer);
  }

  return fullText;
}

export async function streamText(
  request: AiStreamTextRequest,
): Promise<string> {
  let lastError: AiProviderError | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    let emittedText = false;

    try {
      const model = getModel(request.task);
      if (!model) {
        throw new AiProviderError({
          message: "AI OpenAI-compatible model is not configured.",
          kind: "configuration",
          provider: PROVIDER_ID,
        });
      }

      const response = await fetch(getEndpoint(), {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify(
          buildRequestBody({
            task: request.task,
            systemInstruction: request.systemInstruction,
            prompt: request.prompt,
            temperature: request.temperature ?? 0.2,
            stream: true,
          }),
        ),
      });

      if (!response.ok) {
        throw await readErrorResponse(response, model);
      }

      return await consumeSse(response, (text) => {
        emittedText = true;
        request.onChunk?.(text);
      });
    } catch (error) {
      const classified = classifyThrown(error);
      lastError = classified;

      // Once this provider attempt has emitted text, replaying the request can
      // duplicate or splice user-visible prose. Surface the error immediately.
      if (emittedText) {
        throw classified;
      }

      if (!classified.retryable || attempt >= MAX_RETRIES) {
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
      provider: PROVIDER_ID,
    })
  );
}

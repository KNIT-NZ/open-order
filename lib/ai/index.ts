import {
  AiProviderError,
  normalizeAiProviderError,
} from "./errors";
import * as cloudflare from "./cloudflare";
import * as gemini from "./gemini";
import * as openAiCompatible from "./openai-compatible";
import { getAiCandidates } from "./routes";
import type {
  AiGenerateJsonRequest,
  AiProviderId,
  AiStreamTextRequest,
  AiTask,
} from "./types";

export { AiProviderError } from "./errors";
export type { AiErrorKind } from "./errors";
export type {
  AiGenerateJsonRequest,
  AiLane,
  AiProviderId,
  AiStreamTextRequest,
  AiTask,
} from "./types";

type ProviderRuntime = {
  isConfigured: (task: AiTask) => boolean;
  generateJson: <T>(request: AiGenerateJsonRequest) => Promise<T>;
  streamText: (request: AiStreamTextRequest) => Promise<string>;
};

const PROVIDERS: Record<AiProviderId, ProviderRuntime> = {
  gemini: {
    isConfigured: () => gemini.isGeminiConfigured(),
    generateJson: <T>(request: AiGenerateJsonRequest) =>
      gemini.generateJson<T>({
        systemInstruction: request.systemInstruction,
        prompt: request.prompt,
        temperature: request.temperature,
        onProviderRetry: request.onProviderRetry,
        onProviderAttempt: request.onProviderAttempt,
        onProviderAttemptStart: request.onProviderAttemptStart,
        signal: request.signal,
        validate: request.validate,
      }),
    streamText: (request: AiStreamTextRequest) =>
      gemini.streamText({
        systemInstruction: request.systemInstruction,
        prompt: request.prompt,
        temperature: request.temperature,
        onChunk: request.onChunk,
        onProviderRetry: request.onProviderRetry,
        onProviderAttempt: request.onProviderAttempt,
        onProviderAttemptStart: request.onProviderAttemptStart,
        signal: request.signal,
      }),
  },
  "openai-compatible": {
    isConfigured: (task) =>
      openAiCompatible.isOpenAiCompatibleConfigured(task),
    generateJson: <T>(request: AiGenerateJsonRequest) =>
      openAiCompatible.generateJson<T>(request),
    streamText: (request: AiStreamTextRequest) =>
      openAiCompatible.streamText(request),
  },
  cloudflare: {
    isConfigured: () => cloudflare.isCloudflareConfigured(),
    generateJson: <T>(request: AiGenerateJsonRequest) =>
      cloudflare.generateJson<T>(request),
    streamText: (request: AiStreamTextRequest) =>
      cloudflare.streamText(request),
  },
};

/** Prefer a diagnosed upstream failure over a later opaque failover error. */
/** Keep a retryable primary failure ahead of a later non-retryable configuration error. */
export function preferDiagnosedError(
  existing: AiProviderError | null,
  incoming: AiProviderError,
): AiProviderError {
  if (!existing) return incoming;
  if (existing.retryable && !incoming.retryable) return existing;
  if (incoming.retryable && !existing.retryable) return incoming;
  const quality = (error: AiProviderError) =>
    error.statusCode !== null ? 3 : error.kind !== "unknown" ? 2 : 0;
  return quality(incoming) > quality(existing) ? incoming : existing;
}

function noProviderConfigured(task: AiTask): AiProviderError {
  return new AiProviderError({
    message: "AI model configuration is missing on the server.",
    kind: "configuration",
    provider: "router",
    rawMessage: `No configured provider candidate was available for task ${task}.`,
  });
}

export async function generateJson<T>(
  request: AiGenerateJsonRequest,
): Promise<T> {
  const candidates = getAiCandidates(request.task);
  let configuredCount = 0;
  let lastError: AiProviderError | null = null;

  for (const providerId of candidates) {
    const provider = PROVIDERS[providerId];
    if (providerId === "cloudflare" && cloudflare.cloudflareQuotaSkipped()) {
      lastError = preferDiagnosedError(lastError, cloudflare.cloudflareQuotaSkipError());
      configuredCount += 1;
      continue;
    }
    if (!provider.isConfigured(request.task)) {
      continue;
    }

    configuredCount += 1;

    try {
      return await provider.generateJson<T>(request);
    } catch (error) {
      if (request.signal?.aborted || (error instanceof DOMException && error.name === "AbortError" && request.signal?.aborted)) {
        throw error;
      }
      lastError = preferDiagnosedError(lastError, normalizeAiProviderError(error, providerId));
    }
  }

  if (configuredCount === 0) {
    throw noProviderConfigured(request.task);
  }

  throw (
    lastError ??
    new AiProviderError({
      message: "The AI provider failed.",
      kind: "unknown",
      provider: "router",
    })
  );
}

export async function streamText(
  request: AiStreamTextRequest,
): Promise<string> {
  const candidates = getAiCandidates(request.task);
  let configuredCount = 0;
  let lastError: AiProviderError | null = null;

  for (const providerId of candidates) {
    const provider = PROVIDERS[providerId];
    if (providerId === "cloudflare" && cloudflare.cloudflareQuotaSkipped()) {
      lastError = preferDiagnosedError(lastError, cloudflare.cloudflareQuotaSkipError());
      configuredCount += 1;
      continue;
    }
    if (!provider.isConfigured(request.task)) {
      continue;
    }

    configuredCount += 1;
    let emittedText = false;

    try {
      return await provider.streamText({
        ...request,
        onChunk: request.onChunk
          ? (text) => {
              emittedText = true;
              request.onChunk?.(text);
            }
          : undefined,
      });
    } catch (error) {
      if (request.signal?.aborted) throw error;
      const normalized = normalizeAiProviderError(error, providerId);

      if (emittedText) {
        throw normalized;
      }

      lastError = preferDiagnosedError(lastError, normalized);
    }
  }

  if (configuredCount === 0) {
    throw noProviderConfigured(request.task);
  }

  throw (
    lastError ??
    new AiProviderError({
      message: "The AI provider failed.",
      kind: "unknown",
      provider: "router",
    })
  );
}

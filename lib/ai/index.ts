import {
  AiProviderError,
  normalizeAiProviderError,
} from "./errors";
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
      }),
    streamText: (request: AiStreamTextRequest) =>
      gemini.streamText({
        systemInstruction: request.systemInstruction,
        prompt: request.prompt,
        temperature: request.temperature,
        onChunk: request.onChunk,
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
};

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
    if (!provider.isConfigured(request.task)) {
      continue;
    }

    configuredCount += 1;

    try {
      return await provider.generateJson<T>(request);
    } catch (error) {
      lastError = normalizeAiProviderError(error, providerId);
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
      const normalized = normalizeAiProviderError(error, providerId);

      if (emittedText) {
        throw normalized;
      }

      lastError = normalized;
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

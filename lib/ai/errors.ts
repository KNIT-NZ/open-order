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
    this.provider = params.provider ?? "unknown";
    this.rawMessage = params.rawMessage;
  }
}

export function normalizeAiProviderError(
  error: unknown,
  provider: string,
): AiProviderError {
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
    message: "An unexpected AI provider error occurred.",
    kind: "unknown",
    retryable: false,
    provider,
    rawMessage,
  });
}

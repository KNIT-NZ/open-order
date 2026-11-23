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
  cause?: unknown;

  constructor(params: {
    message: string;
    kind: AiErrorKind;
    statusCode?: number | null;
    retryable?: boolean;
    provider?: string;
    rawMessage?: string;
    cause?: unknown;
  }) {
    super(params.message);
    this.name = "AiProviderError";
    this.kind = params.kind;
    this.statusCode = params.statusCode ?? null;
    this.retryable = params.retryable ?? false;
    this.provider = params.provider ?? "unknown";
    this.rawMessage = params.rawMessage;
    this.cause = params.cause;
  }
}

/** Preserve machine-readable provider information without exposing untrusted bodies. */
function structuredFailureStatus(error: unknown): number | null {
  const seen = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object" && !seen.has(current); depth += 1) {
    seen.add(current);
    const value = current as Record<string, unknown>;
    for (const raw of [value.status, value.statusCode,
      value.response && typeof value.response === "object"
        ? (value.response as Record<string, unknown>).status : null,
      value.error && typeof value.error === "object"
        ? (value.error as Record<string, unknown>).code : null]) {
      const status = typeof raw === "number" ? raw :
        typeof raw === "string" && /^[45]\d\d$/.test(raw) ? Number(raw) : null;
      if (status !== null && Number.isInteger(status) && status >= 400 && status <= 599) return status;
    }
    current = value.cause;
  }
  return null;
}

export function normalizeAiProviderError(
  error: unknown,
  provider: string,
): AiProviderError {
  if (error instanceof AiProviderError) return error;

  const rawMessage = error instanceof Error ? error.message :
    typeof error === "string" ? error : String(error);
  const statusCode = structuredFailureStatus(error);
  const retryable = statusCode !== null && [429, 500, 502, 503, 504].includes(statusCode);
  const kind: AiErrorKind = statusCode === 429 ? "rate_limited" :
    statusCode === 503 ? "unavailable" : statusCode !== null ? "upstream" : "unknown";
  return new AiProviderError({
    message: "An AI provider request failed.",
    kind,
    statusCode,
    retryable,
    provider,
    rawMessage,
    cause: error,
  });
}

/**
 * Open Order v38.1 — bounded, source-safe diagnostics and retry for AI validation.
 *
 * We do not infer a transient provider failure from a friendly error message.
 * Only typed statuses/codes are sufficient for retry.  Never record upstream
 * error bodies or messages, because they can contain prompt/source material.
 */
export type AiOperationPhase =
  | "drafting"
  | "claim_validation"
  | "post_validation";

export type AiFailureKind =
  | "provider_transient"
  | "provider_nonretryable"
  | "validation_format"
  | "application_or_unknown";

export type AiFailureDiagnostic = {
  phase: AiOperationPhase;
  kind: AiFailureKind;
  httpStatus: number | null;
  code: string | null;
  provider: string | null;
  upstreamErrorName: string | null;
  retryable: boolean;
  attempts: number;
  elapsedMs: number;
};

export const DIAGNOSTIC_KINDS = [
  "provider_transient",
  "provider_nonretryable",
  "validation_format",
  "application_or_unknown",
] as const;

export const TRANSIENT_STATUSES = new Set([429, 502, 503, 504]);
export const TRANSIENT_CODES = new Set([
  "RESOURCE_EXHAUSTED",
  "UNAVAILABLE",
  "DEADLINE_EXCEEDED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "RATE_LIMITED",
  "RATE_LIMIT",
  "SERVICE_UNAVAILABLE",
  "OVERLOADED",
  "CF_3040",
]);
export const NONRETRYABLE_CODES = new Set([
  "INVALID_ARGUMENT",
  "PERMISSION_DENIED",
  "UNAUTHENTICATED",
  "NOT_FOUND",
  "FAILED_PRECONDITION",
  "CF_3036",
  "CF_5028",
  "CF_3042",
  "CF_5007",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function statusNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value >= 400 && value <= 599 ? value : null;
  }
  if (typeof value === "string" && /^[45]\d\d$/.test(value)) {
    return Number(value);
  }
  return null;
}

function safeCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.toUpperCase().trim();
  return /^[A-Z][A-Z0-9_.-]{0,47}$/.test(code) ? code : null;
}

/** Extract only structured metadata from at most four nested error causes. */
export function classifyAiError(error: unknown, phase: AiOperationPhase):
  Omit<AiFailureDiagnostic, "attempts" | "elapsedMs"> {
  const seen = new Set<unknown>();
  let next: unknown = error;
  let httpStatus: number | null = null;
  let code: string | null = null;
  let provider: string | null = null;
  let upstreamErrorName: string | null = null;
  let formatFailure = false;
  let providerCode: number | null = null;
  for (let depth = 0; depth < 4 && isObject(next) && !seen.has(next); depth += 1) {
    seen.add(next);
    const record = next;
    if (provider === null && (record.provider === "gemini" ||
      record.provider === "openai-compatible" || record.provider === "cloudflare" || record.provider === "router")) {
      provider = record.provider;
    }
    if (upstreamErrorName === null && typeof record.name === "string" &&
      record.name !== "AiProviderError" && /^[A-Za-z][A-Za-z0-9]{0,47}$/.test(record.name)) {
      upstreamErrorName = record.name;
    }
    if (record.name === "ZodError" || record.name === "SyntaxError") {
      formatFailure = true;
    }
    if (providerCode === null && typeof record.providerCode === "number" && Number.isInteger(record.providerCode)) {
      providerCode = record.providerCode;
    }
    if (httpStatus === null) {
      httpStatus = statusNumber(record.status) ?? statusNumber(record.statusCode) ??
        (isObject(record.response) ? statusNumber(record.response.status) : null) ??
        (isObject(record.error) ?
          (statusNumber(record.error.code) ?? statusNumber(record.error.status)) : null) ??
        statusNumber(record.code);
    }
    if (code === null) {
      // A provider kind is not a code. An unknown outer code must not hide a known inner one.
      const raw = safeCode(record.code) ??
        (isObject(record.error) ?
          (safeCode(record.error.code) ?? safeCode(record.error.status)) : null);
      if (raw && (TRANSIENT_CODES.has(raw) || NONRETRYABLE_CODES.has(raw))) code = raw;
    }
    next = record.cause;
  }

  // A schema failure is an invalid validation result, not a capacity signal.
  if (formatFailure) {
    return { phase, kind: "validation_format", httpStatus, code, provider, upstreamErrorName, retryable: false };
  }
  // 3036 is the daily neuron allocation, carried on HTTP 429. It must not be retried.
  if (providerCode === 3036) {
    return { phase, kind: "provider_nonretryable", httpStatus, code: "CF_3036", provider, upstreamErrorName, retryable: false };
  }
  if (providerCode === 5028 || providerCode === 3042 || providerCode === 5007) {
    return {
      phase, kind: "provider_nonretryable", httpStatus,
      code: `CF_${providerCode}`, provider, upstreamErrorName, retryable: false,
    };
  }
  if (providerCode === 3040) {
    return { phase, kind: "provider_transient", httpStatus, code: "CF_3040", provider, upstreamErrorName, retryable: true };
  }
  const typedTransient = (httpStatus !== null && TRANSIENT_STATUSES.has(httpStatus)) ||
    (code !== null && TRANSIENT_CODES.has(code));
  if (typedTransient) {
    return { phase, kind: "provider_transient", httpStatus, code, provider, upstreamErrorName, retryable: true };
  }
  const typedNonretryable = httpStatus !== null || (code !== null && NONRETRYABLE_CODES.has(code));
  if (typedNonretryable) {
    return { phase, kind: "provider_nonretryable", httpStatus, code, provider, upstreamErrorName, retryable: false };
  }
  return { phase, kind: "application_or_unknown", httpStatus, code, provider, upstreamErrorName, retryable: false };
}

export class AiOperationFailure extends Error {
  readonly diagnostic: AiFailureDiagnostic;
  constructor(diagnostic: AiFailureDiagnostic) {
    super("AI operation failed; see structured diagnostic");
    this.name = "AiOperationFailure";
    this.diagnostic = diagnostic;
  }
}

export function failureDiagnostic(
  error: unknown,
  phase: AiOperationPhase,
  attempts: number,
  elapsedMs: number,
): AiFailureDiagnostic {
  if (error instanceof AiOperationFailure) return error.diagnostic;
  return {
    ...classifyAiError(error, phase),
    attempts,
    elapsedMs: Math.max(0, elapsedMs),
  };
}

/**
 * Retry exactly once for a typed transient validation error, provided the
 * entire request is still inside the conservative retry time budget.
 * Never repeat an otherwise successful draft or an invalid-format response.
 */
export async function runClaimValidationWithRetry<T>(input: {
  invoke: () => Promise<T>;
  requestStartedAt: number;
  onRetry?: (diagnostic: AiFailureDiagnostic) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<{ value: T; attempts: number }> {
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? ((ms: number) =>
    new Promise<void>((resolve) => { setTimeout(resolve, ms); }));
  const operationStartedAt = now();
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return { value: await input.invoke(), attempts: attempt };
    } catch (error) {
      const diagnostic: AiFailureDiagnostic = {
        ...classifyAiError(error, "claim_validation"),
        attempts: attempt,
        elapsedMs: Math.max(0, now() - operationStartedAt),
      };
      // With a long first call (e.g. 26s), do not keep a streaming response
      // open merely to make a retry which may exceed the deployment budget.
      if (!diagnostic.retryable || attempt >= 2 ||
          now() + 500 >= input.requestStartedAt + 30_000) {
        throw new AiOperationFailure(diagnostic);
      }
      input.onRetry?.(diagnostic);
      await sleep(500);
    }
  }
  throw new Error("Unreachable validation retry state");
}

/** A code only. No HTTP status, attempt count, or provider prose. */
export function publicFailureReason(diagnostic: AiFailureDiagnostic): string {
  return diagnostic.phase === "drafting" ? "drafting_unavailable" : "validation_unavailable";
}

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

const TRANSIENT_STATUSES = new Set([429, 502, 503, 504]);
const TRANSIENT_CODES = new Set([
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
]);
const NONRETRYABLE_CODES = new Set([
  "INVALID_ARGUMENT",
  "PERMISSION_DENIED",
  "UNAUTHENTICATED",
  "NOT_FOUND",
  "FAILED_PRECONDITION",
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
  for (let depth = 0; depth < 4 && isObject(next) && !seen.has(next); depth += 1) {
    seen.add(next);
    const record = next;
    if (provider === null && (record.provider === "gemini" ||
      record.provider === "openai-compatible" || record.provider === "router")) {
      provider = record.provider;
    }
    if (upstreamErrorName === null && typeof record.name === "string" &&
      record.name !== "AiProviderError" && /^[A-Za-z][A-Za-z0-9]{0,47}$/.test(record.name)) {
      upstreamErrorName = record.name;
    }
    if (record.name === "ZodError" || record.name === "SyntaxError") {
      formatFailure = true;
    }
    if (httpStatus === null) {
      httpStatus = statusNumber(record.status) ?? statusNumber(record.statusCode) ??
        (isObject(record.response) ? statusNumber(record.response.status) : null) ??
        (isObject(record.error) ?
          (statusNumber(record.error.code) ?? statusNumber(record.error.status)) : null) ??
        statusNumber(record.code);
    }
    if (code === null) {
      code = safeCode(record.code) ?? safeCode(record.kind) ??
        (isObject(record.error) ?
          (safeCode(record.error.code) ?? safeCode(record.error.status)) : null);
    }
    next = record.cause;
  }

  // A schema failure is an invalid validation result, not a capacity signal.
  if (formatFailure) {
    return { phase, kind: "validation_format", httpStatus, code, provider, upstreamErrorName, retryable: false };
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

export function publicFailureReason(diagnostic: AiFailureDiagnostic): string {
  const phase = diagnostic.phase === "drafting" ? "Answer drafting" :
    diagnostic.phase === "claim_validation" ? "Grounded-claim validation" :
    "Answer post-validation";
  const explanation = diagnostic.kind === "provider_transient"
    ? "encountered a transient AI-service error"
    : diagnostic.kind === "provider_nonretryable"
      ? "encountered a non-retryable AI-service error"
      : diagnostic.kind === "validation_format"
        ? "received an invalid structured validation result"
        : "encountered an unclassified internal error";
  const status = diagnostic.httpStatus === null ? "" : ` (HTTP ${diagnostic.httpStatus})`;
  return `${phase} ${explanation}${status}; attempts: ${diagnostic.attempts}.`;
}

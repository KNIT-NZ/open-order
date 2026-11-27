export type AiTask =
  | "query.plan"
  | "answer.generate"
  | "answer.validate";

export type AiLane = "development" | "staging" | "production";

export type AiProviderId = "gemini" | "openai-compatible";

/**
 * `other` is not a success and not a capacity signal. It means the attempt
 * failed for a reason other than 429, 5xx, or timeout: a 400, a JSON or schema
 * parse failure, or a non-retryable status such as 401, 403, or 404.
 */
export type ProviderAttempt = {
  model: string;
  outcome: "ok" | "429" | "5xx" | "timeout" | "other";
};

export type AiGenerateJsonRequest = {
  task: AiTask;
  systemInstruction: string;
  prompt: string;
  temperature?: number;
  onProviderRetry?: () => void;
  onProviderAttempt?: (attempt: ProviderAttempt) => void;
  onProviderAttemptStart?: (model: string) => void;
  signal?: AbortSignal;
  validate?: (value: unknown) => void;
};

export type AiStreamTextRequest = {
  task: AiTask;
  systemInstruction: string;
  prompt: string;
  temperature?: number;
  onChunk?: (text: string) => void;
  onProviderRetry?: () => void;
  onProviderAttempt?: (attempt: ProviderAttempt) => void;
  onProviderAttemptStart?: (model: string) => void;
  signal?: AbortSignal;
};

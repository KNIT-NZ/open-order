export type AiTask =
  | "query.plan"
  | "answer.generate"
  | "answer.validate";

export type AiLane = "development" | "staging" | "production";

export type AiProviderId = "gemini" | "openai-compatible";

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

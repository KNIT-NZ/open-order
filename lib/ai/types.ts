export type AiTask =
  | "query.plan"
  | "answer.generate"
  | "answer.validate";

export type AiLane = "development" | "staging" | "production";

export type AiProviderId = "gemini" | "openai-compatible";

export type AiGenerateJsonRequest = {
  task: AiTask;
  systemInstruction: string;
  prompt: string;
  temperature?: number;
  onProviderRetry?: () => void;
};

export type AiStreamTextRequest = {
  task: AiTask;
  systemInstruction: string;
  prompt: string;
  temperature?: number;
  onChunk?: (text: string) => void;
  onProviderRetry?: () => void;
};

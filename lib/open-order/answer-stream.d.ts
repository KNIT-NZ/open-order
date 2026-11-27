export const ANSWER_FUNCTION_BUDGET_MS: number;
export const ANSWER_STREAM_DEADLINE_MS: number;
export const ANSWER_STREAM_HEARTBEAT_MS: number;
export function superviseAnswerStream(options: {
  deadlineMs: number;
  heartbeatMs: number;
  write: (chunk: string) => void;
  work: (send: (event: string, data?: unknown) => void) => Promise<void> | void;
}): Promise<{ event: "done" | "error"; data: { reason?: string }; heartbeats: number }>;

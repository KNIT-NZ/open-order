export const ANSWER_ROUTE_MAX_DURATION_SECONDS: number;
export const ANSWER_STREAM_SAFETY_MARGIN_MS: number;
export const ANSWER_STREAM_DEADLINE_MS: number;
export const ANSWER_STREAM_HEARTBEAT_MS: number;
export function openGovernedAnswerStream(options: {
  deadlineMs: number;
  heartbeatMs: number;
  bindSend: (rawSend: (event: string, data?: unknown) => void) => (event: string, data?: unknown) => void;
  work: (send: (event: string, data?: unknown) => void, signal: AbortSignal) => Promise<void> | void;
}): ReadableStream<Uint8Array>;

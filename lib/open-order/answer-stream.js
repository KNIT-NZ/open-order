/**
 * Answer SSE lifecycle shared by the route.
 *
 * Plan assumption: the platform honours the route segment maxDuration.
 * The deadline is that budget minus a safety margin so a terminal event is
 * written before the platform stops the function.
 */
export const ANSWER_ROUTE_MAX_DURATION_SECONDS = 300;
export const ANSWER_STREAM_SAFETY_MARGIN_MS = 30_000;
export const ANSWER_STREAM_DEADLINE_MS =
  ANSWER_ROUTE_MAX_DURATION_SECONDS * 1000 - ANSWER_STREAM_SAFETY_MARGIN_MS;
export const ANSWER_STREAM_HEARTBEAT_MS = 15_000;

function formatEvent(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * The readable stream the answer route returns. Terminal events go through
 * bindSend so the route can attach trace and operational metadata, then
 * controller.close() runs exactly once inside a guarded try.
 */
export function openGovernedAnswerStream(options) {
  const abort = new AbortController();
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let settled = false;
      const write = (chunk) => {
        try { controller.enqueue(encoder.encode(chunk)); } catch { /* closed */ }
      };
      const closeStream = () => {
        try { controller.close(); } catch { /* already closed */ }
      };
      const finish = (event, data) => {
        if (settled) return;
        settled = true;
        clearInterval(heartbeat);
        clearTimeout(deadline);
        abort.abort();
        write(formatEvent(event, data ?? {}));
        closeStream();
      };
      const rawSend = (event, data) => {
        if (settled) return;
        if (event === "done" || event === "error") finish(event, data);
        else write(formatEvent(event, data ?? {}));
      };
      const send = options.bindSend(rawSend);
      const heartbeat = setInterval(() => {
        if (!settled) write(": heartbeat\n\n");
      }, options.heartbeatMs);
      const deadline = setTimeout(() => {
        send("error", {
          reason: "deadline_exceeded",
          message: "The answer did not finish before the response deadline.",
          retryable: true,
          kind: "unavailable",
        });
      }, options.deadlineMs);
      try {
        await options.work(send, abort.signal);
        if (!settled) {
          send("error", {
            reason: "internal",
            message: "The answer request ended without a terminal event.",
            retryable: false,
            kind: "unknown",
          });
        }
      } catch {
        if (!settled) {
          send("error", {
            reason: "internal",
            message: "The answer request could not complete.",
            retryable: false,
            kind: "unknown",
          });
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });
  return stream;
}

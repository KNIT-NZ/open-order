/**
 * SSE supervision: heartbeats, a deadline under the function budget,
 * and exactly one terminal event even if the provider never returns.
 */

export const ANSWER_FUNCTION_BUDGET_MS = 300_000;
export const ANSWER_STREAM_DEADLINE_MS = 270_000;
export const ANSWER_STREAM_HEARTBEAT_MS = 15_000;

function formatEvent(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function superviseAnswerStream(options) {
  const deadlineMs = options.deadlineMs;
  const heartbeatMs = options.heartbeatMs;
  const write = options.write;
  let settled = false;
  let heartbeats = 0;
  let terminal = null;

  return new Promise((resolve) => {
    const finish = (event, data) => {
      if (settled) return;
      settled = true;
      clearInterval(heartbeat);
      clearTimeout(deadline);
      const payload = event === "error"
        ? { retryable: false, kind: "unknown", ...data, reason: data?.reason ?? "internal" }
        : data;
      terminal = { event, data: payload, heartbeats };
      try { write(formatEvent(event, payload)); } catch { /* caller closed */ }
      resolve(terminal);
    };
    const heartbeat = setInterval(() => {
      if (settled) return;
      heartbeats += 1;
      try { write(": heartbeat\n\n"); } catch { /* closed */ }
    }, heartbeatMs);
    const deadline = setTimeout(() => {
      finish("error", {
        reason: "deadline_exceeded",
        message: "The answer did not finish before the response deadline.",
        retryable: true,
        kind: "unavailable",
      });
    }, deadlineMs);
    const send = (event, data) => {
      if (settled) return;
      if (event === "done" || event === "error") {
        finish(event, data ?? {});
        return;
      }
      try { write(formatEvent(event, data ?? {})); } catch { /* closed */ }
    };
    Promise.resolve()
      .then(() => options.work(send))
      .then(() => { if (!settled) finish("error", { reason: "internal", message: "The answer request ended without a terminal event.", retryable: false, kind: "unknown" }); })
      .catch(() => { if (!settled) finish("error", { reason: "internal", message: "The answer request could not complete.", retryable: false, kind: "unknown" }); });
  });
}

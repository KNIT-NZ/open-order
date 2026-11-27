import { normaliseSearchFocus } from "@/lib/procedural-mechanisms";

// Content is processed in memory, never logged here.
export const SEARCH_BODY_MAX_BYTES = 16_384;
export const SEARCH_QUERY_MAX_CHARS = 4_096;

export async function readPrivateSearchParams(request: Request): Promise<URLSearchParams | null> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return null;
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > SEARCH_BODY_MAX_BYTES)) return null;
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > SEARCH_BODY_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const input: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
    const record = input as Record<string, unknown>;
    if (Object.keys(record).some((key) => !["q", "corpus", "limit", "offset", "focus"].includes(key))) return null;
    if (typeof record.q !== "string" || record.q.length > SEARCH_QUERY_MAX_CHARS) return null;
    const params = new URLSearchParams({ q: record.q });
    if (record.focus !== undefined) {
      const focus = normaliseSearchFocus(record.focus);
      if (focus) params.set("focus", focus);
    }
    for (const key of ["corpus", "limit", "offset"] as const) {
      const value = record[key];
      if (value === undefined) continue;
      if (typeof value === "string") params.set(key, value);
      else if (key !== "corpus" && typeof value === "number" && Number.isSafeInteger(value)) params.set(key, String(value));
      else return null;
    }
    return params;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

// Closed metadata-only boundary. No request bodies, user identifiers or diagnostics.
export const operationalRoutes = ["search", "ai_answer"] as const;
export const operationalOutcomes = ["completed", "invalid", "failed", "incomplete"] as const;
export const operationalStages = ["none", "planning", "retrieving", "selecting", "answering", "validating", "other"] as const;
export type OperationalOutcome = typeof operationalOutcomes[number];
export type OperationalStage = typeof operationalStages[number];
export type OperationalEvent = {
  schemaVersion: 1;
  requestId: string;
  route: typeof operationalRoutes[number];
  outcome: OperationalOutcome;
  elapsedMs: number;
  resultCount: number | null;
  stageCount: number;
  lastStage: OperationalStage;
  releaseSha: string | null;
};
const keys = ["schemaVersion", "requestId", "route", "outcome", "elapsedMs", "resultCount", "stageCount", "lastStage", "releaseSha"] as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const sha = /^[0-9a-f]{40}$/;
function member<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && values.some((candidate) => candidate === value);
}
function integer(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max;
}
export function parseOperationalEvent(input: unknown): OperationalEvent | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  const actualKeys = Reflect.ownKeys(value);
  if (actualKeys.length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) return null;
  if (value.schemaVersion !== 1 || typeof value.requestId !== "string" || !uuid.test(value.requestId) ||
      !member(operationalRoutes, value.route) || !member(operationalOutcomes, value.outcome) ||
      !integer(value.elapsedMs, 900_000) || !(value.resultCount === null || integer(value.resultCount, 100_000)) ||
      !integer(value.stageCount, 1000) || !member(operationalStages, value.lastStage) ||
      !(value.releaseSha === null || (typeof value.releaseSha === "string" && sha.test(value.releaseSha)))) return null;
  if (value.route === "search" && (value.stageCount !== 0 || value.lastStage !== "none")) return null;
  if (value.route === "ai_answer" && value.resultCount !== null) return null;
  return { schemaVersion: 1, requestId: value.requestId, route: value.route, outcome: value.outcome,
    elapsedMs: value.elapsedMs, resultCount: value.resultCount, stageCount: value.stageCount,
    lastStage: value.lastStage, releaseSha: value.releaseSha };
}
export function boundedElapsed(startedAt: number, now = Date.now()): number {
  return Math.max(0, Math.min(900_000, Math.round(now - startedAt)));
}
export function operationalStage(key: unknown): OperationalStage {
  return member(operationalStages, key) ? key : "other";
}
export function operationalRelease(value: unknown): string | null {
  return typeof value === "string" && sha.test(value) ? value : null;
}

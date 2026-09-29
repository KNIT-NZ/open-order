import { AiProviderError } from "./errors";
import type { AiLane, AiProviderId, AiTask } from "./types";

const ROUTES: Record<
  AiTask,
  Record<AiLane, readonly AiProviderId[]>
> = {
  "query.plan": {
    development: ["openai-compatible", "gemini"],
    staging: ["gemini", "openai-compatible"],
    production: ["gemini", "openai-compatible"],
  },
  "answer.generate": {
    development: ["openai-compatible", "gemini"],
    staging: ["gemini", "openai-compatible"],
    production: ["gemini", "openai-compatible"],
  },
  "answer.validate": {
    development: ["openai-compatible", "gemini"],
    staging: ["gemini", "openai-compatible"],
    production: ["gemini", "openai-compatible"],
  },
};

const VALID_LANES: readonly AiLane[] = [
  "development",
  "staging",
  "production",
];

const VALID_PROVIDERS: readonly AiProviderId[] = [
  "gemini",
  "openai-compatible",
];

function isAiLane(value: string): value is AiLane {
  return VALID_LANES.some((lane) => lane === value);
}

function isAiProviderId(value: string): value is AiProviderId {
  return VALID_PROVIDERS.some((provider) => provider === value);
}

export function getAiLane(): AiLane {
  const configured = process.env.AI_ENV?.trim();

  if (configured) {
    if (!isAiLane(configured)) {
      throw new AiProviderError({
        message: `Invalid AI_ENV "${configured}". Expected development, staging, or production.`,
        kind: "configuration",
        provider: "router",
      });
    }
    return configured;
  }

  return process.env.NODE_ENV === "production" ? "production" : "development";
}

export function getAiCandidates(task: AiTask): readonly AiProviderId[] {
  const override = process.env.AI_ROUTE_OVERRIDE?.trim();

  if (override) {
    if (!isAiProviderId(override)) {
      throw new AiProviderError({
        message:
          `Invalid AI_ROUTE_OVERRIDE "${override}". ` +
          "Expected gemini or openai-compatible.",
        kind: "configuration",
        provider: "router",
      });
    }
    return [override];
  }

  return ROUTES[task][getAiLane()];
}

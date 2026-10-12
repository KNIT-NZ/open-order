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
  // Explicit opt-in. Unset mode preserves the v5.19 production behaviour.
  // The tester mode may call ONLY the pinned Gemini model on an unbilled project.
  const inferenceMode = process.env.OPEN_ORDER_INFERENCE_MODE?.trim();
  if (inferenceMode) {
    if (inferenceMode !== "zero-billed-test") {
      throw new Error("Unknown inference mode; model dispatch denied.");
    }
    if (process.env.GEMINI_MODEL?.trim() !== "gemini-3.5-flash-lite") {
      throw new Error("Tester mode requires the approved Gemini Flash-Lite model.");
    }
    if (!process.env.GEMINI_API_KEY?.trim()) {
      throw new Error("Tester mode requires a configured non-billable Gemini key.");
    }
    const override = process.env.AI_ROUTE_OVERRIDE?.trim();
    if (override && override !== "gemini") {
      throw new Error("Tester mode forbids non-Gemini route override.");
    }
    // Do not permit any OpenAI-compatible credentials or endpoint/model config
    // in the isolated tester deployment, even if not normally selected.
    const disallowed = [
      process.env.AI_OPENAI_COMPATIBLE_BASE_URL,
      process.env.AI_OPENAI_COMPATIBLE_API_KEY,
      process.env.AI_OPENAI_COMPATIBLE_MODEL,
      process.env.AI_OPENAI_COMPATIBLE_QUERY_MODEL,
      process.env.AI_OPENAI_COMPATIBLE_ANSWER_MODEL,
    ];
    if (disallowed.some((value) => Boolean(value?.trim()))) {
      throw new Error("Tester mode forbids OpenAI-compatible provider configuration.");
    }
    return ["gemini"];
  }

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

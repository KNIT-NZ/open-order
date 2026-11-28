import { AiProviderError } from "./errors";
import type { AiLane, AiProviderId, AiTask } from "./types";

/** Non-Gemini providers stay off unless this flag is exactly "1". */
export function nonGeminiProvidersAllowed(): boolean {
  return process.env.OPEN_ORDER_ALLOW_NON_GEMINI?.trim() === "1";
}

const VALID_LANES: readonly AiLane[] = [
  "development",
  "staging",
  "production",
];

const VALID_PROVIDERS: readonly AiProviderId[] = [
  "gemini",
  "openai-compatible",
  "cloudflare",
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
  void task;
  // The tester mode may call ONLY the pinned Gemini model on an unbilled project.
  // Every other lane is free-tier Gemini unless a non-Gemini fallback is opted in.
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
    const present = [
      ["AI_OPENAI_COMPATIBLE_BASE_URL", process.env.AI_OPENAI_COMPATIBLE_BASE_URL],
      ["AI_OPENAI_COMPATIBLE_API_KEY", process.env.AI_OPENAI_COMPATIBLE_API_KEY],
      ["AI_OPENAI_COMPATIBLE_MODEL", process.env.AI_OPENAI_COMPATIBLE_MODEL],
      ["AI_OPENAI_COMPATIBLE_QUERY_MODEL", process.env.AI_OPENAI_COMPATIBLE_QUERY_MODEL],
      ["AI_OPENAI_COMPATIBLE_ANSWER_MODEL", process.env.AI_OPENAI_COMPATIBLE_ANSWER_MODEL],
      ["CLOUDFLARE_API_TOKEN", process.env.CLOUDFLARE_API_TOKEN],
      ["CLOUDFLARE_ACCOUNT_ID", process.env.CLOUDFLARE_ACCOUNT_ID],
    ].filter((entry) => Boolean(entry[1]?.trim())).map((entry) => entry[0]);
    if (present.length > 0) {
      throw new Error(`Tester mode forbids non-Gemini provider configuration: ${present.join(", ")}.`);
    }
    return ["gemini"];
  }

  const override = process.env.AI_ROUTE_OVERRIDE?.trim();

  if (override) {
    if (!isAiProviderId(override)) {
      throw new AiProviderError({
        message:
          `Invalid AI_ROUTE_OVERRIDE "${override}". ` +
          "Expected gemini, openai-compatible, or cloudflare.",
        kind: "configuration",
        provider: "router",
      });
    }
    if (override !== "gemini" && !nonGeminiProvidersAllowed()) {
      throw new AiProviderError({
        message: "Non-Gemini providers are disabled unless OPEN_ORDER_ALLOW_NON_GEMINI=1.",
        kind: "configuration",
        provider: "router",
      });
    }
    return [override];
  }

  // Cloudflare uses the same opt-in as every other non-Gemini fallback.
  // Credentials alone do not put it on the chain.
  const cloudflareConfigured = nonGeminiProvidersAllowed() && Boolean(
    process.env.CLOUDFLARE_API_TOKEN?.trim()
    && /^[a-f0-9]{32}$/i.test(process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? ""),
  );
  if (nonGeminiProvidersAllowed()) {
    return cloudflareConfigured ? ["gemini", "cloudflare", "openai-compatible"] : ["gemini", "openai-compatible"];
  }
  return ["gemini"];
}

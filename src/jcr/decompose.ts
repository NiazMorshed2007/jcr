import OpenAI from "openai";
import type { JcrDecomposerMetrics } from "./types.js";

export type Decomposition = {
  steps: string[];
  metrics: JcrDecomposerMetrics;
};

export const decomposerServiceTier = "fast" as const;

const instructions =
  "Break the request into the smallest ordered integration actions needed to satisfy it. Each step must describe exactly one action on exactly one external product or API. Preserve dependencies and concrete user values. Do not add implementation, authentication, discovery, or verification steps unless the user requested them.";

const normalizeSteps = (value: unknown): string[] => {
  if (
    typeof value !== "object" ||
    value === null ||
    !("steps" in value) ||
    !Array.isArray(value.steps)
  ) {
    throw new Error("Decomposer returned an invalid steps object");
  }
  const steps = value.steps
    .filter((step): step is string => typeof step === "string")
    .map((step) => step.trim())
    .filter(Boolean);
  if (steps.length === 0) {
    throw new Error("Decomposer returned no steps");
  }
  return steps;
};

export const decomposeRequest = async (
  request: string,
): Promise<Decomposition> => {
  const model = process.env.JCR_OPENAI_MODEL ?? "gpt-5.6-luna";
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY ?? process.env.CODEX_API_KEY,
  });
  const response = await client.chat.completions.create({
    model,
    service_tier: decomposerServiceTier,
    messages: [
      { role: "system", content: instructions },
      { role: "user", content: request },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "capability_steps",
        strict: true,
        schema: {
          type: "object",
          properties: {
            steps: {
              type: "array",
              items: { type: "string" },
              minItems: 2,
            },
          },
          required: ["steps"],
          additionalProperties: false,
        },
      },
    },
  });
  const content = response.choices[0]?.message.content;
  if (!content) {
    throw new Error("OpenAI decomposer returned no structured steps");
  }
  return {
    steps: normalizeSteps(JSON.parse(content) as unknown),
    metrics: {
      model,
      calls: 1,
      inputTokens: response.usage?.prompt_tokens ?? 0,
      cachedInputTokens:
        response.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    },
  };
};

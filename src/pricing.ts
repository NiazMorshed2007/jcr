import type { TokenUsage } from "./harnesses/types.js";
import { decomposerServiceTier } from "./jcr/decompose.js";
import type { JcrDecomposerMetrics } from "./jcr/types.js";

export type CostBasis = "sdk" | "list-price";

export type ServiceTier = "standard" | "fast";

export type ModelListPrice = {
  input: number;
  cachedInput: number;
  cacheWrite: number;
  output: number;
};

const million = 1_000_000;

export const pricingCheckedOn = "2026-09-20";

export const openAiListPrices: Readonly<Record<string, ModelListPrice>> = {
  "gpt-6-astra": { input: 10, cachedInput: 1, cacheWrite: 12.5, output: 50 },
  "gpt-5.6-sol": { input: 4, cachedInput: 0.4, cacheWrite: 5, output: 20 },
  "gpt-5.6-terra": { input: 2, cachedInput: 0.2, cacheWrite: 2.5, output: 12 },
  "gpt-5.6-luna": {
    input: 0.2,
    cachedInput: 0.02,
    cacheWrite: 0.25,
    output: 1.2,
  },
};

export const serviceTierMultiplier: Readonly<Record<ServiceTier, number>> = {
  standard: 1,
  fast: 2,
};

export const jevInputPricePerMillion = 0.042;

export const openAiListPrice = (model: string): ModelListPrice | undefined => {
  const match = Object.keys(openAiListPrices)
    .filter((prefix) => model === prefix || model.startsWith(`${prefix}-`))
    .sort((left, right) => right.length - left.length)[0];
  return match === undefined ? undefined : openAiListPrices[match];
};

export type BillableTokens = Pick<
  TokenUsage,
  "inputTokens" | "cachedInputTokens" | "cacheWriteInputTokens" | "outputTokens"
>;

export const estimateOpenAiCostUsd = (
  model: string,
  tokens: BillableTokens,
  tier: ServiceTier = "standard",
): number | undefined => {
  const price = openAiListPrice(model);
  if (!price) return undefined;
  const listCost =
    tokens.inputTokens * price.input +
    tokens.cachedInputTokens * price.cachedInput +
    tokens.cacheWriteInputTokens * price.cacheWrite +
    tokens.outputTokens * price.output;
  return (listCost * serviceTierMultiplier[tier]) / million;
};

export const estimateJevCostUsd = (inputTokens: number): number =>
  (inputTokens * jevInputPricePerMillion) / million;

export const estimateDecomposerCostUsd = (
  decomposer: JcrDecomposerMetrics,
): number | undefined =>
  estimateOpenAiCostUsd(
    decomposer.model,
    {
      inputTokens: Math.max(
        0,
        decomposer.inputTokens - decomposer.cachedInputTokens,
      ),
      cachedInputTokens: decomposer.cachedInputTokens,
      cacheWriteInputTokens: 0,
      outputTokens: decomposer.outputTokens,
    },
    decomposerServiceTier,
  );

export const describeListPrice = (model: string): string | undefined => {
  const price = openAiListPrice(model);
  if (!price) return undefined;
  const usd = (value: number): string => `$${value.toFixed(2)}`;
  return `${model}: ${usd(price.input)} in · ${usd(price.cachedInput)} cached · ${usd(price.cacheWrite)} cache write · ${usd(price.output)} out per 1M tokens`;
};

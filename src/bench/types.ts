import type { Provider } from "../harnesses/types.js";
import type { CapabilityMode } from "../jcr/types.js";
import type { CostBasis } from "../pricing.js";

export type BenchScenario = {
  id: string;
  title: string;
  prompt: string;
  category: string;
  integrations: string[];
  compound: boolean;
};

export type BenchVariant = {
  id: string;
  provider: Provider;
  mode: CapabilityMode;
  model: string;
};

export type BenchJcrMeasurements = {
  resolverCalls: number;
  jevCalls: number;
  jevInputTokens: number;
  jevOutputTokens: number;
  jevCostUsd: number;
  decomposerModel?: string;
  decomposerCalls: number;
  decomposerInputTokens: number;
  decomposerOutputTokens: number;
  decomposerCostUsd?: number;
};

export type BenchMeasurements = {
  durationMs: number;
  contextProcessed?: number;
  inputTokens?: number;
  cachedInputTokens?: number;
  cacheWriteInputTokens?: number;
  outputTokens?: number;
  toolCallCount: number;
  skillReadCount: number;
  agentCostUsd?: number;
  agentCostBasis?: CostBasis;
  jcr?: BenchJcrMeasurements;
  totalCostUsd?: number;
};

export type BenchRun = {
  batchId: string;
  key: string;
  scenarioId: string;
  provider: Provider;
  mode: CapabilityMode;
  model: string;
  resolvedModel?: string;
  variantId: string;
  startedAt: string;
  finishedAt: string;
  status: "ok" | "error" | "timeout";
  error?: string;
  measurements: BenchMeasurements;
};

export type BenchProgress = {
  batchId: string;
  startedAt: string;
  finishedAt?: string;
  total: number;
  done: number;
  failed: number;
  running: string[];
  variants: BenchVariant[];
  scenarioIds: string[];
};

export type BenchTotals = {
  durationMs: number;
  context: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  toolCalls: number;
  skillReads: number;
  resolverCalls: number;
  jevCalls: number;
  jevInputTokens: number;
  jevOutputTokens: number;
  decomposerCalls: number;
  decomposerInputTokens: number;
  decomposerOutputTokens: number;
  agentCostUsd: number;
  jevCostUsd: number;
  decomposerCostUsd: number;
  totalCostUsd: number;
};

export type VariantAggregate = {
  variant: BenchVariant;
  runs: number;
  costedRuns: number;
  totals: BenchTotals;
  perRun: BenchTotals;
};

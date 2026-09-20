import type {
  CapabilityMode,
  CapabilityTreeSummary,
  JcrMetrics,
} from "../jcr/types.js";
import type { CostBasis } from "../pricing.js";

export type Provider = "claude" | "codex";

// inputTokens excludes cached reads and cache writes on both providers so
// contextTokens = inputTokens + cachedInputTokens + cacheWriteInputTokens.
export type TokenUsage = {
  contextTokens: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  reasoningOutputTokens?: number;
};

export type AgentMetrics = {
  durationMs: number;
  toolCalls: string[];
  turns: number;
  modelCalls?: number;
  estimatedCostUsd?: number;
  costBasis?: CostBasis;
  usage?: TokenUsage;
  jcr?: JcrMetrics;
};

type CapabilityContext = {
  mode: CapabilityMode;
  agentTools: string[];
  tree?: CapabilityTreeSummary;
};

export type AgentContextUsage =
  | (CapabilityContext & {
      status: "available";
      source: string;
      model: string;
      totalTokens: number;
      contextWindowTokens: number;
      totalPercentage: number;
      skillTokens: number;
      skillPercentage: number;
      totalSkills: number;
      includedSkills: number;
      skills: {
        name: string;
        tokens: number;
      }[];
    })
  | (CapabilityContext & {
      status: "unavailable";
      reason: string;
    });

export type AgentEvent =
  | {
      provider: Provider;
      type: "status" | "text" | "tool";
      message: string;
    }
  | {
      provider: Provider;
      type: "metrics";
      metrics: AgentMetrics;
    }
  | {
      provider: Provider;
      type: "context";
      context: AgentContextUsage;
    };

export type AgentRunOptions = {
  prompt: string;
  workingDirectory: string;
  mode: CapabilityMode;
  model?: string;
  abortController?: AbortController;
  onEvent: (event: AgentEvent) => void;
};

export type AgentRunResult = {
  provider: Provider;
  mode: CapabilityMode;
  finalResponse: string;
  sessionId?: string;
  model?: string;
  metrics: AgentMetrics;
};

export interface AgentHarness {
  readonly provider: Provider;
  run(options: AgentRunOptions): Promise<AgentRunResult>;
}

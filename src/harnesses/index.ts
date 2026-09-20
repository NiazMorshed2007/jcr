import { ClaudeHarness } from "./claude.js";
import { CodexHarness } from "./codex.js";
import type { AgentHarness, Provider } from "./types.js";

export type {
  AgentContextUsage,
  AgentEvent,
  AgentMetrics,
  AgentRunResult,
  Provider,
  TokenUsage,
} from "./types.js";
export type { CapabilityMode, JcrMetrics } from "../jcr/types.js";

export const createHarness = (provider: Provider): AgentHarness => {
  if (provider === "claude") {
    return new ClaudeHarness();
  }

  return new CodexHarness();
};

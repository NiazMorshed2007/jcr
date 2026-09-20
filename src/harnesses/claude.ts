import { performance } from "node:perf_hooks";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { errorMessage } from "../errors.js";
import { readJcrMetrics } from "../jcr/metrics.js";
import { createJcrSdkServer } from "../jcr/tool.js";
import { summarizeTree } from "../jcr/tree.js";
import type { JcrMetrics } from "../jcr/types.js";
import type {
  AgentHarness,
  AgentMetrics,
  AgentRunOptions,
  AgentRunResult,
  TokenUsage,
} from "./types.js";

const operationalTools = [
  "Bash",
  "Edit",
  "Write",
  "WebFetch",
  "WebSearch",
  "NotebookEdit",
  "Task",
];
const skillTools = ["Read", "Glob", "Grep", "Skill"];
const resolverTools = ["mcp__jcr__resolve_capabilities"];

const resolverInstructions =
  "For any request that needs an external capability, call resolve_capabilities with the complete request. Use only the returned item contexts. When a step has close matches, pick using the request. When it is ambiguous or unresolved, call again with a sharper step or ask the user. Do not infer undocumented steps or claim that anything was executed.";

export class ClaudeHarness implements AgentHarness {
  readonly provider = "claude" as const;

  async run(options: AgentRunOptions): Promise<AgentRunResult> {
    if (options.mode === "skills") {
      return this.runSession(options);
    }
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "jcr-claude-"));
    try {
      return await this.runSession(
        options,
        join(temporaryDirectory, "metrics.ndjson"),
      );
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }

  private async runSession(
    options: AgentRunOptions,
    metricsFile?: string,
  ): Promise<AgentRunResult> {
    const startedAt = performance.now();
    let finalResponse = "";
    let sessionId: string | undefined;
    let model: string | undefined;
    let usage: TokenUsage | undefined;
    let turns = 0;
    let estimatedCostUsd: number | undefined;
    let jcrMetrics: JcrMetrics | undefined;
    const toolCalls: string[] = [];
    const seenMessageIds = new Set<string>();
    const currentMetrics = (): AgentMetrics => ({
      durationMs: performance.now() - startedAt,
      toolCalls: [...toolCalls],
      turns,
      modelCalls: turns,
      ...(estimatedCostUsd !== undefined
        ? { estimatedCostUsd, costBasis: "sdk" as const }
        : {}),
      ...(usage ? { usage } : {}),
      ...(jcrMetrics ? { jcr: jcrMetrics } : {}),
    });
    const emitMetrics = (): void => {
      options.onEvent({
        provider: this.provider,
        type: "metrics",
        metrics: currentMetrics(),
      });
    };

    options.onEvent({
      provider: this.provider,
      type: "status",
      message: "starting",
    });

    const jcrMode = options.mode === "jcr";
    const capabilitiesDirectory = join(
      options.workingDirectory,
      "capabilities",
    );
    const tree = jcrMode
      ? await summarizeTree(capabilitiesDirectory)
      : undefined;
    const agentTools = jcrMode ? resolverTools : skillTools;
    const baseContext = {
      mode: options.mode,
      agentTools,
      ...(tree ? { tree } : {}),
    };
    const agentQuery = query({
      prompt: options.prompt,
      options: {
        cwd: options.workingDirectory,
        tools: jcrMode ? [] : agentTools,
        allowedTools: agentTools,
        disallowedTools: jcrMode
          ? [...operationalTools, ...skillTools]
          : operationalTools,
        mcpServers: jcrMode
          ? {
              jcr: createJcrSdkServer({
                capabilitiesDirectory,
                ...(metricsFile ? { metricsFile } : {}),
              }),
            }
          : {},
        strictMcpConfig: true,
        permissionMode: "dontAsk",
        settingSources: jcrMode ? [] : ["project"],
        skills: jcrMode ? [] : "all",
        ...(jcrMode
          ? {
              systemPrompt: {
                type: "preset" as const,
                preset: "claude_code" as const,
                append: resolverInstructions,
              },
            }
          : {}),
        maxTurns: 100,
        ...(options.abortController
          ? { abortController: options.abortController }
          : {}),
        ...(options.model ? { model: options.model } : {}),
      },
    });

    try {
      const contextUsage = await agentQuery.getContextUsage({ detail: "full" });
      const skills = contextUsage.skills;
      options.onEvent({
        provider: this.provider,
        type: "context",
        context: {
          ...baseContext,
          status: "available",
          source: "Claude Agent SDK getContextUsage(full)",
          model: contextUsage.model,
          totalTokens: contextUsage.totalTokens,
          contextWindowTokens: contextUsage.maxTokens,
          totalPercentage: contextUsage.percentage,
          skillTokens: skills?.tokens ?? 0,
          skillPercentage:
            contextUsage.maxTokens > 0
              ? ((skills?.tokens ?? 0) / contextUsage.maxTokens) * 100
              : 0,
          totalSkills: skills?.totalSkills ?? 0,
          includedSkills: skills?.includedSkills ?? 0,
          skills:
            skills?.skillFrontmatter.map((skill) => ({
              name: skill.name,
              tokens: skill.tokens,
            })) ?? [],
        },
      });
    } catch (error) {
      options.onEvent({
        provider: this.provider,
        type: "context",
        context: {
          ...baseContext,
          status: "unavailable",
          reason: `Claude SDK context report failed: ${errorMessage(error)}`,
        },
      });
    }

    for await (const message of agentQuery) {
      if (message.type === "system" && message.subtype === "init") {
        sessionId = message.session_id;
        model = message.model;
      }

      if (message.type === "assistant") {
        if (!seenMessageIds.has(message.message.id)) {
          seenMessageIds.add(message.message.id);
          turns = seenMessageIds.size;
          const step = message.message.usage;
          const inputTokens = step.input_tokens ?? 0;
          const outputTokens = step.output_tokens ?? 0;
          const cachedInputTokens = step.cache_read_input_tokens ?? 0;
          const cacheWriteInputTokens = step.cache_creation_input_tokens ?? 0;
          usage = {
            contextTokens:
              (usage?.contextTokens ?? 0) +
              inputTokens +
              cachedInputTokens +
              cacheWriteInputTokens,
            inputTokens: (usage?.inputTokens ?? 0) + inputTokens,
            outputTokens: (usage?.outputTokens ?? 0) + outputTokens,
            cachedInputTokens:
              (usage?.cachedInputTokens ?? 0) + cachedInputTokens,
            cacheWriteInputTokens:
              (usage?.cacheWriteInputTokens ?? 0) + cacheWriteInputTokens,
          };
          emitMetrics();
        }

        for (const block of message.message.content) {
          if (block.type === "text") {
            options.onEvent({
              provider: this.provider,
              type: "text",
              message: block.text,
            });
          }

          if (block.type === "tool_use") {
            toolCalls.push(block.name);
            emitMetrics();
            options.onEvent({
              provider: this.provider,
              type: "tool",
              message: block.name,
            });
          }
        }
      }

      if (message.type === "result") {
        if (message.subtype !== "success" || message.is_error) {
          throw new Error(`Claude stopped with ${message.subtype}`);
        }

        finalResponse = message.result;
        sessionId = message.session_id;
        turns = message.num_turns;
        estimatedCostUsd = message.total_cost_usd;
        usage = {
          contextTokens:
            message.usage.input_tokens +
            message.usage.cache_read_input_tokens +
            message.usage.cache_creation_input_tokens,
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
          cachedInputTokens: message.usage.cache_read_input_tokens,
          cacheWriteInputTokens: message.usage.cache_creation_input_tokens,
        };
        emitMetrics();
      }
    }

    if (metricsFile) {
      jcrMetrics = await readJcrMetrics(metricsFile);
      emitMetrics();
    }

    return {
      provider: this.provider,
      mode: options.mode,
      finalResponse,
      ...(sessionId ? { sessionId } : {}),
      ...(model ? { model } : {}),
      metrics: currentMetrics(),
    };
  }
}

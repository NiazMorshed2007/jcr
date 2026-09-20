import { performance } from "node:perf_hooks";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Codex } from "@openai/codex-sdk";
import { readJcrMetrics } from "../jcr/metrics.js";
import { summarizeTree } from "../jcr/tree.js";
import type { JcrMetrics } from "../jcr/types.js";
import { estimateOpenAiCostUsd } from "../pricing.js";
import type {
  AgentHarness,
  AgentMetrics,
  AgentRunOptions,
  AgentRunResult,
  TokenUsage,
} from "./types.js";

const createIsolatedEnvironment = (
  codexHome: string,
  extraNames: string[] = [],
): Record<string, string> => {
  const environment: Record<string, string> = {
    CODEX_HOME: codexHome,
    HOME: codexHome,
    TMPDIR: tmpdir(),
  };
  for (const name of [
    "PATH",
    "SHELL",
    "LANG",
    "LC_ALL",
    "TERM",
    ...extraNames,
  ]) {
    const value = process.env[name];
    if (value) {
      environment[name] = value;
    }
  }
  return environment;
};

export class CodexHarness implements AgentHarness {
  readonly provider = "codex" as const;

  async run(options: AgentRunOptions): Promise<AgentRunResult> {
    const codexHome = await mkdtemp(join(tmpdir(), "jcr-codex-"));
    try {
      return await this.runIsolated(options, codexHome);
    } finally {
      await rm(codexHome, { recursive: true, force: true });
    }
  }

  private async runIsolated(
    options: AgentRunOptions,
    codexHome: string,
  ): Promise<AgentRunResult> {
    const startedAt = performance.now();
    const apiKey = process.env.OPENAI_API_KEY ?? process.env.CODEX_API_KEY;
    const jcrMode = options.mode === "jcr";
    const capabilitiesDirectory = join(
      options.workingDirectory,
      "capabilities",
    );
    const metricsFile = join(codexHome, "jcr-metrics.ndjson");
    const tree = jcrMode
      ? await summarizeTree(capabilitiesDirectory)
      : undefined;
    const agentTools = jcrMode
      ? ["jcr.resolve_capabilities"]
      : ["skill_loader.load_skill"];
    const jcrEnvironmentNames = [
      "TYPESAFE_API_KEY",
      "TYPESAFE_MODEL",
      "TYPESAFE_BASE_URL",
      "OPENAI_API_KEY",
      "CODEX_API_KEY",
      "CODEX_MODEL",
      "JCR_OPENAI_MODEL",
      "JCR_BEAM_WIDTH",
      "JCR_BAND_RATIO",
    ];
    const codex = new Codex({
      ...(apiKey ? { apiKey } : {}),
      env: createIsolatedEnvironment(
        codexHome,
        jcrMode ? jcrEnvironmentNames : [],
      ),
      config: {
        developer_instructions: jcrMode
          ? "For any request that needs an external capability, call jcr.resolve_capabilities with the complete request. Use only the returned item contexts. When a step has close matches, pick using the request. When it is ambiguous or unresolved, call again with a sharper step or ask the user. Do not infer undocumented steps or claim that anything was executed."
          : "When a task matches an installed skill, load its full instructions with skill_loader.load_skill before responding. You have no operational tools. Use loaded instructions to explain any execution steps that the harness blocks.",
        features: {
          apps: false,
          shell_tool: false,
          unified_exec: false,
        },
        mcp_servers: jcrMode
          ? {
              jcr: {
                command: process.execPath,
                args: [
                  "--import",
                  "tsx",
                  join(options.workingDirectory, "src", "jcr", "server.ts"),
                ],
                cwd: options.workingDirectory,
                env: {
                  CAPABILITIES_DIRECTORY: capabilitiesDirectory,
                  JCR_METRICS_FILE: metricsFile,
                },
                env_vars: jcrEnvironmentNames,
                enabled_tools: ["resolve_capabilities"],
                default_tools_approval_mode: "approve",
              },
            }
          : {
              skill_loader: {
                command: process.execPath,
                args: [
                  "--import",
                  "tsx",
                  join(
                    options.workingDirectory,
                    "src",
                    "mcp",
                    "skill-loader.ts",
                  ),
                ],
                cwd: options.workingDirectory,
                env: {
                  SKILLS_DIRECTORY: join(
                    options.workingDirectory,
                    ".agents",
                    "skills",
                  ),
                },
                enabled_tools: ["load_skill"],
                default_tools_approval_mode: "approve",
              },
            },
        tools: {
          web_search: false,
        },
        web_search: "disabled",
      },
      configOverrides: ["plugins={}"],
    });
    const thread = codex.startThread({
      workingDirectory: jcrMode ? codexHome : options.workingDirectory,
      skipGitRepoCheck: true,
      sandboxMode: "read-only",
      approvalPolicy: "never",
      networkAccessEnabled: false,
      webSearchMode: "disabled",
      webSearchEnabled: false,
      ...(options.model ? { model: options.model } : {}),
    });
    const responses: string[] = [];
    let sessionId: string | undefined;
    let usage: TokenUsage | undefined;
    let estimatedCostUsd: number | undefined;
    let jcrMetrics: JcrMetrics | undefined;
    let turns = 0;
    const toolCalls: string[] = [];
    const currentMetrics = (): AgentMetrics => ({
      durationMs: performance.now() - startedAt,
      toolCalls: [...toolCalls],
      turns,
      ...(estimatedCostUsd !== undefined
        ? { estimatedCostUsd, costBasis: "list-price" as const }
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
      type: "context",
      context: {
        status: "unavailable",
        mode: options.mode,
        agentTools,
        ...(tree ? { tree } : {}),
        reason: jcrMode
          ? "Codex SDK has no initial-context token category report; skills are isolated by an empty temporary working directory."
          : "Codex SDK has aggregate turn usage, not skill-category tokens.",
      },
    });

    options.onEvent({
      provider: this.provider,
      type: "status",
      message: "starting",
    });

    const { events } = await thread.runStreamed(options.prompt, {
      ...(options.abortController
        ? { signal: options.abortController.signal }
        : {}),
    });

    for await (const event of events) {
      if (event.type === "thread.started") {
        sessionId = event.thread_id;
      }

      if (event.type === "turn.started") {
        turns += 1;
        emitMetrics();
      }

      if (event.type === "item.started") {
        if (event.item.type === "command_execution") {
          toolCalls.push(event.item.command);
          emitMetrics();
          options.onEvent({
            provider: this.provider,
            type: "tool",
            message: event.item.command,
          });
        }

        if (event.item.type === "mcp_tool_call") {
          toolCalls.push(`${event.item.server}.${event.item.tool}`);
          emitMetrics();
          options.onEvent({
            provider: this.provider,
            type: "tool",
            message: `${event.item.server}.${event.item.tool}`,
          });
        }

        if (event.item.type === "web_search") {
          toolCalls.push(`web_search: ${event.item.query}`);
          emitMetrics();
          options.onEvent({
            provider: this.provider,
            type: "tool",
            message: `web_search: ${event.item.query}`,
          });
        }
      }

      if (
        event.type === "item.completed" &&
        event.item.type === "agent_message"
      ) {
        responses.push(event.item.text);
        options.onEvent({
          provider: this.provider,
          type: "text",
          message: event.item.text,
        });
      }

      if (event.type === "turn.completed") {
        const cachedInputTokens = event.usage.cached_input_tokens;
        const cacheWriteInputTokens = event.usage.cache_write_input_tokens;
        usage = {
          contextTokens: event.usage.input_tokens,
          inputTokens: Math.max(
            0,
            event.usage.input_tokens -
              cachedInputTokens -
              cacheWriteInputTokens,
          ),
          outputTokens: event.usage.output_tokens,
          cachedInputTokens,
          cacheWriteInputTokens,
          reasoningOutputTokens: event.usage.reasoning_output_tokens,
        };
        estimatedCostUsd = options.model
          ? estimateOpenAiCostUsd(options.model, usage)
          : undefined;
        emitMetrics();
      }

      if (event.type === "turn.failed") {
        throw new Error(event.error.message);
      }

      if (event.type === "error") {
        throw new Error(event.message);
      }
    }

    if (jcrMode) {
      jcrMetrics = await readJcrMetrics(metricsFile);
      emitMetrics();
    }

    return {
      provider: this.provider,
      mode: options.mode,
      finalResponse: responses.at(-1) ?? "",
      ...(sessionId ? { sessionId } : {}),
      ...(options.model ? { model: options.model } : {}),
      metrics: currentMetrics(),
    };
  }
}

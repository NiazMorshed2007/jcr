import type { AgentRunResult } from "../harnesses/index.js";
import { estimateDecomposerCostUsd, estimateJevCostUsd } from "../pricing.js";
import {
  boxBorder,
  boxRow,
  boxRows,
  formatUsd,
  modeAccent,
  preferredInnerWidth,
  type Styler,
  type Tone,
} from "./terminal.js";
import { countSkillCalls, isResolverCall, isSkillCall } from "./tool-kind.js";

const number = new Intl.NumberFormat("en-US");

const toolTone = (tool: string): Tone => {
  if (isResolverCall(tool)) return "highlight";
  if (isSkillCall(tool)) return "info";
  return "warning";
};

const toolRows = (
  toolCalls: string[],
  innerWidth: number,
  accent: Styler,
): string[] => {
  if (toolCalls.length === 0) {
    return [boxRow(innerWidth, "Tools used", "none", accent, "muted", 22)];
  }

  const counts = new Map<string, number>();
  for (const tool of toolCalls) {
    const name = tool.replaceAll(/\s+/g, " ").trim() || "unknown";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  return [...counts.entries()].flatMap(([tool, count], index) =>
    boxRows(
      innerWidth,
      index === 0 ? "Tools used" : "",
      `${count}× ${tool}`,
      accent,
      toolTone(tool),
      22,
    ),
  );
};

export const renderRunSummary = (result: AgentRunResult): string => {
  const innerWidth = preferredInnerWidth(76, 64);
  const accent = modeAccent(result.mode);
  const { metrics } = result;
  const usage = metrics.usage;
  const jevCostUsd = metrics.jcr
    ? estimateJevCostUsd(metrics.jcr.jevInputTokens)
    : undefined;
  const decomposerCostUsd = metrics.jcr?.decomposer
    ? estimateDecomposerCostUsd(metrics.jcr.decomposer)
    : 0;
  const totalCostUsd =
    metrics.estimatedCostUsd === undefined ||
    (metrics.jcr !== undefined && decomposerCostUsd === undefined)
      ? undefined
      : metrics.estimatedCostUsd + (jevCostUsd ?? 0) + (decomposerCostUsd ?? 0);
  const row = (label: string, value: string, tone: Tone = "default"): string =>
    boxRow(innerWidth, label, value, accent, tone, 22);
  const border = (left: string, right: string, title?: string): string =>
    boxBorder(innerWidth, left, right, title, accent);
  return [
    border(
      "╭",
      "╮",
      `${result.provider.toUpperCase()} · ${result.mode.toUpperCase()} SUMMARY`,
    ),
    row("Model", result.model ?? "SDK default", "info"),
    row("Duration", `${(metrics.durationMs / 1000).toFixed(1)}s`, "info"),
    row("Agent turns", number.format(metrics.turns), "info"),
    row(
      "Model calls",
      metrics.modelCalls === undefined
        ? "unavailable from SDK"
        : number.format(metrics.modelCalls),
      metrics.modelCalls === undefined ? "muted" : "info",
    ),
    row(
      "Tool calls",
      number.format(metrics.toolCalls.length),
      metrics.toolCalls.length > 0 ? "warning" : "muted",
    ),
    row(
      "Skill calls",
      result.mode === "skills"
        ? number.format(countSkillCalls(metrics.toolCalls))
        : "—",
      result.mode === "skills" ? "info" : "muted",
    ),
    border("├", "┤", "TOKENS"),
    row(
      "Context processed",
      usage ? number.format(usage.contextTokens) : "unavailable",
      usage ? "info" : "muted",
    ),
    row(
      "Input",
      usage ? number.format(usage.inputTokens) : "unavailable",
      usage ? "info" : "muted",
    ),
    row(
      "Output",
      usage ? number.format(usage.outputTokens) : "unavailable",
      usage ? "success" : "muted",
    ),
    row(
      "Cache read",
      usage ? number.format(usage.cachedInputTokens) : "unavailable",
      usage ? "info" : "muted",
    ),
    row(
      "Cache write",
      usage ? number.format(usage.cacheWriteInputTokens) : "unavailable",
      usage ? "info" : "muted",
    ),
    row(
      "Agent model cost",
      metrics.estimatedCostUsd === undefined
        ? "unavailable"
        : `${formatUsd(metrics.estimatedCostUsd)} (${metrics.costBasis === "list-price" ? "list price" : "SDK"})`,
      metrics.estimatedCostUsd === undefined ? "muted" : "success",
    ),
    ...(metrics.jcr
      ? [
          border("├", "┤", "JCR"),
          row(
            "Resolver calls",
            number.format(metrics.jcr.resolverCalls),
            "highlight",
          ),
          row(
            "Jev requests",
            number.format(metrics.jcr.jevRequests),
            "highlight",
          ),
          row("Jev input", number.format(metrics.jcr.jevInputTokens), "info"),
          row("Jev output", number.format(metrics.jcr.jevOutputTokens), "info"),
          row("Jev cost", formatUsd(jevCostUsd ?? 0), "success"),
          row("Beam rounds", number.format(metrics.jcr.beamRounds), "info"),
          row(
            "Matches returned",
            number.format(metrics.jcr.matchesReturned),
            "info",
          ),
          row(
            "Agent context",
            `${number.format(metrics.jcr.agentOutputChars)} characters`,
            "success",
          ),
          row(
            "Resolution time",
            `${(metrics.jcr.durationMs / 1000).toFixed(1)}s`,
            "info",
          ),
          row(
            "Steps resolved",
            number.format(metrics.jcr.stepsResolved),
            "success",
          ),
          row(
            "Steps unresolved",
            number.format(metrics.jcr.stepsUnresolved),
            metrics.jcr.stepsUnresolved > 0 ? "danger" : "success",
          ),
          ...(metrics.jcr.decomposer
            ? [
                row("Decomposer", metrics.jcr.decomposer.model, "highlight"),
                row(
                  "Decomposer tokens",
                  `${number.format(metrics.jcr.decomposer.inputTokens)} in · ${number.format(metrics.jcr.decomposer.outputTokens)} out`,
                  "info",
                ),
                row(
                  "Decomposer cost",
                  decomposerCostUsd === undefined
                    ? "no list price on file"
                    : formatUsd(decomposerCostUsd),
                  decomposerCostUsd === undefined ? "muted" : "success",
                ),
              ]
            : []),
          row(
            "Total cost",
            totalCostUsd === undefined
              ? "unavailable"
              : formatUsd(totalCostUsd),
            totalCostUsd === undefined ? "muted" : "success",
          ),
        ]
      : []),
    border("├", "┤", "TOOLS"),
    ...toolRows(metrics.toolCalls, innerWidth, accent),
    border("╰", "╯"),
  ].join("\n");
};

import type { AgentContextUsage, Provider } from "../harnesses/index.js";
import {
  boxBorder,
  boxRow,
  boxRows,
  modeAccent,
  preferredInnerWidth,
  type Tone,
} from "./terminal.js";

const number = new Intl.NumberFormat("en-US");

const percentage = (value: number): string => `${value.toFixed(2)}%`;

export const renderInitialContext = (
  provider: Provider,
  context: AgentContextUsage,
): string => {
  const innerWidth = preferredInnerWidth(82, 68);
  const accent = modeAccent(context.mode);
  const providerName = provider === "claude" ? "Claude" : "Codex";
  const modeName = context.mode === "jcr" ? "JCR" : "Skills";
  const row = (label: string, value: string, tone: Tone = "default"): string =>
    boxRow(innerWidth, label, value, accent, tone);
  const rows = (
    label: string,
    value: string,
    tone: Tone = "default",
  ): string[] => boxRows(innerWidth, label, value, accent, tone);
  const border = (left: string, right: string, title?: string): string =>
    boxBorder(innerWidth, left, right, title, accent);
  const commonRows = [
    row("Provider", providerName, "info"),
    row(
      "Capability mode",
      modeName,
      context.mode === "jcr" ? "highlight" : "info",
    ),
    ...rows(
      "Execution boundary",
      context.mode === "jcr"
        ? "resolver only; no skills or operational calls"
        : "local skill reads only; no operational calls",
      "muted",
    ),
    ...rows("Agent tools", context.agentTools.join(", ") || "none", "warning"),
    ...(context.tree
      ? [
          row(
            "Capability tree",
            `${number.format(context.tree.groups)} groups · ${number.format(context.tree.nodes)} nodes · ${number.format(context.tree.items)} items · depth ${number.format(context.tree.maxDepth)}`,
            "highlight",
          ),
        ]
      : []),
  ];
  if (context.status === "unavailable") {
    return [
      border(
        "╭",
        "╮",
        `INITIAL CONTEXT · ${providerName.toUpperCase()} · ${modeName.toUpperCase()}`,
      ),
      ...commonRows,
      ...(context.mode === "jcr"
        ? [
            row("Skills visible", "0 (isolated by harness)", "success"),
            row("Skill discovery index", "0 tokens exposed", "success"),
            row("Window used by skills", "0.00%", "success"),
          ]
        : []),
      row("SDK context report", "unavailable", "warning"),
      ...(context.mode === "skills"
        ? [row("Skill token count", "unavailable", "warning")]
        : []),
      ...rows("Reason", context.reason, "muted"),
      border("╰", "╯"),
    ].join("\n");
  }

  return [
    border(
      "╭",
      "╮",
      `INITIAL CONTEXT · ${providerName.toUpperCase()} · ${modeName.toUpperCase()}`,
    ),
    ...commonRows,
    row("Model", context.model, "info"),
    ...rows("Source", context.source, "muted"),
    row(
      "Context in use",
      `${number.format(context.totalTokens)} / ${number.format(context.contextWindowTokens)} tokens (${percentage(context.totalPercentage)})`,
      "info",
    ),
    row(
      "Skills discovered",
      `${number.format(context.includedSkills)} / ${number.format(context.totalSkills)}`,
      context.includedSkills > 0 ? "success" : "muted",
    ),
    row(
      "Skill discovery index",
      `${number.format(context.skillTokens)} tokens`,
      context.skillTokens > 0 ? "success" : "muted",
    ),
    row(
      "Window used by skills",
      percentage(context.skillPercentage),
      context.skillPercentage > 0 ? "success" : "muted",
    ),
    ...rows(
      "Discovery content",
      context.mode === "jcr"
        ? "none; tree stays behind resolve_capabilities"
        : "provider-tokenized skill frontmatter",
      "muted",
    ),
    ...rows(
      "Full skill bodies",
      context.mode === "jcr"
        ? "unavailable to the agent"
        : "loaded on demand after selection",
      "muted",
    ),
    border("╰", "╯"),
  ].join("\n");
};

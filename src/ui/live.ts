import type {
  AgentMetrics,
  CapabilityMode,
  Provider,
} from "../harnesses/index.js";
import {
  boxBorder,
  boxRow,
  boxRows,
  modeAccent,
  preferredInnerWidth,
  providerAccent,
  style,
  wrapText,
} from "./terminal.js";
import { errorMessage } from "../errors.js";
import { isResolverCall, isSkillCall } from "./tool-kind.js";

const number = new Intl.NumberFormat("en-US");

export const renderRunHeader = (
  provider: Provider,
  model: string,
  mode: CapabilityMode,
  prompt: string,
): string => {
  const width = preferredInnerWidth(92, 64);
  const accent = modeAccent(mode);
  return [
    boxBorder(
      width,
      "╭",
      "╮",
      `${provider.toUpperCase()} · ${mode.toUpperCase()} RUN`,
      accent,
    ),
    boxRow(width, "Model", model, accent, "info", 14),
    ...boxRows(width, "Request", prompt, accent, "default", 14),
    boxBorder(width, "╰", "╯", undefined, accent),
  ].join("\n");
};

export const renderStatus = (message: string): string =>
  `  ${style.green("●")} ${style.gray("SESSION")}  ${style.dim(message)}`;

const classifyTool = (
  message: string,
): {
  icon: string;
  label: string;
  color: (value: string) => string;
} => {
  const normalized = message.toLowerCase();
  if (isSkillCall(message)) {
    return { icon: "◈", label: "SKILL READ", color: style.cyan };
  }
  if (isResolverCall(message)) {
    return { icon: "◆", label: "JCR RESOLVE", color: style.magenta };
  }
  if (normalized.startsWith("mcp__") || normalized.includes(".")) {
    return { icon: "◇", label: "MCP CALL", color: style.blue };
  }
  if (normalized.startsWith("web_search")) {
    return { icon: "◎", label: "WEB SEARCH", color: style.yellow };
  }
  return { icon: "›", label: "TOOL CALL", color: style.yellow };
};

export const renderToolEvent = (message: string): string => {
  const classification = classifyTool(message);
  const prefix = `  ${classification.color(classification.icon)} ${classification.color(classification.label.padEnd(11))}  `;
  const continuation = " ".repeat(18);
  return wrapText(message, preferredInnerWidth(92, 64) - 14)
    .map(
      (line, index) =>
        `${index === 0 ? prefix : continuation}${style.dim(line)}`,
    )
    .join("\n");
};

export const renderLiveMetrics = (metrics: AgentMetrics): string => {
  const context = metrics.usage?.contextTokens;
  return [
    `  ${style.gray("◌")} ${style.gray("LIVE".padEnd(11))}`,
    style.dim("context "),
    style.cyan(context === undefined ? "pending" : number.format(context)),
    style.dim("  tools "),
    style.yellow(number.format(metrics.toolCalls.length)),
    style.dim("  model calls "),
    style.magenta(
      metrics.modelCalls === undefined
        ? "n/a"
        : number.format(metrics.modelCalls),
    ),
  ].join("");
};

export const renderResponseHeader = (provider: Provider): string => {
  const accent = providerAccent(provider);
  return `\n${accent("◆")} ${style.bold("AGENT RESPONSE")} ${accent("─".repeat(28))}`;
};

export const renderError = (message: string): string =>
  `${style.titleRed("ERROR")} ${style.red("×")} ${message}`;

export const exitWithError = (error: unknown): void => {
  process.stderr.write(`${renderError(errorMessage(error))}\n`);
  process.exitCode = 1;
};

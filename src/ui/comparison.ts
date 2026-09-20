import type {
  AgentMetrics,
  CapabilityMode,
  Provider,
} from "../harnesses/index.js";
import { estimateDecomposerCostUsd, estimateJevCostUsd } from "../pricing.js";
import {
  boxBorder,
  formatUsd,
  style,
  truncate,
  type Styler,
} from "./terminal.js";
import { countSkillCalls } from "./tool-kind.js";

export type ComparisonSnapshot = {
  provider: Provider;
  model?: string;
  metrics: AgentMetrics;
};

type MetricDefinition = {
  label: string;
  skills: number | undefined;
  jcr: number | undefined;
  format: (value: number) => string;
  notApplicableIn?: CapabilityMode;
};

const number = new Intl.NumberFormat("en-US");
const widths = [23, 13, 13, 22] as const;
const innerWidth = widths.reduce((total, width) => total + width, 0) + 11;

const cell = (
  value: string,
  width: number,
  align: "left" | "right",
  color: Styler,
): string => {
  const fitted = truncate(value, width);
  const padded =
    align === "right" ? fitted.padStart(width) : fitted.padEnd(width);
  return color(padded);
};

const row = (
  values: [string, string, string, string],
  colors: [Styler, Styler, Styler, Styler],
): string =>
  `│ ${cell(values[0], widths[0], "left", colors[0])} │ ${cell(
    values[1],
    widths[1],
    "right",
    colors[1],
  )} │ ${cell(values[2], widths[2], "right", colors[2])} │ ${cell(
    values[3],
    widths[3],
    "right",
    colors[3],
  )} │`;

const routingCostUsd = (metrics: AgentMetrics): number | undefined => {
  if (!metrics.jcr) return 0;
  const decomposerCostUsd = metrics.jcr.decomposer
    ? estimateDecomposerCostUsd(metrics.jcr.decomposer)
    : 0;
  return decomposerCostUsd === undefined
    ? undefined
    : estimateJevCostUsd(metrics.jcr.jevInputTokens) + decomposerCostUsd;
};

const totalCostUsd = (metrics: AgentMetrics): number | undefined => {
  const routing = routingCostUsd(metrics);
  return metrics.estimatedCostUsd === undefined || routing === undefined
    ? undefined
    : metrics.estimatedCostUsd + routing;
};

const delta = (
  skills: number | undefined,
  jcr: number | undefined,
  format: (value: number) => string,
): { value: string; color: Styler } => {
  if (skills === undefined || jcr === undefined) {
    return { value: "unavailable", color: style.gray };
  }
  const saved = skills - jcr;
  if (saved === 0) {
    return { value: "0 (0.0%)", color: style.gray };
  }
  const percentage =
    skills === 0 ? undefined : (Math.abs(saved) / skills) * 100;
  const suffix = percentage === undefined ? "" : ` (${percentage.toFixed(1)}%)`;
  return saved > 0
    ? {
        value: `${format(saved)}${suffix} less`,
        color: style.green,
      }
    : {
        value: `${format(Math.abs(saved))}${suffix} more`,
        color: style.red,
      };
};

export const renderComparison = (
  skillsRun: ComparisonSnapshot,
  jcrRun: ComparisonSnapshot,
): string => {
  const skillsUsage = skillsRun.metrics.usage;
  const jcrUsage = jcrRun.metrics.usage;
  const metrics: MetricDefinition[] = [
    {
      label: "Total context processed",
      skills: skillsUsage?.contextTokens,
      jcr: jcrUsage?.contextTokens,
      format: number.format,
    },
    {
      label: "Input",
      skills: skillsUsage?.inputTokens,
      jcr: jcrUsage?.inputTokens,
      format: number.format,
    },
    {
      label: "Output",
      skills: skillsUsage?.outputTokens,
      jcr: jcrUsage?.outputTokens,
      format: number.format,
    },
    {
      label: "Cache read",
      skills: skillsUsage?.cachedInputTokens,
      jcr: jcrUsage?.cachedInputTokens,
      format: number.format,
    },
    {
      label: "Cache write",
      skills: skillsUsage?.cacheWriteInputTokens,
      jcr: jcrUsage?.cacheWriteInputTokens,
      format: number.format,
    },
    {
      label: "Agent model cost",
      skills: skillsRun.metrics.estimatedCostUsd,
      jcr: jcrRun.metrics.estimatedCostUsd,
      format: formatUsd,
    },
    {
      label: "Jev + decomposer cost",
      skills: undefined,
      jcr: routingCostUsd(jcrRun.metrics),
      format: formatUsd,
      notApplicableIn: "skills",
    },
    {
      label: "Total cost",
      skills: totalCostUsd(skillsRun.metrics),
      jcr: totalCostUsd(jcrRun.metrics),
      format: formatUsd,
    },
    {
      label: "Tool calls",
      skills: skillsRun.metrics.toolCalls.length,
      jcr: jcrRun.metrics.toolCalls.length,
      format: number.format,
    },
    {
      label: "Skill calls",
      skills: countSkillCalls(skillsRun.metrics.toolCalls),
      jcr: undefined,
      format: number.format,
      notApplicableIn: "jcr",
    },
  ];
  const accent = style.magenta;
  return [
    boxBorder(
      innerWidth,
      "╭",
      "╮",
      `${skillsRun.provider.toUpperCase()} · SKILLS vs JCR · SAVINGS`,
      accent,
    ),
    row(
      ["Metric", "Skills", "JCR", "Saved by JCR"],
      [style.bold, style.cyan, style.magenta, style.green],
    ),
    boxBorder(innerWidth, "├", "┤", undefined, accent),
    ...metrics.map((metric) => {
      const saved = metric.notApplicableIn
        ? { value: "n/a", color: style.gray }
        : delta(metric.skills, metric.jcr, metric.format);
      const column = (mode: CapabilityMode, value: number | undefined) =>
        metric.notApplicableIn === mode
          ? "—"
          : value === undefined
            ? "unavailable"
            : metric.format(value);
      return row(
        [
          metric.label,
          column("skills", metric.skills),
          column("jcr", metric.jcr),
          saved.value,
        ],
        [
          style.white,
          metric.skills === undefined ? style.gray : style.cyan,
          metric.jcr === undefined ? style.gray : style.magenta,
          saved.color,
        ],
      );
    }),
    boxBorder(innerWidth, "╰", "╯", undefined, accent),
  ].join("\n");
};

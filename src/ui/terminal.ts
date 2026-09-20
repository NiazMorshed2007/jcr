import { stdout } from "node:process";

export type Styler = (value: string) => string;
export type Tone =
  "default" | "muted" | "info" | "highlight" | "success" | "warning" | "danger";

const apply =
  (code: string): Styler =>
  (value) =>
    colorsEnabled() ? `\u001B[${code}m${value}\u001B[0m` : value;

export const colorsEnabled = (): boolean => {
  if (process.env.NO_COLOR !== undefined || process.env.FORCE_COLOR === "0") {
    return false;
  }
  return process.env.FORCE_COLOR !== undefined || Boolean(stdout.isTTY);
};

export const style = {
  plain: (value: string): string => value,
  bold: apply("1"),
  dim: apply("2"),
  gray: apply("90"),
  red: apply("91"),
  green: apply("92"),
  yellow: apply("93"),
  blue: apply("94"),
  magenta: apply("95"),
  cyan: apply("96"),
  white: apply("97"),
  titleCyan: apply("1;96"),
  titleMagenta: apply("1;95"),
  titleGreen: apply("1;92"),
  titleYellow: apply("1;93"),
  titleRed: apply("1;91"),
};

const toneStyles: Record<Tone, Styler> = {
  default: style.white,
  muted: style.gray,
  info: style.cyan,
  highlight: style.magenta,
  success: style.green,
  warning: style.yellow,
  danger: style.red,
};

export const truncate = (value: string, width: number): string =>
  value.length > width ? `${value.slice(0, Math.max(0, width - 1))}…` : value;

export const preferredInnerWidth = (
  preferred: number,
  minimum = 60,
): number => {
  const available = (stdout.columns ?? preferred + 4) - 4;
  return Math.max(minimum, Math.min(preferred, available));
};

export const wrapText = (value: string, width: number): string[] => {
  const lines: string[] = [];
  for (const paragraph of value.split("\n")) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      if (word.length > width) {
        if (line) {
          lines.push(line);
          line = "";
        }
        for (let index = 0; index < word.length; index += width) {
          const chunk = word.slice(index, index + width);
          if (chunk.length === width) {
            lines.push(chunk);
          } else {
            line = chunk;
          }
        }
        continue;
      }
      if (!line) {
        line = word;
      } else if (line.length + word.length + 1 <= width) {
        line += ` ${word}`;
      } else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  return lines.length > 0 ? lines : [""];
};

export const boxBorder = (
  innerWidth: number,
  left: string,
  right: string,
  title: string | undefined,
  accent: Styler,
): string => {
  const prefix = title ? `─ ${title} ` : "";
  return accent(
    `${left}${prefix}${"─".repeat(Math.max(0, innerWidth - prefix.length))}${right}`,
  );
};

export const boxRow = (
  innerWidth: number,
  label: string,
  value: string,
  accent: Styler,
  tone: Tone = "default",
  labelWidth = 24,
): string => {
  const valueWidth = Math.max(1, innerWidth - labelWidth - 1);
  const fittedValue = truncate(value, valueWidth);
  const plainContent = ` ${label.padEnd(labelWidth)}${fittedValue}`;
  const padding = " ".repeat(Math.max(0, innerWidth - plainContent.length));
  return `${accent("│")} ${style.gray(label.padEnd(labelWidth))}${toneStyles[tone](fittedValue)}${padding}${accent("│")}`;
};

export const boxRows = (
  innerWidth: number,
  label: string,
  value: string,
  accent: Styler,
  tone: Tone = "default",
  labelWidth = 24,
): string[] => {
  const valueWidth = Math.max(1, innerWidth - labelWidth - 1);
  return wrapText(value, valueWidth).map((line, index) =>
    boxRow(
      innerWidth,
      index === 0 ? label : "",
      line,
      accent,
      tone,
      labelWidth,
    ),
  );
};

export const formatDuration = (milliseconds: number): string => {
  const seconds = milliseconds / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ${String(Math.round(seconds % 60)).padStart(2, "0")}s`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
};

export const formatUsd = (value: number): string =>
  `$${value.toFixed(value >= 1 ? 4 : 6)}`;

export const providerAccent = (provider: "claude" | "codex"): Styler =>
  provider === "claude" ? style.magenta : style.green;

export const modeAccent = (mode: "skills" | "jcr"): Styler =>
  mode === "jcr" ? style.magenta : style.cyan;

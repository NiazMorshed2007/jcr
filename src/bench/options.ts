import type { Provider } from "../harnesses/types.js";
import type { CapabilityMode } from "../jcr/types.js";
import { newBatchId, variantId } from "./runner.js";
import type { BenchScenario, BenchVariant } from "./types.js";

export type BenchOptions = {
  providers: Provider[];
  modes: CapabilityMode[];
  claudeModels: string[];
  codexModels: string[];
  scenarioIds?: string[];
  category?: string;
  limit?: number;
  concurrency: number;
  timeoutMs: number;
  onlyMissing: boolean;
  dryRun: boolean;
  batchId: string;
  help: boolean;
};

const list = (value: string): string[] =>
  value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

const valueAfter = (args: string[], index: number, flag: string): string => {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
};

const members = <T extends string>(
  values: string[],
  allowed: readonly T[],
  label: string,
): T[] => {
  for (const value of values) {
    if (!allowed.includes(value as T)) {
      throw new Error(`Unknown ${label}: ${value}`);
    }
  }
  return values as T[];
};

export const parseBenchOptions = (
  args: string[],
  environment: NodeJS.ProcessEnv = process.env,
): BenchOptions => {
  const options: BenchOptions = {
    providers: ["claude", "codex"],
    modes: ["skills", "jcr"],
    claudeModels: list(
      environment.BENCH_CLAUDE_MODELS ?? environment.CLAUDE_MODEL ?? "haiku",
    ),
    codexModels: list(
      environment.BENCH_CODEX_MODELS ??
        environment.CODEX_MODEL ??
        "gpt-5.6-luna",
    ),
    concurrency: 4,
    timeoutMs: 300_000,
    onlyMissing: false,
    dryRun: false,
    batchId: newBatchId(),
    help: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]!;
    switch (flag) {
      case "-h":
      case "--help":
        options.help = true;
        break;
      case "--providers":
        options.providers = members(
          list(valueAfter(args, index, flag)),
          ["claude", "codex"] as const,
          "provider",
        );
        index += 1;
        break;
      case "--modes":
        options.modes = members(
          list(valueAfter(args, index, flag)),
          ["skills", "jcr"] as const,
          "mode",
        );
        index += 1;
        break;
      case "--claude-models":
        options.claudeModels = list(valueAfter(args, index, flag));
        index += 1;
        break;
      case "--codex-models":
        options.codexModels = list(valueAfter(args, index, flag));
        index += 1;
        break;
      case "--scenarios":
        options.scenarioIds = list(valueAfter(args, index, flag));
        index += 1;
        break;
      case "--category":
        options.category = valueAfter(args, index, flag);
        index += 1;
        break;
      case "--limit":
        options.limit = Number(valueAfter(args, index, flag));
        index += 1;
        break;
      case "--concurrency":
        options.concurrency = Number(valueAfter(args, index, flag));
        index += 1;
        break;
      case "--timeout":
        options.timeoutMs = Number(valueAfter(args, index, flag)) * 1000;
        index += 1;
        break;
      case "--batch-id":
        options.batchId = valueAfter(args, index, flag);
        index += 1;
        break;
      case "--only-missing":
        options.onlyMissing = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      default:
        throw new Error(`Unknown option: ${flag}`);
    }
  }
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
    throw new Error("--concurrency must be a positive integer");
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("--timeout must be a positive number");
  }
  if (
    options.limit !== undefined &&
    (!Number.isInteger(options.limit) || options.limit < 1)
  ) {
    throw new Error("--limit must be a positive integer");
  }
  return options;
};

export const buildVariants = (
  options: Pick<
    BenchOptions,
    "providers" | "modes" | "claudeModels" | "codexModels"
  >,
): BenchVariant[] =>
  options.providers.flatMap((provider) =>
    (provider === "claude"
      ? options.claudeModels
      : options.codexModels
    ).flatMap((model) =>
      options.modes.map((mode) => ({
        id: variantId({ provider, mode, model }),
        provider,
        mode,
        model,
      })),
    ),
  );

export const selectScenarios = (
  scenarios: BenchScenario[],
  options: Pick<BenchOptions, "scenarioIds" | "category" | "limit">,
): BenchScenario[] => {
  let selected = scenarios;
  if (options.scenarioIds) {
    const wanted = new Set(options.scenarioIds);
    const unknown = options.scenarioIds.filter(
      (id) => !scenarios.some((scenario) => scenario.id === id),
    );
    if (unknown.length > 0) {
      throw new Error(`Unknown scenarios: ${unknown.join(", ")}`);
    }
    selected = selected.filter((scenario) => wanted.has(scenario.id));
  }
  if (options.category) {
    selected = selected.filter(
      (scenario) => scenario.category === options.category,
    );
  }
  return options.limit === undefined
    ? selected
    : selected.slice(0, options.limit);
};

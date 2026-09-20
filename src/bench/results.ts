import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { resultsDirectory } from "./catalog.js";
import type {
  BenchRun,
  BenchTotals,
  BenchVariant,
  VariantAggregate,
} from "./types.js";

export const runFile = (batchId: string): string =>
  join(resultsDirectory, `${batchId}.ndjson`);

export const progressFile = (batchId: string): string =>
  join(resultsDirectory, `${batchId}.progress.json`);

const parseRuns = (content: string): BenchRun[] =>
  content
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as BenchRun];
      } catch {
        return [];
      }
    });

export const readAllRuns = async (): Promise<BenchRun[]> => {
  await mkdir(resultsDirectory, { recursive: true });
  const files = (await readdir(resultsDirectory)).filter((name) =>
    name.endsWith(".ndjson"),
  );
  return (
    await Promise.all(
      files.map((name) =>
        readFile(join(resultsDirectory, name), "utf8").then(parseRuns),
      ),
    )
  ).flat();
};

export const latestBatchId = (runs: BenchRun[]): string | undefined =>
  [...new Set(runs.map((run) => run.batchId))]
    .map((batchId) => ({
      batchId,
      startedAt:
        runs
          .filter((run) => run.batchId === batchId)
          .map((run) => run.startedAt)
          .sort()
          .at(-1) ?? "",
    }))
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0]
    ?.batchId;

export const latestPerCell = (runs: BenchRun[]): BenchRun[] => {
  const latest = new Map<string, BenchRun>();
  for (const run of runs) {
    const current = latest.get(run.key);
    if (!current || run.finishedAt > current.finishedAt) {
      latest.set(run.key, run);
    }
  }
  return [...latest.values()];
};

export const variantFromRun = (run: BenchRun): BenchVariant => ({
  id: run.variantId,
  provider: run.provider,
  mode: run.mode,
  model: run.model,
});

export const emptyTotals = (): BenchTotals => ({
  durationMs: 0,
  context: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteInputTokens: 0,
  outputTokens: 0,
  toolCalls: 0,
  skillReads: 0,
  resolverCalls: 0,
  jevCalls: 0,
  jevInputTokens: 0,
  jevOutputTokens: 0,
  decomposerCalls: 0,
  decomposerInputTokens: 0,
  decomposerOutputTokens: 0,
  agentCostUsd: 0,
  jevCostUsd: 0,
  decomposerCostUsd: 0,
  totalCostUsd: 0,
});

const totalKeys = Object.keys(emptyTotals()) as (keyof BenchTotals)[];

export const costKeys: ReadonlySet<keyof BenchTotals> = new Set([
  "agentCostUsd",
  "jevCostUsd",
  "decomposerCostUsd",
  "totalCostUsd",
]);

export const isCosted = (run: BenchRun): boolean =>
  run.measurements.totalCostUsd !== undefined;

const runTotals = (run: BenchRun): BenchTotals => {
  const { measurements } = run;
  const jcr = measurements.jcr;
  const costed = isCosted(run);
  return {
    durationMs: measurements.durationMs,
    context: measurements.contextProcessed ?? 0,
    inputTokens: measurements.inputTokens ?? 0,
    cachedInputTokens: measurements.cachedInputTokens ?? 0,
    cacheWriteInputTokens: measurements.cacheWriteInputTokens ?? 0,
    outputTokens: measurements.outputTokens ?? 0,
    toolCalls: measurements.toolCallCount,
    skillReads: measurements.skillReadCount,
    resolverCalls: jcr?.resolverCalls ?? 0,
    jevCalls: jcr?.jevCalls ?? 0,
    jevInputTokens: jcr?.jevInputTokens ?? 0,
    jevOutputTokens: jcr?.jevOutputTokens ?? 0,
    decomposerCalls: jcr?.decomposerCalls ?? 0,
    decomposerInputTokens: jcr?.decomposerInputTokens ?? 0,
    decomposerOutputTokens: jcr?.decomposerOutputTokens ?? 0,
    agentCostUsd: costed ? (measurements.agentCostUsd ?? 0) : 0,
    jevCostUsd: costed ? (jcr?.jevCostUsd ?? 0) : 0,
    decomposerCostUsd: costed ? (jcr?.decomposerCostUsd ?? 0) : 0,
    totalCostUsd: measurements.totalCostUsd ?? 0,
  };
};

const addTotals = (left: BenchTotals, right: BenchTotals): BenchTotals =>
  Object.fromEntries(
    totalKeys.map((key) => [key, left[key] + right[key]]),
  ) as BenchTotals;

const divide = (value: number, divisor: number): number =>
  divisor === 0 ? 0 : value / divisor;

export const aggregateVariant = (
  variant: BenchVariant,
  runs: BenchRun[],
): VariantAggregate => {
  const totals = runs.map(runTotals).reduce(addTotals, emptyTotals());
  const costedRuns = runs.filter(isCosted).length;
  const perRun = Object.fromEntries(
    totalKeys.map((key) => [
      key,
      divide(totals[key], costKeys.has(key) ? costedRuns : runs.length),
    ]),
  ) as BenchTotals;
  return { variant, runs: runs.length, costedRuns, totals, perRun };
};

export const aggregateRuns = (runs: BenchRun[]): VariantAggregate[] => {
  const groups = new Map<string, BenchRun[]>();
  for (const run of runs) {
    const group = groups.get(run.variantId) ?? [];
    group.push(run);
    groups.set(run.variantId, group);
  }
  return [...groups.values()]
    .map((group) => aggregateVariant(variantFromRun(group[0]!), group))
    .sort((left, right) => left.variant.id.localeCompare(right.variant.id));
};

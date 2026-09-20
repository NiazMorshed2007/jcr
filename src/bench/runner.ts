import { appendFile, mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { errorMessage } from "../errors.js";
import { createHarness } from "../harnesses/index.js";
import type { AgentMetrics, AgentRunResult } from "../harnesses/types.js";
import type { JcrMetrics } from "../jcr/types.js";
import { estimateDecomposerCostUsd, estimateJevCostUsd } from "../pricing.js";
import { countSkillCalls } from "../ui/tool-kind.js";
import { repositoryRoot, resultsDirectory } from "./catalog.js";
import {
  latestPerCell,
  progressFile,
  readAllRuns,
  runFile,
} from "./results.js";
import type {
  BenchJcrMeasurements,
  BenchMeasurements,
  BenchProgress,
  BenchRun,
  BenchScenario,
  BenchVariant,
} from "./types.js";

export type BenchRunnerOptions = {
  batchId: string;
  scenarios: BenchScenario[];
  variants: BenchVariant[];
  concurrency: number;
  timeoutMs: number;
  onlyMissing: boolean;
  signal?: AbortSignal;
  onStart?: (total: number, skipped: number) => void;
  onCellStart?: (scenario: BenchScenario, variant: BenchVariant) => void;
  onCellDone?: (
    scenario: BenchScenario,
    variant: BenchVariant,
    run: BenchRun,
  ) => void;
};

type Cell = {
  key: string;
  scenario: BenchScenario;
  variant: BenchVariant;
};

export const variantId = (variant: {
  provider: string;
  mode: string;
  model: string;
}): string => `${variant.provider}:${variant.mode}:${variant.model}`;

export const cellKey = (scenarioId: string, variant: BenchVariant): string =>
  `${scenarioId}|${variant.provider}|${variant.mode}|${variant.model}`;

export const buildCells = (
  scenarios: BenchScenario[],
  variants: BenchVariant[],
): Cell[] =>
  scenarios.flatMap((scenario) =>
    variants.map((variant) => ({
      key: cellKey(scenario.id, variant),
      scenario,
      variant,
    })),
  );

export const newBatchId = (): string => {
  const date = new Date().toISOString().replaceAll(/[:.]/g, "-");
  return `${date.slice(0, 19)}-${Math.random().toString(36).slice(2, 6)}`;
};

const emptyMetrics = (): AgentMetrics => ({
  durationMs: 0,
  toolCalls: [],
  turns: 0,
});

export const jcrMeasurements = (metrics: JcrMetrics): BenchJcrMeasurements => {
  const decomposer = metrics.decomposer;
  const decomposerCostUsd = decomposer
    ? estimateDecomposerCostUsd(decomposer)
    : 0;
  return {
    resolverCalls: metrics.resolverCalls,
    jevCalls: metrics.jevRequests,
    jevInputTokens: metrics.jevInputTokens,
    jevOutputTokens: metrics.jevOutputTokens,
    jevCostUsd: estimateJevCostUsd(metrics.jevInputTokens),
    ...(decomposer ? { decomposerModel: decomposer.model } : {}),
    decomposerCalls: decomposer?.calls ?? 0,
    decomposerInputTokens: decomposer?.inputTokens ?? 0,
    decomposerOutputTokens: decomposer?.outputTokens ?? 0,
    ...(decomposerCostUsd !== undefined ? { decomposerCostUsd } : {}),
  };
};

export const measure = (
  metrics: AgentMetrics,
  durationMs: number,
): BenchMeasurements => {
  const usage = metrics.usage;
  const jcr = metrics.jcr ? jcrMeasurements(metrics.jcr) : undefined;
  const agentCostUsd = metrics.estimatedCostUsd;
  const routingCostUsd =
    jcr === undefined
      ? 0
      : jcr.decomposerCostUsd === undefined
        ? undefined
        : jcr.jevCostUsd + jcr.decomposerCostUsd;
  const totalCostUsd =
    agentCostUsd === undefined || routingCostUsd === undefined
      ? undefined
      : agentCostUsd + routingCostUsd;
  return {
    durationMs,
    ...(usage
      ? {
          contextProcessed: usage.contextTokens,
          inputTokens: usage.inputTokens,
          cachedInputTokens: usage.cachedInputTokens,
          cacheWriteInputTokens: usage.cacheWriteInputTokens,
          outputTokens: usage.outputTokens,
        }
      : {}),
    toolCallCount: metrics.toolCalls.length,
    skillReadCount: countSkillCalls(metrics.toolCalls),
    ...(agentCostUsd !== undefined
      ? { agentCostUsd, agentCostBasis: metrics.costBasis ?? "sdk" }
      : {}),
    ...(jcr ? { jcr } : {}),
    ...(totalCostUsd !== undefined ? { totalCostUsd } : {}),
  };
};

const runCell = async (
  cell: Cell,
  options: BenchRunnerOptions,
): Promise<BenchRun> => {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const controller = new AbortController();
  let result: AgentRunResult | undefined;
  let lastMetrics: AgentMetrics | undefined;
  let status: BenchRun["status"] = "ok";
  let error: string | undefined;
  const forwardAbort = (): void => controller.abort();
  options.signal?.addEventListener("abort", forwardAbort, { once: true });
  let timer: NodeJS.Timeout | undefined;

  try {
    result = await Promise.race([
      createHarness(cell.variant.provider).run({
        prompt: cell.scenario.prompt,
        model: cell.variant.model,
        mode: cell.variant.mode,
        workingDirectory: repositoryRoot,
        abortController: controller,
        onEvent: (event) => {
          if (event.type === "metrics") lastMetrics = event.metrics;
        },
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(`Exceeded ${options.timeoutMs / 1000}s timeout`));
        }, options.timeoutMs);
      }),
    ]);
  } catch (caught) {
    error = errorMessage(caught);
    status = error.startsWith("Exceeded ") ? "timeout" : "error";
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener("abort", forwardAbort);
  }

  const finishedAtMs = Date.now();
  const metrics = result?.metrics ?? lastMetrics ?? emptyMetrics();
  return {
    batchId: options.batchId,
    key: cell.key,
    scenarioId: cell.scenario.id,
    provider: cell.variant.provider,
    mode: cell.variant.mode,
    model: cell.variant.model,
    ...(result?.model && result.model !== cell.variant.model
      ? { resolvedModel: result.model }
      : {}),
    variantId: cell.variant.id,
    startedAt,
    finishedAt: new Date(finishedAtMs).toISOString(),
    status,
    ...(error ? { error } : {}),
    measurements: measure(metrics, finishedAtMs - startedAtMs),
  };
};

export const runBenchmark = async (
  options: BenchRunnerOptions,
): Promise<BenchProgress> => {
  await mkdir(resultsDirectory, { recursive: true });
  let cells = buildCells(options.scenarios, options.variants);
  let skipped = 0;
  if (options.onlyMissing) {
    const completed = new Set(
      latestPerCell(await readAllRuns())
        .filter((run) => run.status === "ok")
        .map((run) => run.key),
    );
    const pending = cells.filter((cell) => !completed.has(cell.key));
    skipped = cells.length - pending.length;
    cells = pending;
  }

  const progress: BenchProgress = {
    batchId: options.batchId,
    startedAt: new Date().toISOString(),
    total: cells.length,
    done: 0,
    failed: 0,
    running: [],
    variants: options.variants,
    scenarioIds: options.scenarios.map((scenario) => scenario.id),
  };
  const path = progressFile(options.batchId);
  let writes = Promise.resolve();
  const persist = (action: () => Promise<void>): Promise<void> => {
    writes = writes.then(action);
    return writes;
  };
  const writeProgress = (): Promise<void> => {
    const content = `${JSON.stringify(progress, null, 2)}\n`;
    return persist(async () => {
      const temporary = join(
        resultsDirectory,
        `${options.batchId}.${process.pid}.tmp`,
      );
      await writeFile(temporary, content);
      await rename(temporary, path);
    });
  };
  const writeRun = (run: BenchRun): Promise<void> =>
    persist(() =>
      appendFile(runFile(options.batchId), `${JSON.stringify(run)}\n`),
    );

  await writeProgress();
  options.onStart?.(cells.length, skipped);
  const queue = [...cells];
  const worker = async (): Promise<void> => {
    while (queue.length > 0 && !options.signal?.aborted) {
      const cell = queue.shift()!;
      progress.running.push(cell.key);
      await writeProgress();
      options.onCellStart?.(cell.scenario, cell.variant);
      const run = await runCell(cell, options);
      await writeRun(run);
      progress.running = progress.running.filter((key) => key !== cell.key);
      progress.done += 1;
      if (run.status !== "ok") progress.failed += 1;
      await writeProgress();
      options.onCellDone?.(cell.scenario, cell.variant, run);
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.max(1, Math.floor(options.concurrency)) },
      worker,
    ),
  );
  progress.finishedAt = new Date().toISOString();
  progress.running = [];
  await writeProgress();
  return progress;
};

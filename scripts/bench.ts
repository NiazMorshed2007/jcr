import { config } from "dotenv";
import { loadScenarios } from "../src/bench/catalog.js";
import {
  buildVariants,
  parseBenchOptions,
  selectScenarios,
} from "../src/bench/options.js";
import { buildCells, runBenchmark } from "../src/bench/runner.js";
import { latestPerCell, readAllRuns } from "../src/bench/results.js";
import type { BenchVariant } from "../src/bench/types.js";
import { renderBenchmarkReport } from "../src/ui/benchmark-report.js";
import { exitWithError } from "../src/ui/live.js";
import { formatDuration, formatUsd, style } from "../src/ui/terminal.js";

config({ quiet: true });

const number = new Intl.NumberFormat("en-US");

const help = `Usage:
  npm run bench -- [options]

Runs a parallel matrix of realistic product requests through Claude Code and
Codex in Skills and JCR modes, then prints a terminal comparison report of
cost (agent model + Jev + decomposer), time, context processed, tool calls,
skill reads, and Jev usage.

Options:
  --providers <list>        claude,codex (default: both)
  --modes <list>            skills,jcr (default: both)
  --claude-models <list>    Comma-separated Claude models
  --codex-models <list>     Comma-separated Codex models
  --scenarios <list>        Comma-separated scenario ids (default: all 50)
  --category <slug>         Run one scenario category
  --limit <n>               Run the first n selected scenarios
  --concurrency <n>         Parallel agent runs (default: 4)
  --timeout <seconds>       Timeout per run (default: 300)
  --only-missing            Skip cells with an existing successful result
  --batch-id <id>           Use a specific result batch id
  --dry-run                 Print the matrix without calling models
  -h, --help                Show this help

Examples:
  npm run bench -- --limit 5
  npm run bench -- --concurrency 8
  npm run bench -- --claude-models haiku,sonnet --codex-models gpt-5.6-luna,gpt-5.6-terra
  npm run bench -- --scenarios stripe-duplicate-refund,sentry-top-issues-to-linear`;

const plainVariantLabel = (variant: BenchVariant): string =>
  `${variant.provider}·${variant.mode}·${variant.model}`;

const variantLabel = (variant: BenchVariant, width = 0): string => {
  const provider =
    variant.provider === "claude"
      ? style.magenta("claude")
      : style.green("codex");
  const mode =
    variant.mode === "jcr" ? style.magenta("jcr") : style.cyan("skills");
  const padding = " ".repeat(
    Math.max(0, width - plainVariantLabel(variant).length),
  );
  return `${provider}·${mode}·${style.dim(variant.model)}${padding}`;
};

const main = async (): Promise<void> => {
  const options = parseBenchOptions(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${help}\n`);
    return;
  }
  const scenarios = selectScenarios(await loadScenarios(), options);
  const variants = buildVariants(options);
  if (scenarios.length === 0) {
    throw new Error("No scenarios matched the requested filters");
  }
  if (variants.length === 0) {
    throw new Error("No variants selected");
  }
  const matrixSize = scenarios.length * variants.length;
  process.stdout.write(
    [
      "",
      style.titleMagenta("CAPABILITY HARNESS BENCHMARK"),
      `${scenarios.length} scenarios × ${variants.length} variants = ${style.bold(String(matrixSize))} runs`,
      `${options.concurrency} parallel · ${options.timeoutMs / 1000}s timeout`,
      "",
      ...variants.map((variant) => `  ${variantLabel(variant)}`),
      "",
    ].join("\n"),
  );
  if (options.dryRun) {
    for (const scenario of scenarios) {
      process.stdout.write(
        `${style.dim(scenario.id.padEnd(46))} ${scenario.integrations.join(", ")}\n`,
      );
    }
    return;
  }

  const controller = new AbortController();
  process.once("SIGINT", () => {
    process.stderr.write(
      `\n${style.yellow("Stopping after active runs finish…")}\n`,
    );
    controller.abort();
  });
  process.once("SIGTERM", () => controller.abort());
  let done = 0;
  let total = matrixSize;
  const labelWidth = Math.max(
    ...variants.map((variant) => plainVariantLabel(variant).length),
  );
  const scenarioWidth = Math.max(
    ...scenarios.map((scenario) => scenario.id.length),
  );
  const progress = await runBenchmark({
    batchId: options.batchId,
    scenarios,
    variants,
    concurrency: options.concurrency,
    timeoutMs: options.timeoutMs,
    onlyMissing: options.onlyMissing,
    signal: controller.signal,
    onStart: (pending, skipped) => {
      total = pending;
      if (skipped > 0) {
        process.stdout.write(
          `${style.gray(`Skipping ${skipped} successful cells`)}\n\n`,
        );
      }
    },
    onCellDone: (scenario, variant, run) => {
      done += 1;
      const mark = run.status === "ok" ? style.green("✓") : style.red("✗");
      const { measurements } = run;
      const context =
        measurements.contextProcessed !== undefined
          ? number.format(measurements.contextProcessed)
          : "n/a";
      const time = style.yellow(
        formatDuration(measurements.durationMs).padStart(7),
      );
      const cost =
        measurements.totalCostUsd === undefined
          ? style.gray("cost n/a".padEnd(14))
          : style.green(
              `cost ${formatUsd(measurements.totalCostUsd)}`.padEnd(14),
            );
      const skillReads =
        run.mode === "jcr" ? "—" : String(measurements.skillReadCount);
      const detail =
        run.status === "ok"
          ? `${context} context · ${measurements.toolCallCount} tools · ${skillReads} skill reads`
          : style.red(run.error ?? run.status);
      process.stdout.write(
        `${mark} ${style.gray(
          `[${String(done).padStart(3)}/${String(total).padStart(3)}]`,
        )} ${variantLabel(variant, labelWidth)}  ${scenario.id.padEnd(
          scenarioWidth,
        )}  ${cost} · ${time} · ${detail}\n`,
      );
    },
  });

  const elapsedMs =
    Date.parse(progress.finishedAt ?? progress.startedAt) -
    Date.parse(progress.startedAt);
  process.stdout.write(
    `\n${style.gray(
      `${progress.done}/${progress.total} runs finished in ${formatDuration(elapsedMs)} wall-clock · ${progress.failed} failed`,
    )}\n`,
  );

  const selectedKeys = new Set(
    buildCells(scenarios, variants).map((cell) => cell.key),
  );
  const reportRuns = latestPerCell(await readAllRuns()).filter((run) =>
    selectedKeys.has(run.key),
  );
  process.stdout.write(
    `\n${renderBenchmarkReport(reportRuns, scenarios, options.batchId)}\n`,
  );
};

main().catch(exitWithError);

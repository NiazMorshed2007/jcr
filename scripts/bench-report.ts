import { config } from "dotenv";
import { loadScenarios } from "../src/bench/catalog.js";
import {
  latestBatchId,
  latestPerCell,
  readAllRuns,
} from "../src/bench/results.js";
import { renderBenchmarkReport } from "../src/ui/benchmark-report.js";
import { exitWithError } from "../src/ui/live.js";

config({ quiet: true });

const help = `Usage:
  npm run bench:report
  npm run bench:report -- --batch <id>
  npm run bench:report -- --all-latest

Without options, reports the most recent benchmark batch.`;

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) {
    process.stdout.write(`${help}\n`);
    return;
  }
  const batchIndex = args.indexOf("--batch");
  const requestedBatch = batchIndex >= 0 ? args[batchIndex + 1] : undefined;
  const allLatest = args.includes("--all-latest");
  const [allRuns, scenarios] = await Promise.all([
    readAllRuns(),
    loadScenarios(),
  ]);
  const batchId = requestedBatch ?? latestBatchId(allRuns);
  if (!batchId) {
    throw new Error("No benchmark results yet. Run npm run bench first.");
  }
  const runs = allLatest
    ? latestPerCell(allRuns)
    : allRuns.filter((run) => run.batchId === batchId);
  if (runs.length === 0) {
    throw new Error(`No results found for batch ${batchId}`);
  }
  process.stdout.write(
    `${renderBenchmarkReport(
      runs,
      scenarios,
      allLatest ? "latest result per matrix cell" : batchId,
    )}\n`,
  );
};

main().catch(exitWithError);

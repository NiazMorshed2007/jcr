import assert from "node:assert/strict";
import test from "node:test";
import { aggregateVariant } from "./results.js";
import type { BenchMeasurements, BenchRun, BenchVariant } from "./types.js";

const variant: BenchVariant = {
  id: "codex:jcr:gpt-5.6-luna",
  provider: "codex",
  mode: "jcr",
  model: "gpt-5.6-luna",
};

const run = (
  scenarioId: string,
  measurements: Partial<BenchMeasurements>,
): BenchRun => ({
  batchId: "batch",
  key: `${scenarioId}|codex|jcr|gpt-5.6-luna`,
  scenarioId,
  provider: "codex",
  mode: "jcr",
  model: "gpt-5.6-luna",
  variantId: variant.id,
  startedAt: "2026-09-20T00:00:00.000Z",
  finishedAt: "2026-09-20T00:00:10.000Z",
  status: "ok",
  measurements: {
    durationMs: 10_000,
    toolCallCount: 1,
    skillReadCount: 0,
    ...measurements,
  },
});

test("sums usage and costs and averages costs over costed runs only", () => {
  const aggregate = aggregateVariant(variant, [
    run("a", {
      contextProcessed: 1_000,
      agentCostUsd: 0.01,
      agentCostBasis: "list-price",
      jcr: {
        resolverCalls: 1,
        jevCalls: 3,
        jevInputTokens: 6_000,
        jevOutputTokens: 30,
        jevCostUsd: 0.000252,
        decomposerCalls: 0,
        decomposerInputTokens: 0,
        decomposerOutputTokens: 0,
        decomposerCostUsd: 0,
      },
      totalCostUsd: 0.010252,
    }),
    run("b", { contextProcessed: 3_000 }),
  ]);
  assert.equal(aggregate.runs, 2);
  assert.equal(aggregate.costedRuns, 1);
  assert.equal(aggregate.totals.context, 4_000);
  assert.equal(aggregate.perRun.context, 2_000);
  assert.equal(aggregate.totals.jevCalls, 3);
  assert.equal(aggregate.perRun.jevCalls, 1.5);
  assert.ok(Math.abs(aggregate.totals.totalCostUsd - 0.010252) < 1e-12);
  assert.ok(Math.abs(aggregate.perRun.totalCostUsd - 0.010252) < 1e-12);
  assert.ok(Math.abs(aggregate.totals.jevCostUsd - 0.000252) < 1e-12);
});

test("ignores cost components of runs without a total cost", () => {
  const aggregate = aggregateVariant(variant, [
    run("a", { agentCostUsd: 0.5 }),
  ]);
  assert.equal(aggregate.costedRuns, 0);
  assert.equal(aggregate.totals.agentCostUsd, 0);
  assert.equal(aggregate.perRun.totalCostUsd, 0);
});

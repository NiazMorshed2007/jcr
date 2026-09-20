import assert from "node:assert/strict";
import test from "node:test";
import type {
  BenchJcrMeasurements,
  BenchRun,
  BenchScenario,
} from "../bench/types.js";
import { renderBenchmarkReport } from "./benchmark-report.js";

const scenario: BenchScenario = {
  id: "stripe-refund",
  title: "Refund a charge",
  prompt: "Refund a Stripe charge",
  category: "payments-and-finance",
  integrations: ["stripe"],
  compound: false,
};

const compoundScenario: BenchScenario = {
  id: "stripe-to-slack",
  title: "Post Stripe signups to Slack",
  prompt: "Post new Stripe signups to Slack",
  category: "cross-integration",
  integrations: ["stripe", "slack"],
  compound: true,
};

const jcrUsage: BenchJcrMeasurements = {
  resolverCalls: 1,
  jevCalls: 4,
  jevInputTokens: 8_000,
  jevOutputTokens: 40,
  jevCostUsd: 0.000336,
  decomposerModel: "gpt-5.6-luna",
  decomposerCalls: 1,
  decomposerInputTokens: 60,
  decomposerOutputTokens: 20,
  decomposerCostUsd: 0.000072,
};

type RunOptions = {
  provider?: "claude" | "codex";
  model?: string;
  cost?: number;
  scenarioId?: string;
  status?: BenchRun["status"];
};

const run = (
  mode: "skills" | "jcr",
  contextTokens: number,
  durationMs: number,
  options: RunOptions = {},
): BenchRun => {
  const provider = options.provider ?? "claude";
  const model = options.model ?? "haiku";
  const scenarioId = options.scenarioId ?? scenario.id;
  const jcr = mode === "jcr" ? jcrUsage : undefined;
  const routing = jcr ? jcr.jevCostUsd + (jcr.decomposerCostUsd ?? 0) : 0;
  return {
    batchId: "batch-1",
    key: `${scenarioId}|${provider}|${mode}|${model}`,
    scenarioId,
    provider,
    mode,
    model,
    variantId: `${provider}:${mode}:${model}`,
    startedAt: "2026-09-19T00:00:00.000Z",
    finishedAt: "2026-09-19T00:00:01.000Z",
    status: options.status ?? "ok",
    ...(options.status === "timeout" ? { error: "timed out" } : {}),
    measurements: {
      durationMs,
      contextProcessed: contextTokens,
      inputTokens: contextTokens / 2,
      cachedInputTokens: contextTokens / 2,
      cacheWriteInputTokens: 0,
      outputTokens: 500,
      toolCallCount: mode === "skills" ? 4 : 1,
      skillReadCount: mode === "skills" ? 2 : 0,
      ...(options.cost === undefined
        ? {}
        : {
            agentCostUsd: options.cost,
            agentCostBasis: provider === "claude" ? "sdk" : "list-price",
            totalCostUsd: options.cost + routing,
          }),
      ...(jcr ? { jcr } : {}),
    },
  };
};

const singlePair = (): BenchRun[] => [
  run("skills", 2000, 12_400, { cost: 0.02 }),
  run("jcr", 1000, 9_200, { cost: 0.01 }),
];

test("headline shows per-run averages, signed deltas, and win ratios", () => {
  const report = renderBenchmarkReport(singlePair(), [scenario], "batch-1");
  assert.match(report, /JCR vs SKILLS · AVERAGE PER RUN/);
  assert.match(report, /claude · haiku\s+│ skills/);
  assert.match(report, /−\$0\.0096 \(−48%\)/);
  assert.match(report, /−3\.2s \(−26%\)/);
  assert.match(report, /−1,000 \(−50%\)/);
  assert.match(report, /−3 \(−75%\)/);
  assert.match(report, /Skill reads/);
  const wins = report.split("\n").find((line) => line.includes("jcr wins"));
  assert.ok(wins);
  assert.equal(wins.match(/1\/1/g)?.length, 4);
  assert.match(report, /Total cost\s+\$0\.0304 across 2 costed runs/);
  assert.doesNotMatch(report, /score|goal met|accuracy/i);
});

test("bills the JCR way with Jev and decomposer and compares only totals", () => {
  const report = renderBenchmarkReport(singlePair(), [scenario], "batch-1");
  assert.match(report, /SKILLS WAY vs JCR WAY · TOTAL COST/);
  assert.match(
    report,
    /claude · haiku\s+│ Usage\s+│\s+Skills way\s+│\s+JCR way\s+│\s+JCR − Skills/,
  );
  const lines = report.split("\n");
  const agent = lines.find((line) => line.includes("│ Agent model"));
  assert.ok(agent);
  assert.match(
    agent,
    /2,000 → 1,000 ctx\s+│\s+\$0\.0200\s+│\s+\$0\.0100\s+│\s+│$/,
  );
  const jev = lines.find((line) => line.includes("│ + Jev routing"));
  assert.ok(jev);
  assert.match(jev, /4 calls · 8,000 ctx\s+│\s+—\s+│\s+\$0\.0003\s+│\s+│$/);
  const decomposer = lines.find((line) => line.includes("│ + Decomposer"));
  assert.ok(decomposer);
  assert.match(decomposer, /1 call · 80 tok\s+│\s+—\s+│\s+\$0\.0001\s+│\s+│$/);
  const total = lines.find((line) => line.includes("│ = Total"));
  assert.ok(total);
  assert.match(
    total,
    /Jev\+dec 3\.9% of JCR way\s+│\s+\$0\.0200\s+│\s+\$0\.0104\s+│\s+−\$0\.0096 \(−48%\)/,
  );
  assert.doesNotMatch(report, /\+\$0\.0003|\+\$0\.0001/);
});

test("lists one row per scenario and model with percentage deltas", () => {
  const report = renderBenchmarkReport(
    [
      ...singlePair(),
      run("skills", 3000, 20_000, {
        provider: "codex",
        model: "gpt-5.6-luna",
        cost: 0.004,
      }),
      run("jcr", 1500, 10_000, {
        provider: "codex",
        model: "gpt-5.6-luna",
        cost: 0.003,
      }),
      run("skills", 5000, 30_000, {
        scenarioId: compoundScenario.id,
        cost: 0.05,
      }),
      run("jcr", 2500, 20_000, {
        scenarioId: compoundScenario.id,
        cost: 0.02,
      }),
    ],
    [scenario, compoundScenario],
    "batch-1",
  );
  assert.match(report, /BY SCENARIO/);
  assert.match(report, /2 scenarios × 4 variants · 6 runs/);
  const lines = report.split("\n");
  const refund = lines.find((line) => line.startsWith("│ Refund a charge"));
  assert.ok(refund);
  assert.match(
    refund,
    /haiku\s+│\s+\$0\.0200\s+│\s+\$0\.0104\s+│\s+−48%\s+│\s+−26%\s+│\s+−50%\s+│\s+4 → 1\s+│\s+4\s+│\s+8,000/,
  );
  const luna = lines.find((line) => /^│\s+│ gpt-5\.6-luna/.test(line));
  assert.ok(luna);
  assert.match(luna, /−50%/);
  assert.match(report, /│ ⇉ Post Stripe signups to Slack/);
  assert.match(report, /gpt-5\.6-luna: \$0\.20 in · \$0\.02 cached/);
  assert.match(report, /OpenAI list price × reported tokens/);
});

test("keeps mode-specific columns blocked instead of comparing them", () => {
  const report = renderBenchmarkReport(singlePair(), [scenario], "batch-1");
  const lines = report.split("\n");
  const skillsRow = lines.find((line) =>
    /claude · haiku\s+│ skills/.test(line),
  );
  const jcrRow = lines.find((line) => /^│\s+│ jcr\s+│/.test(line));
  assert.ok(skillsRow?.includes("—"));
  assert.ok(jcrRow?.includes("—"));
  assert.match(jcrRow!, /│\s+—\s+│\s+4\s+│\s+8,000\s+│$/);
  assert.doesNotMatch(report, /−2 \(−100%\)/);
});

test("reports missing costs as n/a and long durations in minutes", () => {
  const report = renderBenchmarkReport(
    [run("skills", 2000, 95_000), run("jcr", 1000, 5_000)],
    [scenario],
    "batch-1",
  );
  assert.match(report, /Total cost\s+n\/a/);
  assert.match(report, /Runs without cost\s+2/);
  assert.match(report, /1m 35s/);
  assert.match(report, /−1m 30s \(−95%\)/);
});

test("marks failed runs and excludes them from deltas and wins", () => {
  const report = renderBenchmarkReport(
    [
      run("skills", 2000, 600_000, { status: "timeout" }),
      run("jcr", 1000, 9_200, { cost: 0.01 }),
    ],
    [scenario],
    "batch-1",
  );
  assert.match(report, /Run errors\s+1/);
  assert.match(report, /✗ timeout/);
  assert.match(report, /RUN ERRORS/);
  assert.match(report, /✗ stripe-refund · claude\/skills\/haiku · timed out/);
  const wins = report.split("\n").find((line) => line.includes("jcr wins"));
  assert.ok(wins);
  assert.match(wins, /n\/a/);
  assert.doesNotMatch(wins, /\d\/\d/);
});

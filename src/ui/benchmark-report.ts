import type {
  BenchRun,
  BenchScenario,
  BenchTotals,
  BenchVariant,
  VariantAggregate,
} from "../bench/types.js";
import { aggregateRuns, isCosted } from "../bench/results.js";
import { decomposerServiceTier } from "../jcr/decompose.js";
import type { CapabilityMode } from "../jcr/types.js";
import {
  describeListPrice,
  jevInputPricePerMillion,
  pricingCheckedOn,
  serviceTierMultiplier,
} from "../pricing.js";
import {
  boxBorder,
  formatDuration,
  style,
  truncate,
  type Styler,
} from "./terminal.js";

const number = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
});

const integer = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const usd = (value: number): string => `$${value.toFixed(4)}`;

const blocked = "—";
const missing = "n/a";

const sign = (value: number): string => (value > 0 ? "+" : "−");

const pad = (
  value: string,
  width: number,
  align: "left" | "right" = "left",
): string => {
  const fitted = truncate(value, width);
  return align === "right" ? fitted.padStart(width) : fitted.padEnd(width);
};

const edge = style.magenta("│");

const border = (
  left: string,
  right: string,
  width: number,
  title?: string,
): string => boxBorder(width, left, right, title, style.magenta);

const summaryRow = (
  width: number,
  label: string,
  value: string,
  tone: Styler = style.white,
): string => {
  const labelWidth = 22;
  return `${edge} ${style.gray(pad(label, labelWidth))}${tone(
    pad(value, width - labelWidth - 1),
  )}${edge}`;
};

const textRow = (width: number, text: string, tone: Styler): string =>
  `${edge} ${tone(pad(text, width - 1))}${edge}`;

const modeTone = (mode: CapabilityMode): Styler =>
  mode === "jcr" ? style.magenta : style.cyan;

const formatCount = (value: number | undefined): string =>
  value === undefined ? missing : number.format(value);

const formatCost = (value: number | undefined): string =>
  value === undefined ? missing : usd(value);

const formatShare = (
  part: number | undefined,
  whole: number | undefined,
): string =>
  part === undefined || whole === undefined || whole === 0
    ? missing
    : `${((part / whole) * 100).toFixed(1)}%`;

const modeOnly = (
  only: CapabilityMode | undefined,
  mode: CapabilityMode,
  value: string,
): string => (only !== undefined && only !== mode ? blocked : value);

type MetricFormat = {
  format: (value: number) => string;
  epsilon: number;
};

const timeMetric: MetricFormat = { format: formatDuration, epsilon: 50 };
const countMetric: MetricFormat = { format: number.format, epsilon: 0.0001 };
const tokenMetric: MetricFormat = { format: integer.format, epsilon: 0.5 };
const costMetric: MetricFormat = { format: usd, epsilon: 0.00005 };

const formatMetric = (
  value: number | undefined,
  metric: MetricFormat,
): string => (value === undefined ? missing : metric.format(value));

type Delta = { text: string; percent: string; tone: Styler };

const missingDelta: Delta = {
  text: missing,
  percent: missing,
  tone: style.gray,
};

const blockedDelta: Delta = {
  text: blocked,
  percent: blocked,
  tone: style.gray,
};

const compare = (
  skills: number | undefined,
  jcr: number | undefined,
  metric: MetricFormat,
): Delta => {
  if (skills === undefined || jcr === undefined) return missingDelta;
  const delta = jcr - skills;
  if (Math.abs(delta) < metric.epsilon) {
    return { text: "0", percent: "0", tone: style.gray };
  }
  const absolute = `${sign(delta)}${metric.format(Math.abs(delta))}`;
  const percent =
    skills === 0
      ? ""
      : `${sign(delta)}${Math.round(Math.abs(delta / skills) * 100)}%`;
  return {
    text: percent === "" ? absolute : `${absolute} (${percent})`,
    percent: percent === "" ? absolute : percent,
    tone: delta < 0 ? style.green : style.red,
  };
};

const tableInnerWidth = (widths: readonly number[]): number =>
  widths.reduce((total, width) => total + width, 0) +
  3 * (widths.length - 1) +
  2;

const table = (
  baseWidths: readonly number[],
  leftAligned: number,
  innerWidth: number,
): {
  header: (columns: string[], tones?: Styler[]) => string[];
  rule: () => string;
  row: (columns: string[], tones: Styler[]) => string;
} => {
  const extra = innerWidth - tableInnerWidth(baseWidths);
  const widths = baseWidths.map((width, index) =>
    index < leftAligned
      ? width +
        Math.floor(extra / leftAligned) +
        (index === 0 ? extra % leftAligned : 0)
      : width,
  );
  const row = (columns: string[], tones: Styler[]): string =>
    `${edge} ${columns
      .map((value, index) =>
        (tones[index] ?? style.white)(
          pad(value, widths[index]!, index < leftAligned ? "left" : "right"),
        ),
      )
      .join(style.gray(" │ "))} ${edge}`;
  const rule = (): string =>
    `${style.magenta("├")}${style.gray(
      widths.map((width) => "─".repeat(width + 2)).join("┼"),
    )}${style.magenta("┤")}`;
  return {
    header: (columns, tones) => [
      row(columns, tones ?? columns.map(() => style.bold)),
      rule(),
    ],
    rule,
    row,
  };
};

type ModePair<T> = {
  provider: string;
  model: string;
  skills?: T;
  jcr?: T;
};

const pairByModel = <T>(
  items: T[],
  variantOf: (item: T) => Pick<BenchVariant, "provider" | "model" | "mode">,
): ModePair<T>[] => {
  const pairs = new Map<string, ModePair<T>>();
  for (const item of items) {
    const { provider, model, mode } = variantOf(item);
    const key = `${provider}|${model}`;
    const pair = pairs.get(key) ?? { provider, model };
    pair[mode] = item;
    pairs.set(key, pair);
  }
  return [...pairs.values()].sort(
    (left, right) =>
      left.provider.localeCompare(right.provider) ||
      left.model.localeCompare(right.model),
  );
};

const groupBy = <T>(
  items: T[],
  keyOf: (item: T) => string,
): Map<string, T[]> => {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return groups;
};

type ScenarioPairs = Map<string, ModePair<BenchRun>[]>;

const pairRunsByScenario = (runs: BenchRun[]): ScenarioPairs =>
  new Map(
    [...groupBy(runs, (run) => run.scenarioId)].map(([scenarioId, group]) => [
      scenarioId,
      pairByModel(group, (run) => run),
    ]),
  );

const okValue = (
  run: BenchRun | undefined,
  pick: (run: BenchRun) => number | undefined,
): number | undefined =>
  run !== undefined && run.status === "ok" ? pick(run) : undefined;

const perRun =
  (key: keyof BenchTotals) =>
  (aggregate: VariantAggregate): number =>
    aggregate.perRun[key];

const costedPerRun =
  (key: keyof BenchTotals) =>
  (aggregate: VariantAggregate): number | undefined =>
    aggregate.costedRuns === 0 ? undefined : aggregate.perRun[key];

const costedTotal =
  (key: keyof BenchTotals) =>
  (aggregate: VariantAggregate): number | undefined =>
    aggregate.costedRuns === 0 ? undefined : aggregate.totals[key];

type Column = {
  label: string;
  metric: MetricFormat;
  only?: CapabilityMode;
  perRun: (aggregate: VariantAggregate) => number | undefined;
  ofRun: (run: BenchRun) => number | undefined;
};

const perRunColumns: Column[] = [
  {
    label: "Cost",
    metric: costMetric,
    perRun: costedPerRun("totalCostUsd"),
    ofRun: (run) => run.measurements.totalCostUsd,
  },
  {
    label: "Time",
    metric: timeMetric,
    perRun: perRun("durationMs"),
    ofRun: (run) => run.measurements.durationMs,
  },
  {
    label: "Context",
    metric: tokenMetric,
    perRun: perRun("context"),
    ofRun: (run) => run.measurements.contextProcessed,
  },
  {
    label: "Tools",
    metric: countMetric,
    perRun: perRun("toolCalls"),
    ofRun: (run) => run.measurements.toolCallCount,
  },
  {
    label: "Skill reads",
    metric: countMetric,
    only: "skills",
    perRun: perRun("skillReads"),
    ofRun: (run) => run.measurements.skillReadCount,
  },
  {
    label: "Jev calls",
    metric: countMetric,
    only: "jcr",
    perRun: perRun("jevCalls"),
    ofRun: (run) => run.measurements.jcr?.jevCalls,
  },
  {
    label: "Jev ctx",
    metric: tokenMetric,
    only: "jcr",
    perRun: perRun("jevInputTokens"),
    ofRun: (run) => run.measurements.jcr?.jevInputTokens,
  },
];

const winRatio = (
  pairs: ModePair<BenchRun>[],
  column: Column,
): { text: string; tone: Styler } => {
  let wins = 0;
  let comparable = 0;
  for (const { skills, jcr } of pairs) {
    const before = okValue(skills, column.ofRun);
    const after = okValue(jcr, column.ofRun);
    if (before === undefined || after === undefined) continue;
    comparable += 1;
    if (before - after > column.metric.epsilon) wins += 1;
  }
  if (comparable === 0) return { text: missing, tone: style.gray };
  const tone =
    wins * 2 > comparable
      ? style.green
      : wins * 2 < comparable
        ? style.red
        : style.yellow;
  return { text: `${wins}/${comparable}`, tone };
};

const perRunWidths = [22, 12, 16, 15, 15, 11, 11, 9, 9] as const;

const perRunTable = (
  aggregates: VariantAggregate[],
  scenarioPairs: ScenarioPairs,
  width: number,
): string[] => {
  const { header, row, rule } = table(perRunWidths, 2, width);
  const output = header([
    "Harness · model",
    "Mode",
    ...perRunColumns.map((column) => column.label),
  ]);
  const modeRow = (label: string, aggregate: VariantAggregate): string => {
    const { mode } = aggregate.variant;
    return row(
      [
        label,
        mode,
        ...perRunColumns.map((column) =>
          modeOnly(
            column.only,
            mode,
            formatMetric(column.perRun(aggregate), column.metric),
          ),
        ),
      ],
      [style.white, modeTone(mode), ...perRunColumns.map(() => style.white)],
    );
  };
  pairByModel(aggregates, (aggregate) => aggregate.variant).forEach(
    (pair, index) => {
      if (index > 0) output.push(rule());
      const label = `${pair.provider} · ${pair.model}`;
      const { skills, jcr } = pair;
      if (skills) output.push(modeRow(label, skills));
      if (jcr) output.push(modeRow(skills ? "" : label, jcr));
      if (!skills || !jcr) return;
      const deltas = perRunColumns.map((column) =>
        column.only
          ? blockedDelta
          : compare(column.perRun(skills), column.perRun(jcr), column.metric),
      );
      output.push(
        row(
          ["", "jcr − skills", ...deltas.map((delta) => delta.text)],
          [style.white, style.bold, ...deltas.map((delta) => delta.tone)],
        ),
      );
      const modelPairs = [...scenarioPairs.values()].flatMap((pairs) =>
        pairs.filter(
          (candidate) =>
            candidate.provider === pair.provider &&
            candidate.model === pair.model,
        ),
      );
      const wins = perRunColumns.map((column) =>
        column.only
          ? { text: "", tone: style.gray }
          : winRatio(modelPairs, column),
      );
      output.push(
        row(
          ["", "jcr wins", ...wins.map((win) => win.text)],
          [style.white, style.bold, ...wins.map((win) => win.tone)],
        ),
      );
    },
  );
  return output;
};

const costWidths = [22, 27, 13, 13, 17] as const;

const plural = (count: number, unit: string): string =>
  `${integer.format(count)} ${unit}${count === 1 ? "" : "s"}`;

const agentUsage = (
  skills: VariantAggregate | undefined,
  jcr: VariantAggregate | undefined,
): string => {
  const context = (aggregate: VariantAggregate | undefined): string =>
    aggregate === undefined
      ? blocked
      : integer.format(aggregate.totals.context);
  return `${context(skills)} → ${context(jcr)} ctx`;
};

const jevUsage = (aggregate: VariantAggregate): string =>
  `${plural(aggregate.totals.jevCalls, "call")} · ${integer.format(
    aggregate.totals.jevInputTokens,
  )} ctx`;

const decomposerUsage = (aggregate: VariantAggregate): string =>
  aggregate.totals.decomposerCalls === 0
    ? blocked
    : `${plural(aggregate.totals.decomposerCalls, "call")} · ${integer.format(
        aggregate.totals.decomposerInputTokens +
          aggregate.totals.decomposerOutputTokens,
      )} tok`;

const costOf = (
  pick: (aggregate: VariantAggregate) => number | undefined,
  aggregate: VariantAggregate | undefined,
): string => (aggregate === undefined ? blocked : formatCost(pick(aggregate)));

const costTable = (aggregates: VariantAggregate[], width: number): string[] => {
  const { header, row, rule } = table(costWidths, 2, width);
  const agent = costedTotal("agentCostUsd");
  const jev = costedTotal("jevCostUsd");
  const decomposer = costedTotal("decomposerCostUsd");
  const total = costedTotal("totalCostUsd");
  const line = (
    label: string,
    usage: string,
    skillsCost: string,
    jcrCost: string,
    delta = "",
    deltaTone: Styler = style.gray,
    emphasis: Styler = style.white,
  ): string =>
    row(
      [label, usage, skillsCost, jcrCost, delta],
      [emphasis, style.gray, style.cyan, style.magenta, deltaTone],
    );
  const output: string[] = [];
  pairByModel(aggregates, (aggregate) => aggregate.variant).forEach(
    (pair, index) => {
      if (index > 0) output.push(rule());
      const { skills, jcr } = pair;
      const routing =
        jcr === undefined || jev(jcr) === undefined
          ? undefined
          : jev(jcr)! + (decomposer(jcr) ?? 0);
      const share = jcr ? formatShare(routing, total(jcr)) : missing;
      const totalDelta =
        skills && jcr
          ? compare(total(skills), total(jcr), costMetric)
          : missingDelta;
      output.push(
        ...header(
          [
            `${pair.provider} · ${pair.model}`,
            "Usage",
            "Skills way",
            "JCR way",
            "JCR − Skills",
          ],
          [style.bold, style.bold, style.cyan, style.magenta, style.bold],
        ),
        line(
          "Agent model",
          agentUsage(skills, jcr),
          costOf(agent, skills),
          costOf(agent, jcr),
        ),
        line(
          "+ Jev routing",
          jcr ? jevUsage(jcr) : blocked,
          blocked,
          costOf(jev, jcr),
        ),
        line(
          "+ Decomposer",
          jcr ? decomposerUsage(jcr) : blocked,
          blocked,
          costOf(decomposer, jcr),
        ),
        line(
          "= Total",
          share === missing ? "" : `Jev+dec ${share} of JCR way`,
          costOf(total, skills),
          costOf(total, jcr),
          totalDelta.text,
          totalDelta.tone,
          style.bold,
        ),
      );
    },
  );
  return output;
};

const scenarioWidths = [32, 14, 9, 9, 7, 7, 7, 7, 9, 9] as const;

const runCost = (run: BenchRun | undefined): string => {
  if (run === undefined) return blocked;
  if (run.status !== "ok") return `✗ ${run.status}`;
  return formatCost(run.measurements.totalCostUsd);
};

const runTone = (run: BenchRun | undefined, tone: Styler): Styler =>
  run !== undefined && run.status !== "ok" ? style.red : tone;

const toolCount = (run: BenchRun | undefined): string =>
  run === undefined || run.status !== "ok"
    ? blocked
    : String(run.measurements.toolCallCount);

const scenarioTable = (
  scenarioPairs: ScenarioPairs,
  scenarios: BenchScenario[],
  width: number,
): string[] => {
  const { header, row } = table(scenarioWidths, 2, width);
  const output = header([
    "Scenario",
    "Model",
    "Skills $",
    "JCR $",
    "Δ cost",
    "Δ time",
    "Δ ctx",
    "Tools",
    "Jev calls",
    "Jev ctx",
  ]);
  const known = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
  const order = [
    ...scenarios
      .map((scenario) => scenario.id)
      .filter((id) => scenarioPairs.has(id)),
    ...[...scenarioPairs.keys()].filter((id) => !known.has(id)).sort(),
  ];
  for (const scenarioId of order) {
    const scenario = known.get(scenarioId);
    const title =
      scenario === undefined
        ? scenarioId
        : `${scenario.compound ? "⇉ " : ""}${scenario.title}`;
    scenarioPairs.get(scenarioId)!.forEach((pair, index) => {
      const { skills, jcr } = pair;
      const delta = (
        pick: (run: BenchRun) => number | undefined,
        metric: MetricFormat,
      ): Delta => compare(okValue(skills, pick), okValue(jcr, pick), metric);
      const cost = delta((run) => run.measurements.totalCostUsd, costMetric);
      const time = delta((run) => run.measurements.durationMs, timeMetric);
      const context = delta(
        (run) => run.measurements.contextProcessed,
        tokenMetric,
      );
      const tools = delta((run) => run.measurements.toolCallCount, countMetric);
      output.push(
        row(
          [
            index === 0 ? title : "",
            pair.model,
            runCost(skills),
            runCost(jcr),
            cost.percent,
            time.percent,
            context.percent,
            `${toolCount(skills)} → ${toolCount(jcr)}`,
            jcr ? formatCount(jcr.measurements.jcr?.jevCalls) : blocked,
            jcr ? formatCount(jcr.measurements.jcr?.jevInputTokens) : blocked,
          ],
          [
            style.white,
            style.white,
            runTone(skills, style.cyan),
            runTone(jcr, style.magenta),
            cost.tone,
            time.tone,
            context.tone,
            tools.tone,
            style.white,
            style.white,
          ],
        ),
      );
    });
  }
  return output;
};

const costBasis = (width: number, runs: BenchRun[]): string[] => {
  const providers = new Set(runs.map((run) => run.provider));
  const codexModels = [
    ...new Set(
      runs.filter((run) => run.provider === "codex").map((run) => run.model),
    ),
  ];
  const decomposerModels = [
    ...new Set(
      runs.flatMap((run) => {
        const model = run.measurements.jcr?.decomposerModel;
        return model === undefined ? [] : [model];
      }),
    ),
  ];
  const listedModels = [...new Set([...codexModels, ...decomposerModels])];
  return [
    border("├", "┤", width, "COST BASIS"),
    ...(providers.has("claude")
      ? [
          summaryRow(
            width,
            "Claude",
            "Claude Agent SDK total_cost_usd (list price)",
          ),
        ]
      : []),
    ...(providers.has("codex")
      ? [
          summaryRow(
            width,
            "Codex",
            "OpenAI list price × reported tokens · standard tier",
          ),
        ]
      : []),
    summaryRow(
      width,
      "Jev",
      `$${jevInputPricePerMillion.toFixed(3)} per 1M input tokens · output free`,
    ),
    ...(decomposerModels.length > 0
      ? [
          summaryRow(
            width,
            "Decomposer",
            `${decomposerModels.join(", ")} · ${decomposerServiceTier} tier (${serviceTierMultiplier[decomposerServiceTier]}× list price)`,
          ),
        ]
      : []),
    ...listedModels.map((model, index) =>
      summaryRow(
        width,
        index === 0 ? "OpenAI list prices" : "",
        describeListPrice(model) ?? `${model}: no list price on file`,
        style.gray,
      ),
    ),
    summaryRow(width, "Prices checked", pricingCheckedOn, style.gray),
  ];
};

export const renderBenchmarkReport = (
  runs: BenchRun[],
  scenarios: BenchScenario[],
  batchLabel = "latest results",
): string => {
  const width = Math.max(
    tableInnerWidth(perRunWidths),
    tableInnerWidth(costWidths),
    tableInnerWidth(scenarioWidths),
  );
  const aggregates = aggregateRuns(runs);
  const scenarioPairs = pairRunsByScenario(runs);
  const failed = runs.filter((run) => run.status !== "ok");
  const costed = runs.filter(isCosted);
  const uncosted = runs.filter((run) => run.status === "ok" && !isCosted(run));
  const totalCost = costed.reduce(
    (sum, run) => sum + (run.measurements.totalCostUsd ?? 0),
    0,
  );
  return [
    border("╭", "╮", width, "CAPABILITY HARNESS MEASUREMENTS"),
    summaryRow(width, "Results", batchLabel, style.magenta),
    summaryRow(
      width,
      "Matrix",
      `${scenarioPairs.size} scenarios × ${aggregates.length} variants · ${runs.length} runs`,
      style.cyan,
    ),
    summaryRow(
      width,
      "Total cost",
      costed.length === 0
        ? missing
        : `${usd(totalCost)} across ${costed.length} costed runs (agent model + Jev + decomposer)`,
      costed.length === 0 ? style.gray : style.green,
    ),
    summaryRow(
      width,
      "Run errors",
      failed.length === 0 ? "none" : String(failed.length),
      failed.length === 0 ? style.green : style.red,
    ),
    ...(uncosted.length > 0
      ? [
          summaryRow(
            width,
            "Runs without cost",
            String(uncosted.length),
            style.yellow,
          ),
        ]
      : []),
    border("├", "┤", width, "JCR vs SKILLS · AVERAGE PER RUN"),
    ...perRunTable(aggregates, scenarioPairs, width),
    textRow(
      width,
      "jcr wins = scenarios where JCR beat Skills on that metric",
      style.gray,
    ),
    border("├", "┤", width, "SKILLS WAY vs JCR WAY · TOTAL COST"),
    ...costTable(aggregates, width),
    textRow(
      width,
      "JCR way = agent model + Jev routing + decomposer · only the totals are compared · Jev context is not added to agent context",
      style.gray,
    ),
    border("├", "┤", width, "BY SCENARIO"),
    ...scenarioTable(scenarioPairs, scenarios, width),
    textRow(
      width,
      "Δ = JCR relative to Skills · Tools = skills → jcr · ⇉ compound request",
      style.gray,
    ),
    ...costBasis(width, runs),
    ...(failed.length > 0
      ? [
          border("├", "┤", width, "RUN ERRORS"),
          ...failed.map((run) =>
            textRow(
              width,
              `✗ ${run.scenarioId} · ${run.provider}/${run.mode}/${run.model} · ${run.error ?? run.status}`,
              style.red,
            ),
          ),
        ]
      : []),
    border("╰", "╯", width),
  ].join("\n");
};

import { performance } from "node:perf_hooks";
import { decomposeRequest } from "./decompose.js";
import {
  JevClient,
  type JevChoice,
  type JevDistribution,
  type JevOption,
  type JevQuestion,
  type JevState,
} from "./jev.js";
import { readChildren, readNode, readRootChildren } from "./tree.js";
import type {
  CapabilityItem,
  CapabilityNode,
  CapabilityResolution,
  JcrMetrics,
  JcrResolveOptions,
  ResolvedStep,
  StepAlternative,
  StepMatch,
  TrailEntry,
  TreeChild,
  UnresolvedStep,
} from "./types.js";

export type JcrResolutionResult = {
  resolution: CapabilityResolution;
  metrics: JcrMetrics;
};

type DistributionChooser = {
  distributions(
    state: JevState,
    questions: JevQuestion[],
  ): Promise<JevDistribution[]>;
};

type ResolverChooser = DistributionChooser & {
  choose(
    state: JevState,
    instructions: string,
    options: JevOption[],
  ): Promise<JevChoice>;
  usage: {
    requests: number;
    inputTokens: number;
    outputTokens: number;
  };
};

type BeamConfig = {
  width: number;
  bandRatio: number;
  maxDepth: number;
};

type CandidateBase = {
  logProbability: number;
  decisions: number;
  score: number;
  trail: TrailEntry[];
};

type OpenCandidate = CandidateBase & {
  kind: "open";
  node?: CapabilityNode;
};

type MatchCandidate = CandidateBase & {
  kind: "match";
  path: string;
  parent: CapabilityNode;
  item: CapabilityItem;
};

type NoneCandidate = CandidateBase & {
  kind: "none";
  node?: CapabilityNode;
  probability: number;
};

type BeamCandidate = OpenCandidate | MatchCandidate | NoneCandidate;

type StepResult = {
  resolved?: ResolvedStep;
  unresolved?: UnresolvedStep;
};

const epsilon = 1e-9;
const defaultBeamWidth = 3;
const defaultBandRatio = 0.6;
const defaultMaxDepth = 16;

const positiveInteger = (
  value: string | undefined,
  fallback: number,
): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const ratio = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1
    ? parsed
    : fallback;
};

const beamConfig = (): BeamConfig => ({
  width: positiveInteger(process.env.JCR_BEAM_WIDTH, defaultBeamWidth),
  bandRatio: ratio(process.env.JCR_BAND_RATIO, defaultBandRatio),
  maxDepth: defaultMaxDepth,
});

const rootNode = (root: string): CapabilityNode => ({
  path: "",
  directory: root,
  id: "",
  name: "Capabilities",
  description: "Top-level capability groups.",
});

const childName = (child: TreeChild): string =>
  child.kind === "node" ? child.node.name : child.item.name;

const childDescription = (child: TreeChild): string =>
  child.kind === "node" ? child.node.description : child.item.description;

const childrenFor = async (
  root: string,
  candidate: OpenCandidate,
): Promise<TreeChild[]> =>
  candidate.node
    ? readChildren(root, candidate.node)
    : (await readRootChildren(root)).map((node) => ({
        kind: "node" as const,
        path: node.path,
        node,
      }));

const questionFor = (
  candidate: OpenCandidate,
  children: TreeChild[],
): JevQuestion => {
  const location =
    candidate.trail.length === 0
      ? "the capability root"
      : candidate.trail.map((entry) => entry.name).join(" > ");
  return {
    instructions: `At ${location}, which direct child best provides the exact capability needed for this step?`,
    options: children.map((child) => ({
      id: child.path,
      name: childName(child),
      description: childDescription(child),
    })),
  };
};

const extendScore = (
  candidate: CandidateBase,
  probability: number,
): Pick<CandidateBase, "logProbability" | "decisions" | "score"> => {
  const logProbability =
    candidate.logProbability + Math.log(Math.max(probability, epsilon));
  const decisions = candidate.decisions + 1;
  return {
    logProbability,
    decisions,
    score: Math.exp(logProbability / decisions),
  };
};

const extendChild = (
  candidate: OpenCandidate,
  child: TreeChild,
  probability: number,
): OpenCandidate | MatchCandidate => {
  const scored = extendScore(candidate, probability);
  if (child.kind === "item") {
    return {
      ...scored,
      kind: "match",
      path: child.path,
      parent: child.parent,
      item: child.item,
      trail: candidate.trail,
    };
  }
  return {
    ...scored,
    kind: "open",
    node: child.node,
    trail: [
      ...candidate.trail,
      {
        id: child.node.id,
        name: child.node.name,
        probability,
      },
    ],
  };
};

const alternativeFor = (candidate: BeamCandidate): StepAlternative => {
  if (candidate.kind === "match") {
    return {
      path: candidate.path,
      name: candidate.item.name,
      score: candidate.score,
    };
  }
  if (candidate.kind === "open" && candidate.node) {
    return {
      path: candidate.node.path,
      name: candidate.node.name,
      score: candidate.score,
    };
  }
  return {
    path: candidate.kind === "none" ? (candidate.node?.path ?? "") : "",
    name: candidate.kind === "none" ? "No match" : "Capabilities",
    score: candidate.score,
  };
};

const nodeSummary = (
  root: string,
  node?: CapabilityNode,
): UnresolvedStep["node"] => {
  const value = node ?? rootNode(root);
  return {
    path: value.path,
    name: value.name,
    description: value.description,
  };
};

const commonParent = async (
  root: string,
  candidates: MatchCandidate[],
): Promise<CapabilityNode | undefined> => {
  const parents = candidates.map((candidate) =>
    candidate.parent.path.split("/"),
  );
  const shared: string[] = [];
  const shortest = Math.min(...parents.map((parts) => parts.length));
  for (let index = 0; index < shortest; index += 1) {
    const part = parents[0]![index];
    if (!parents.every((candidate) => candidate[index] === part)) break;
    shared.push(part!);
  }
  return shared.length > 0 ? readNode(root, shared.join("/")) : undefined;
};

const unresolvedResult = (
  root: string,
  index: number,
  step: string,
  reason: UnresolvedStep["reason"],
  node: CapabilityNode | undefined,
  candidates: BeamCandidate[],
  rounds: number,
): StepResult => ({
  unresolved: {
    index,
    step,
    reason,
    node: nodeSummary(root, node),
    candidates: candidates.slice(0, 8).map(alternativeFor),
    rounds,
  },
});

const resolvedResult = (
  index: number,
  step: string,
  candidates: BeamCandidate[],
  rounds: number,
): StepResult => {
  const matches = candidates.filter(
    (candidate): candidate is MatchCandidate => candidate.kind === "match",
  );
  const none = candidates.filter(
    (candidate): candidate is NoneCandidate => candidate.kind === "none",
  );
  const secondScore = candidates[1]?.score ?? epsilon;
  return {
    resolved: {
      index,
      step,
      matches: matches.map((candidate): StepMatch => ({
        path: candidate.path,
        trail: candidate.trail,
        item: candidate.item,
        score: candidate.score,
      })),
      separation: candidates[0]!.score / Math.max(secondScore, epsilon),
      noneProbability: Math.max(
        0,
        ...none.map((candidate) => candidate.probability),
      ),
      alternatives: candidates
        .filter((candidate) => candidate.kind !== "match")
        .map(alternativeFor),
      rounds,
    },
  };
};

export const beamResolve = async (
  chooser: DistributionChooser,
  root: string,
  request: string,
  step: string,
  index: number,
  config: BeamConfig = beamConfig(),
): Promise<StepResult> => {
  let beam: BeamCandidate[] = [
    {
      kind: "open",
      logProbability: 0,
      decisions: 0,
      score: 1,
      trail: [],
    },
  ];
  let rounds = 0;
  for (; rounds < config.maxDepth; rounds += 1) {
    const open = beam.filter(
      (candidate): candidate is OpenCandidate => candidate.kind === "open",
    );
    const finished = beam.filter((candidate) => candidate.kind !== "open");
    if (open.length === 0) {
      const best = beam[0];
      return best?.kind === "match"
        ? resolvedResult(index, step, beam, rounds)
        : unresolvedResult(
            root,
            index,
            step,
            "none",
            best?.kind === "none" ? best.node : undefined,
            beam,
            rounds,
          );
    }
    const childSets = await Promise.all(
      open.map((candidate) => childrenFor(root, candidate)),
    );
    const distributions = await chooser.distributions(
      { request, step },
      open.map((candidate, candidateIndex) =>
        questionFor(candidate, childSets[candidateIndex]!),
      ),
    );
    if (distributions.length !== open.length) {
      throw new Error(
        `Jev returned ${distributions.length} distributions for ${open.length} beam paths`,
      );
    }
    const expanded: BeamCandidate[] = [...finished];
    open.forEach((candidate, candidateIndex) => {
      const children = childSets[candidateIndex]!;
      const byPath = new Map(children.map((child) => [child.path, child]));
      const distribution = distributions[candidateIndex]!;
      for (const [path, probability] of distribution.probabilities) {
        const child = byPath.get(path);
        if (child && probability > 0) {
          expanded.push(extendChild(candidate, child, probability));
        }
      }
      if (distribution.noneProbability > 0) {
        expanded.push({
          ...extendScore(candidate, distribution.noneProbability),
          kind: "none",
          ...(candidate.node ? { node: candidate.node } : {}),
          probability: distribution.noneProbability,
          trail: candidate.trail,
        });
      }
    });
    expanded.sort((left, right) => right.score - left.score);
    const bestScore = expanded[0]?.score;
    if (bestScore === undefined) {
      return unresolvedResult(
        root,
        index,
        step,
        "none",
        open[0]?.node,
        [],
        rounds + 1,
      );
    }
    const inBand = expanded.filter(
      (candidate) => candidate.score >= bestScore * config.bandRatio,
    );
    const itemBand = inBand.filter(
      (candidate): candidate is MatchCandidate => candidate.kind === "match",
    );
    if (itemBand.length > config.width) {
      return unresolvedResult(
        root,
        index,
        step,
        "ambiguous",
        await commonParent(root, itemBand),
        itemBand,
        rounds + 1,
      );
    }
    beam = inBand.slice(0, config.width);
  }
  const bestOpen = beam.find(
    (candidate): candidate is OpenCandidate => candidate.kind === "open",
  );
  return unresolvedResult(
    root,
    index,
    step,
    "depth",
    bestOpen?.node,
    beam,
    rounds,
  );
};

export const resolveCapabilities = async (
  options: JcrResolveOptions,
  dependencies: {
    chooser?: ResolverChooser;
    decompose?: typeof decomposeRequest;
  } = {},
): Promise<JcrResolutionResult> => {
  const startedAt = performance.now();
  const chooser = dependencies.chooser ?? new JevClient();
  const compoundChoice = await chooser.choose(
    { request: options.request },
    "Does satisfying this request require multiple distinct external integration actions, where each action should be resolved independently?",
    [
      {
        id: "single",
        name: "Single step",
        description:
          "One atomic action on one external product or API is sufficient.",
      },
      {
        id: "compound",
        name: "Compound",
        description:
          "Two or more distinct external integration actions are required.",
      },
    ],
  );
  const compound = compoundChoice.selected?.id === "compound";
  const decomposition = compound
    ? await (dependencies.decompose ?? decomposeRequest)(options.request)
    : undefined;
  const steps = decomposition?.steps ?? [options.request];
  const results = await Promise.all(
    steps.map((step, index) =>
      beamResolve(
        chooser,
        options.capabilitiesDirectory,
        options.request,
        step,
        index,
      ),
    ),
  );
  const resolvedSteps = results
    .map((result) => result.resolved)
    .filter((step): step is ResolvedStep => step !== undefined)
    .sort((left, right) => left.index - right.index);
  const unresolvedSteps = results
    .map((result) => result.unresolved)
    .filter((step): step is UnresolvedStep => step !== undefined)
    .sort((left, right) => left.index - right.index);
  const usage = chooser.usage;
  return {
    resolution: {
      request: options.request,
      compound,
      steps: resolvedSteps,
      unresolved: unresolvedSteps,
    },
    metrics: {
      resolverCalls: 1,
      jevRequests: usage.requests,
      jevInputTokens: usage.inputTokens,
      jevOutputTokens: usage.outputTokens,
      durationMs: performance.now() - startedAt,
      stepsResolved: resolvedSteps.length,
      stepsUnresolved: unresolvedSteps.length,
      beamRounds: results.reduce(
        (total, result) =>
          total + (result.resolved?.rounds ?? result.unresolved?.rounds ?? 0),
        0,
      ),
      matchesReturned: resolvedSteps.reduce(
        (total, step) => total + step.matches.length,
        0,
      ),
      agentOutputChars: 0,
      ...(decomposition ? { decomposer: decomposition.metrics } : {}),
    },
  };
};

export type CapabilityMode = "skills" | "jcr";

export type CapabilityNode = {
  path: string;
  directory: string;
  id: string;
  name: string;
  description: string;
};

export type CapabilityItem = {
  id: string;
  name: string;
  description: string;
  context: string;
};

export type TreeChild =
  | {
      kind: "node";
      path: string;
      node: CapabilityNode;
    }
  | {
      kind: "item";
      path: string;
      parent: CapabilityNode;
      item: CapabilityItem;
    };

export type CapabilityTreeSummary = {
  groups: number;
  nodes: number;
  items: number;
  maxDepth: number;
  maxFanOut: number;
};

export type CapabilitySelection = {
  id: string;
  name: string;
  probability: number;
  confidence: number;
};

export type TrailEntry = {
  id: string;
  name: string;
  probability: number;
};

export type StepMatch = {
  path: string;
  trail: TrailEntry[];
  item: CapabilityItem;
  score: number;
};

export type StepAlternative = {
  path: string;
  name: string;
  score: number;
};

export type ResolvedStep = {
  index: number;
  step: string;
  matches: StepMatch[];
  separation: number;
  noneProbability: number;
  alternatives: StepAlternative[];
  rounds: number;
};

export type UnresolvedStep = {
  index: number;
  step: string;
  reason: "none" | "ambiguous" | "depth";
  node: {
    path: string;
    name: string;
    description: string;
  };
  candidates: StepAlternative[];
  rounds: number;
};

export type CapabilityResolution = {
  request: string;
  compound: boolean;
  steps: ResolvedStep[];
  unresolved: UnresolvedStep[];
};

export type JcrDecomposerMetrics = {
  model: string;
  calls: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
};

export type JcrMetrics = {
  resolverCalls: number;
  jevRequests: number;
  jevInputTokens: number;
  jevOutputTokens: number;
  durationMs: number;
  stepsResolved: number;
  stepsUnresolved: number;
  beamRounds: number;
  matchesReturned: number;
  agentOutputChars: number;
  decomposer?: JcrDecomposerMetrics;
};

export type JcrResolveOptions = {
  request: string;
  capabilitiesDirectory: string;
};

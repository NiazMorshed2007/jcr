import type {
  CapabilityResolution,
  ResolvedStep,
  UnresolvedStep,
} from "./types.js";

const header = (index: number, step: string): string =>
  `## ${index + 1}. ${step}`;

const renderMatches = (step: ResolvedStep, showHeader: boolean): string => {
  const blocks = step.matches.map(
    (match) => `${match.path}\n${match.item.context.trim()}`,
  );
  const parts = [
    ...(showHeader ? [header(step.index, step.step)] : []),
    ...(step.matches.length > 1
      ? [`${step.matches.length} close matches, pick by the request:`]
      : []),
    ...blocks,
  ];
  return parts.join("\n\n");
};

const candidateNames = (step: UnresolvedStep): string =>
  step.candidates.map((candidate) => candidate.name).join(", ");

const renderUnresolved = (
  step: UnresolvedStep,
  showHeader: boolean,
): string => {
  let message: string;
  if (step.reason === "ambiguous") {
    const names = candidateNames(step);
    message = `Ambiguous under ${step.node.name}${
      names ? `: ${names}` : ""
    }. Re-call with a sharper step.`;
  } else if (step.reason === "depth") {
    message = `Resolution stopped at ${step.node.name}. Re-call with a sharper step.`;
  } else {
    const names = candidateNames(step);
    message = names ? `No match. Closest: ${names}.` : "No match.";
  }
  return [...(showHeader ? [header(step.index, step.step)] : []), message].join(
    "\n\n",
  );
};

export const renderAgentOutput = (resolution: CapabilityResolution): string => {
  const steps = [
    ...resolution.steps.map((step) => ({
      index: step.index,
      render: (showHeader: boolean) => renderMatches(step, showHeader),
    })),
    ...resolution.unresolved.map((step) => ({
      index: step.index,
      render: (showHeader: boolean) => renderUnresolved(step, showHeader),
    })),
  ].sort((left, right) => left.index - right.index);
  if (steps.length === 0) return "No match.";
  const showHeaders =
    resolution.compound ||
    steps.length > 1 ||
    (resolution.steps[0]?.matches.length ?? 0) > 1;
  return steps.map((step) => step.render(showHeaders)).join("\n\n");
};

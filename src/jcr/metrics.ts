import { readFile } from "node:fs/promises";
import type { JcrDecomposerMetrics, JcrMetrics } from "./types.js";

const emptyMetrics = (): JcrMetrics => ({
  resolverCalls: 0,
  jevRequests: 0,
  jevInputTokens: 0,
  jevOutputTokens: 0,
  durationMs: 0,
  stepsResolved: 0,
  stepsUnresolved: 0,
  beamRounds: 0,
  matchesReturned: 0,
  agentOutputChars: 0,
});

const addDecomposer = (
  total: JcrDecomposerMetrics | undefined,
  current: JcrDecomposerMetrics | undefined,
): JcrDecomposerMetrics | undefined => {
  if (!current) return total;
  if (!total) return current;
  return {
    model: current.model,
    calls: total.calls + current.calls,
    inputTokens: total.inputTokens + current.inputTokens,
    cachedInputTokens: total.cachedInputTokens + current.cachedInputTokens,
    outputTokens: total.outputTokens + current.outputTokens,
  };
};

export const addJcrMetrics = (
  total: JcrMetrics,
  current: JcrMetrics,
): JcrMetrics => {
  const decomposer = addDecomposer(total.decomposer, current.decomposer);
  return {
    resolverCalls: total.resolverCalls + current.resolverCalls,
    jevRequests: total.jevRequests + current.jevRequests,
    jevInputTokens: total.jevInputTokens + current.jevInputTokens,
    jevOutputTokens: total.jevOutputTokens + current.jevOutputTokens,
    durationMs: total.durationMs + current.durationMs,
    stepsResolved: total.stepsResolved + current.stepsResolved,
    stepsUnresolved: total.stepsUnresolved + current.stepsUnresolved,
    beamRounds: total.beamRounds + current.beamRounds,
    matchesReturned: total.matchesReturned + current.matchesReturned,
    agentOutputChars: total.agentOutputChars + current.agentOutputChars,
    ...(decomposer ? { decomposer } : {}),
  };
};

export const readJcrMetrics = async (path: string): Promise<JcrMetrics> => {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return emptyMetrics();
  }
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as JcrMetrics)
    .reduce(addJcrMetrics, emptyMetrics());
};

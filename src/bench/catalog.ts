import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BenchScenario } from "./types.js";

export const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const benchDirectory = join(repositoryRoot, "bench");
export const resultsDirectory = join(benchDirectory, "results");
export const scenariosFile = join(benchDirectory, "scenarios.json");
export const skillCoverageFile = join(benchDirectory, "skill-coverage.json");

type RawScenario = Omit<BenchScenario, "compound"> & { compound?: boolean };

export const loadScenarios = async (): Promise<BenchScenario[]> => {
  const { scenarios } = JSON.parse(await readFile(scenariosFile, "utf8")) as {
    scenarios: RawScenario[];
  };
  const ids = new Set<string>();
  return scenarios.map((scenario) => {
    if (!scenario.id || ids.has(scenario.id)) {
      throw new Error(`Invalid or duplicate scenario id: ${scenario.id}`);
    }
    if (!scenario.prompt || scenario.integrations.length === 0) {
      throw new Error(`Scenario ${scenario.id} is incomplete`);
    }
    ids.add(scenario.id);
    return {
      ...scenario,
      compound: scenario.compound ?? scenario.integrations.length > 1,
    };
  });
};

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { loadScenarios, skillCoverageFile } from "./catalog.js";

const skillCoveredIntegrations = async (): Promise<Set<string>> => {
  const coverage = JSON.parse(await readFile(skillCoverageFile, "utf8")) as {
    skills: Record<string, { integrations: string[] }>;
  };
  return new Set(
    Object.values(coverage.skills).flatMap((skill) =>
      skill.integrations.map((entry) => entry.split("/")[1]!),
    ),
  );
};

test("loads 50 unique product scenarios across skill-covered categories", async () => {
  const scenarios = await loadScenarios();
  assert.equal(scenarios.length, 50);
  assert.equal(new Set(scenarios.map((scenario) => scenario.id)).size, 50);
  assert.equal(new Set(scenarios.map((scenario) => scenario.category)).size, 8);
  assert.ok(scenarios.some((scenario) => scenario.compound));
  assert.ok(
    scenarios.every(
      (scenario) =>
        scenario.prompt.length > 0 && scenario.integrations.length > 0,
    ),
  );
});

test("every scenario integration has an installed skill so both modes can ground", async () => {
  const covered = await skillCoveredIntegrations();
  const scenarios = await loadScenarios();
  const uncovered = scenarios.flatMap((scenario) =>
    scenario.integrations
      .filter((integration) => !covered.has(integration))
      .map((integration) => `${scenario.id}:${integration}`),
  );
  assert.deepEqual(uncovered, []);
});

test("every prompt asks for concrete, grounded output", async () => {
  const scenarios = await loadScenarios();
  const vague = scenarios
    .filter((scenario) => !/\bexact(ly)?\b/i.test(scenario.prompt))
    .map((scenario) => scenario.id);
  assert.deepEqual(vague, []);
});

test("preserves compound scenario metadata without evaluating responses", async () => {
  const scenario = (await loadScenarios()).find(
    (entry) => entry.id === "stripe-enterprise-signup-to-slack",
  );
  assert.deepEqual(scenario?.integrations, ["stripe", "slack"]);
  assert.equal(scenario?.compound, true);
});

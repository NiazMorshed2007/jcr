import assert from "node:assert/strict";
import test from "node:test";
import { loadScenarios } from "./catalog.js";
import {
  buildVariants,
  parseBenchOptions,
  selectScenarios,
} from "./options.js";

test("builds the provider, mode, and model cross product", () => {
  const options = parseBenchOptions(
    [
      "--claude-models",
      "haiku,sonnet",
      "--codex-models",
      "gpt-5.6-luna,gpt-5.6-terra",
    ],
    {},
  );
  const variants = buildVariants(options);
  assert.equal(variants.length, 8);
  assert.ok(
    variants.some(
      (variant) => variant.id === "claude:jcr:sonnet" && variant.mode === "jcr",
    ),
  );
});

test("selects named scenarios and categories", async () => {
  const scenarios = await loadScenarios();
  const named = selectScenarios(scenarios, {
    scenarioIds: ["stripe-duplicate-refund", "sentry-top-issues-to-linear"],
  });
  assert.equal(named.length, 2);
  const category = selectScenarios(scenarios, {
    category: "google-workspace",
  });
  assert.ok(category.length > 0);
  assert.ok(
    category.every((scenario) => scenario.category === "google-workspace"),
  );
});

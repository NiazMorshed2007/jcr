import assert from "node:assert/strict";
import test from "node:test";
import {
  estimateDecomposerCostUsd,
  estimateJevCostUsd,
  estimateOpenAiCostUsd,
  openAiListPrice,
} from "./pricing.js";

const tokens = {
  inputTokens: 1_000_000,
  cachedInputTokens: 500_000,
  cacheWriteInputTokens: 100_000,
  outputTokens: 200_000,
};

test("prices gpt-5.6-luna at list rates per token class", () => {
  const cost = estimateOpenAiCostUsd("gpt-5.6-luna", tokens);
  assert.ok(cost !== undefined);
  assert.ok(Math.abs(cost - (0.2 + 0.01 + 0.025 + 0.24)) < 1e-9);
});

test("doubles the list price on the fast service tier", () => {
  const standard = estimateOpenAiCostUsd("gpt-5.6-luna", tokens, "standard");
  const fast = estimateOpenAiCostUsd("gpt-5.6-luna", tokens, "fast");
  assert.ok(standard !== undefined && fast !== undefined);
  assert.ok(Math.abs(fast - standard * 2) < 1e-9);
});

test("matches dated model snapshots by prefix and rejects unknown models", () => {
  assert.deepEqual(
    openAiListPrice("gpt-5.6-terra-2026-06-01"),
    openAiListPrice("gpt-5.6-terra"),
  );
  assert.equal(openAiListPrice("gpt-5.6-lunar"), undefined);
  assert.equal(estimateOpenAiCostUsd("mystery-model", tokens), undefined);
});

test("prices Jev on input tokens only", () => {
  assert.ok(Math.abs(estimateJevCostUsd(1_000_000) - 0.042) < 1e-12);
  assert.equal(estimateJevCostUsd(0), 0);
});

test("prices the decomposer at the fast tier with cached tokens discounted", () => {
  const cost = estimateDecomposerCostUsd({
    model: "gpt-5.6-luna",
    calls: 1,
    inputTokens: 1_000_000,
    cachedInputTokens: 400_000,
    outputTokens: 100_000,
  });
  assert.ok(cost !== undefined);
  const expected = (600_000 * 0.2 + 400_000 * 0.02 + 100_000 * 1.2) * 2;
  assert.ok(Math.abs(cost - expected / 1_000_000) < 1e-9);
});

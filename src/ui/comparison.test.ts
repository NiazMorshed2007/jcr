import assert from "node:assert/strict";
import test from "node:test";
import { renderComparison } from "./comparison.js";

test("renders side-by-side Skills and JCR savings", () => {
  const previousNoColor = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
  try {
    const rendered = renderComparison(
      {
        provider: "claude",
        model: "claude-haiku",
        metrics: {
          durationMs: 100,
          turns: 3,
          modelCalls: 3,
          estimatedCostUsd: 0.01,
          toolCalls: ["Skill", "Read", "Read"],
          usage: {
            contextTokens: 1_000,
            inputTokens: 800,
            outputTokens: 200,
            cachedInputTokens: 100,
            cacheWriteInputTokens: 50,
          },
        },
      },
      {
        provider: "claude",
        model: "claude-haiku",
        metrics: {
          durationMs: 80,
          turns: 2,
          modelCalls: 2,
          estimatedCostUsd: 0.004,
          toolCalls: ["mcp__jcr__resolve_capabilities"],
          usage: {
            contextTokens: 400,
            inputTokens: 300,
            outputTokens: 100,
            cachedInputTokens: 0,
            cacheWriteInputTokens: 20,
          },
        },
      },
    );

    assert.match(rendered, /Total context processed[^\n]*1,000[^\n]*400/);
    assert.match(rendered, /600 \(60\.0%\) less/);
    assert.match(
      rendered,
      /Agent model cost[^\n]*\$0\.010000[^\n]*\$0\.004000[^\n]*\$0\.006000 \(60\.0%\) less/,
    );
    assert.match(
      rendered,
      /Jev \+ decomposer cost[^\n]*—[^\n]*\$0\.000000[^\n]*n\/a/,
    );
    assert.match(
      rendered,
      /Total cost[^\n]*\$0\.010000[^\n]*\$0\.004000[^\n]*\$0\.006000 \(60\.0%\) less/,
    );
    assert.match(rendered, /Tool calls[^\n]*3[^\n]*1[^\n]*2 \(66\.7%\) less/);
    assert.match(rendered, /Skill calls[^\n]*1[^\n]*—[^\n]*n\/a/);
  } finally {
    if (previousNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = previousNoColor;
    }
  }
});

test("marks JCR increases instead of reporting them as savings", () => {
  const previousNoColor = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
  try {
    const rendered = renderComparison(
      {
        provider: "codex",
        metrics: {
          durationMs: 100,
          turns: 1,
          toolCalls: [],
          usage: {
            contextTokens: 200,
            inputTokens: 100,
            outputTokens: 100,
            cachedInputTokens: 0,
            cacheWriteInputTokens: 0,
          },
        },
      },
      {
        provider: "codex",
        metrics: {
          durationMs: 100,
          turns: 1,
          toolCalls: [],
          usage: {
            contextTokens: 300,
            inputTokens: 100,
            outputTokens: 200,
            cachedInputTokens: 0,
            cacheWriteInputTokens: 0,
          },
        },
      },
    );

    assert.match(rendered, /100 \(50\.0%\) more/);
    assert.match(
      rendered,
      /Agent model cost[^\n]*unavailable[^\n]*unavailable/,
    );
    assert.match(rendered, /Total cost[^\n]*unavailable[^\n]*unavailable/);
  } finally {
    if (previousNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = previousNoColor;
    }
  }
});

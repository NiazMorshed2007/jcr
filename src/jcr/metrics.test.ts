import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readJcrMetrics } from "./metrics.js";
import type { JcrMetrics } from "./types.js";

const call = (
  jevInputTokens: number,
  decomposer?: JcrMetrics["decomposer"],
): JcrMetrics => ({
  resolverCalls: 1,
  jevRequests: 2,
  jevInputTokens,
  jevOutputTokens: 10,
  durationMs: 100,
  stepsResolved: 1,
  stepsUnresolved: 0,
  beamRounds: 3,
  matchesReturned: 1,
  agentOutputChars: 400,
  ...(decomposer ? { decomposer } : {}),
});

test("sums Jev and decomposer usage across resolver calls", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jcr-metrics-"));
  const file = join(directory, "metrics.ndjson");
  try {
    await writeFile(
      file,
      [
        call(1_000),
        call(2_000, {
          model: "gpt-5.6-luna",
          calls: 1,
          inputTokens: 50,
          cachedInputTokens: 0,
          outputTokens: 20,
        }),
        call(3_000, {
          model: "gpt-5.6-luna",
          calls: 1,
          inputTokens: 70,
          cachedInputTokens: 10,
          outputTokens: 30,
        }),
      ]
        .map((metrics) => JSON.stringify(metrics))
        .join("\n"),
    );
    const metrics = await readJcrMetrics(file);
    assert.equal(metrics.resolverCalls, 3);
    assert.equal(metrics.jevRequests, 6);
    assert.equal(metrics.jevInputTokens, 6_000);
    assert.deepEqual(metrics.decomposer, {
      model: "gpt-5.6-luna",
      calls: 2,
      inputTokens: 120,
      cachedInputTokens: 10,
      outputTokens: 50,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("returns zeroed metrics when no resolver call was recorded", async () => {
  const metrics = await readJcrMetrics(join(tmpdir(), "missing-jcr-metrics"));
  assert.equal(metrics.resolverCalls, 0);
  assert.equal(metrics.decomposer, undefined);
});

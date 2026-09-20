import assert from "node:assert/strict";
import test from "node:test";
import { renderLiveMetrics, renderRunHeader, renderToolEvent } from "./live.js";

const withColorEnvironment = <T>(
  forceColor: string | undefined,
  noColor: string | undefined,
  render: () => T,
): T => {
  const previousForceColor = process.env.FORCE_COLOR;
  const previousNoColor = process.env.NO_COLOR;
  if (forceColor === undefined) {
    delete process.env.FORCE_COLOR;
  } else {
    process.env.FORCE_COLOR = forceColor;
  }
  if (noColor === undefined) {
    delete process.env.NO_COLOR;
  } else {
    process.env.NO_COLOR = noColor;
  }
  try {
    return render();
  } finally {
    if (previousForceColor === undefined) {
      delete process.env.FORCE_COLOR;
    } else {
      process.env.FORCE_COLOR = previousForceColor;
    }
    if (previousNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = previousNoColor;
    }
  }
};

test("renders distinct labels for skill, JCR, MCP, and regular tool calls", () => {
  const rendered = withColorEnvironment(undefined, "1", () =>
    [
      renderToolEvent("skill_loader.load_skill"),
      renderToolEvent("mcp__jcr__resolve_capabilities"),
      renderToolEvent("provider.lookup"),
      renderToolEvent("Read"),
    ].join("\n"),
  );

  assert.match(rendered, /SKILL READ\s+skill_loader\.load_skill/);
  assert.match(rendered, /JCR RESOLVE\s+mcp__jcr__resolve_capabilities/);
  assert.match(rendered, /MCP CALL\s+provider\.lookup/);
  assert.match(rendered, /TOOL CALL\s+Read/);
  assert.doesNotMatch(rendered, /\u001B\[/);
});

test("adds ANSI color only when terminal color is enabled", () => {
  const rendered = withColorEnvironment("1", undefined, () =>
    renderRunHeader("claude", "claude-haiku", "jcr", "Resolve capabilities"),
  );

  assert.match(rendered, /\u001B\[/);
});

test("formats live metrics as one compact status line", () => {
  const rendered = withColorEnvironment(undefined, "1", () =>
    renderLiveMetrics({
      durationMs: 100,
      turns: 2,
      modelCalls: 2,
      toolCalls: ["Skill"],
      usage: {
        contextTokens: 4_512,
        inputTokens: 3_000,
        outputTokens: 1_512,
        cachedInputTokens: 0,
        cacheWriteInputTokens: 0,
      },
    }),
  );

  assert.match(rendered, /context 4,512\s+tools 1\s+model calls 2/);
});

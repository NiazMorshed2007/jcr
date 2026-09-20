import assert from "node:assert/strict";
import test from "node:test";
import { renderInitialContext } from "./initial-context.js";

test("renders SDK-verified zero skill visibility in Claude JCR mode", () => {
  const rendered = renderInitialContext("claude", {
    status: "available",
    mode: "jcr",
    agentTools: ["mcp__jcr__resolve_capabilities"],
    tree: {
      groups: 11,
      nodes: 960,
      items: 11_360,
      maxDepth: 6,
      maxFanOut: 175,
    },
    source: "Claude Agent SDK getContextUsage(full)",
    model: "claude-haiku",
    totalTokens: 1000,
    contextWindowTokens: 200_000,
    totalPercentage: 0.5,
    skillTokens: 0,
    skillPercentage: 0,
    totalSkills: 0,
    includedSkills: 0,
    skills: [],
  });

  assert.match(rendered, /Skills discovered\s+0 \/ 0/);
  assert.match(rendered, /Skill discovery index\s+0 tokens/);
  assert.match(rendered, /Window used by skills\s+0\.00%/);
  assert.match(rendered, /mcp__jcr__resolve_capabilities/);
  assert.match(
    rendered,
    /Capability tree\s+11 groups · 960 nodes · 11,360 items · depth 6/,
  );
  assert.doesNotMatch(rendered, /skill frontmatter/i);
});

test("renders isolated zero skill exposure in Codex JCR mode", () => {
  const rendered = renderInitialContext("codex", {
    status: "unavailable",
    mode: "jcr",
    agentTools: ["jcr.resolve_capabilities"],
    tree: {
      groups: 11,
      nodes: 960,
      items: 11_360,
      maxDepth: 6,
      maxFanOut: 175,
    },
    reason: "SDK context report unavailable",
  });

  assert.match(rendered, /Skills visible\s+0 \(isolated by harness\)/);
  assert.match(rendered, /Skill discovery index\s+0 tokens exposed/);
  assert.match(rendered, /jcr\.resolve_capabilities/);
  assert.doesNotMatch(rendered, /skill_loader/);
});

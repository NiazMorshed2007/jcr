import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { JevDistribution, JevQuestion } from "./jev.js";
import { beamResolve } from "./resolve.js";

type ItemSpec = {
  id: string;
  name?: string;
};

type NodeSpec = {
  items?: ItemSpec[];
  children?: Record<string, NodeSpec>;
};

const json = async (path: string, value: unknown): Promise<void> => {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const writeNode = async (
  root: string,
  path: string,
  spec: NodeSpec,
): Promise<void> => {
  const directory = join(root, ...path.split("/"));
  const id = path.split("/").at(-1)!;
  await mkdir(directory, { recursive: true });
  await json(join(directory, "index.json"), {
    id,
    name: id,
    description: `Routes ${id}`,
  });
  if (spec.items) {
    await json(
      join(directory, "items.json"),
      spec.items.map((item) => ({
        id: item.id,
        name: item.name ?? item.id,
        description: `Routes ${item.name ?? item.id}`,
        context: `Context for ${item.id}`,
      })),
    );
  }
  await Promise.all(
    Object.entries(spec.children ?? {}).map(([childId, child]) =>
      writeNode(root, `${path}/${childId}`, child),
    ),
  );
};

const fixture = async (tree: Record<string, NodeSpec>): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "jcr-beam-"));
  await Promise.all(
    Object.entries(tree).map(([id, spec]) => writeNode(root, id, spec)),
  );
  return root;
};

class ScriptedChooser {
  constructor(
    private readonly weights: (question: JevQuestion) => Record<string, number>,
  ) {}

  async distributions(
    _state: unknown,
    questions: JevQuestion[],
  ): Promise<JevDistribution[]> {
    return questions.map((question) => {
      const weights = this.weights(question);
      const probabilities = new Map(
        question.options.map((option) => [option.id, weights[option.id] ?? 0]),
      );
      const ranked = [...probabilities].sort(
        ([, left], [, right]) => right - left,
      );
      const noneProbability = weights.__none__ ?? 0;
      return {
        ...(ranked[0] && ranked[0][1] > noneProbability
          ? { selectedId: ranked[0][0] }
          : {}),
        confidence: 1,
        probabilities,
        noneProbability,
      };
    });
  }
}

const run = async (
  tree: Record<string, NodeSpec>,
  weights: (question: JevQuestion) => Record<string, number>,
  config = { width: 3, bandRatio: 0.6, maxDepth: 16 },
) => {
  const root = await fixture(tree);
  try {
    return await beamResolve(
      new ScriptedChooser(weights),
      root,
      "request",
      "step",
      0,
      config,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

test("returns one match when every decision is clear", async () => {
  const result = await run(
    {
      alpha: { items: [{ id: "target" }, { id: "other" }] },
      beta: { items: [{ id: "wrong" }] },
    },
    (question) =>
      question.options.some((option) => option.id === "alpha")
        ? { alpha: 0.95, beta: 0.04, __none__: 0.01 }
        : {
            "alpha/target": 0.95,
            "alpha/other": 0.04,
            __none__: 0.01,
          },
  );
  assert.deepEqual(
    result.resolved?.matches.map((match) => match.path),
    ["alpha/target"],
  );
  assert.equal(result.unresolved, undefined);
});

test("keeps a top-level alternative that wins on deeper evidence", async () => {
  const result = await run(
    {
      alpha: { items: [{ id: "wrong" }] },
      beta: { items: [{ id: "target" }] },
    },
    (question) => {
      const ids = new Set(question.options.map((option) => option.id));
      if (ids.has("alpha")) {
        return { alpha: 0.52, beta: 0.46, __none__: 0.02 };
      }
      if (ids.has("alpha/wrong")) {
        return { "alpha/wrong": 0.2, __none__: 0.8 };
      }
      return { "beta/target": 0.99, __none__: 0.01 };
    },
  );
  assert.equal(result.resolved?.matches[0]?.path, "beta/target");
});

test("returns close matches when ambiguity persists", async () => {
  const result = await run(
    {
      group: { items: [{ id: "first" }, { id: "second" }] },
    },
    (question) =>
      question.options.some((option) => option.id === "group")
        ? { group: 0.99, __none__: 0.01 }
        : {
            "group/first": 0.5,
            "group/second": 0.45,
            __none__: 0.05,
          },
  );
  assert.deepEqual(
    result.resolved?.matches.map((match) => match.path),
    ["group/first", "group/second"],
  );
  assert.ok((result.resolved?.separation ?? 0) < 1.2);
});

test("returns unresolved when none is the strongest path", async () => {
  const result = await run(
    {
      group: { items: [{ id: "item" }] },
    },
    () => ({ group: 0.2, __none__: 0.8 }),
  );
  assert.equal(result.unresolved?.reason, "none");
  assert.equal(result.resolved, undefined);
});

test("coarsens a flat item distribution to its parent", async () => {
  const result = await run(
    {
      group: {
        items: [{ id: "one" }, { id: "two" }, { id: "three" }, { id: "four" }],
      },
    },
    (question) =>
      question.options.some((option) => option.id === "group")
        ? { group: 0.99, __none__: 0.01 }
        : {
            "group/one": 0.24,
            "group/two": 0.24,
            "group/three": 0.24,
            "group/four": 0.24,
            __none__: 0.04,
          },
  );
  assert.equal(result.unresolved?.reason, "ambiguous");
  assert.equal(result.unresolved?.node.path, "group");
  assert.equal(result.unresolved?.candidates.length, 4);
});

test("compares shallow and deep leaves by geometric mean", async () => {
  const chain: NodeSpec = { items: [{ id: "deep" }] };
  for (const id of ["e", "d", "c", "b", "a"]) {
    chain.children = { [id]: { ...chain } };
    delete chain.items;
  }
  const result = await run(
    {
      group: {
        items: [{ id: "shallow" }],
        children: chain.children!,
      },
    },
    (question) => {
      const ids = question.options.map((option) => option.id);
      if (ids.includes("group")) return { group: 0.99, __none__: 0.01 };
      if (ids.includes("group/shallow")) {
        const node = ids.find((id) => id !== "group/shallow")!;
        return { "group/shallow": 0.6, [node]: 0.35, __none__: 0.05 };
      }
      const item = ids.find((id) => id.endsWith("/deep"));
      return item
        ? { [item]: 0.99, __none__: 0.01 }
        : { [ids[0]!]: 0.99, __none__: 0.01 };
    },
  );
  assert.ok(result.resolved?.matches[0]?.path.endsWith("/deep"));
  assert.ok(
    result.resolved?.matches.some((match) => match.path === "group/shallow"),
  );
});

test("reports depth exhaustion without guessing", async () => {
  const result = await run(
    {
      group: {
        children: {
          nested: { items: [{ id: "item" }] },
        },
      },
    },
    () => ({ group: 0.99, __none__: 0.01 }),
    { width: 3, bandRatio: 0.6, maxDepth: 1 },
  );
  assert.equal(result.unresolved?.reason, "depth");
  assert.equal(result.unresolved?.node.path, "group");
});

test("rejects an incomplete distribution batch", async () => {
  const root = await fixture({
    group: { items: [{ id: "item" }] },
  });
  try {
    await assert.rejects(
      beamResolve(
        { distributions: async () => [] },
        root,
        "request",
        "step",
        0,
      ),
      /returned 0 distributions for 1 beam paths/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  readChildren,
  readNode,
  readRootChildren,
  summarizeTree,
} from "./tree.js";

const json = async (path: string, value: unknown): Promise<void> => {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const fixture = async (
  build: (root: string) => Promise<void>,
): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "jcr-tree-"));
  await build(root);
  return root;
};

const node = async (
  root: string,
  path: string,
  value: Record<string, unknown> = {},
): Promise<string> => {
  const directory = join(root, ...path.split("/"));
  await mkdir(directory, { recursive: true });
  await json(join(directory, "index.json"), {
    id: path.split("/").at(-1),
    name: path,
    description: `Routes ${path}`,
    ...value,
  });
  return directory;
};

test("reads nodes and mixed node and item children", async () => {
  const root = await fixture(async (directory) => {
    const group = await node(directory, "group");
    await node(directory, "group/provider");
    await json(join(group, "items.json"), [
      {
        id: "direct",
        name: "Direct item",
        description: "Routes a direct item",
        context: "Use the direct item",
      },
    ]);
    await json(join(directory, "group/provider/items.json"), [
      {
        id: "nested",
        name: "Nested item",
        description: "Routes a nested item",
        context: "Use the nested item",
      },
    ]);
  });
  try {
    const groups = await readRootChildren(root);
    assert.deepEqual(
      groups.map((group) => group.id),
      ["group"],
    );
    const children = await readChildren(root, groups[0]!);
    assert.deepEqual(
      children.map((child) => [child.kind, child.path]),
      [
        ["node", "group/provider"],
        ["item", "group/direct"],
      ],
    );
    assert.deepEqual(await summarizeTree(root), {
      groups: 1,
      nodes: 2,
      items: 2,
      maxDepth: 2,
      maxFanOut: 2,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects malformed trees", async (context) => {
  const cases: {
    name: string;
    build: (root: string) => Promise<void>;
    message: RegExp;
  }[] = [
    {
      name: "mismatched node id",
      build: async (root) => {
        const directory = await node(root, "group", { id: "wrong" });
        await json(join(directory, "items.json"), [
          {
            id: "item",
            name: "Item",
            description: "An item",
            context: "Use it",
          },
        ]);
      },
      message: /must equal directory name/,
    },
    {
      name: "missing item field",
      build: async (root) => {
        const directory = await node(root, "group");
        await json(join(directory, "items.json"), [
          { id: "item", name: "Item", description: "An item" },
        ]);
      },
      message: /context must be a non-empty string/,
    },
    {
      name: "duplicate item id",
      build: async (root) => {
        const directory = await node(root, "group");
        await json(
          join(directory, "items.json"),
          ["First", "Second"].map((name) => ({
            id: "same",
            name,
            description: name,
            context: name,
          })),
        );
      },
      message: /duplicate item id/,
    },
    {
      name: "empty node",
      build: async (root) => {
        await node(root, "group");
      },
      message: /has no children/,
    },
    {
      name: "node and item id collision",
      build: async (root) => {
        const directory = await node(root, "group");
        await node(root, "group/same");
        await json(join(root, "group/same/items.json"), [
          {
            id: "leaf",
            name: "Leaf",
            description: "A leaf",
            context: "Use it",
          },
        ]);
        await json(join(directory, "items.json"), [
          {
            id: "same",
            name: "Same",
            description: "A collision",
            context: "Use it",
          },
        ]);
      },
      message: /share id/,
    },
  ];
  for (const candidate of cases) {
    await context.test(candidate.name, async () => {
      const root = await fixture(candidate.build);
      try {
        await assert.rejects(async () => {
          const [group] = await readRootChildren(root);
          if (group) await readChildren(root, group);
        }, candidate.message);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test("loads the migrated capability tree", async () => {
  const root = resolve(process.cwd(), "capabilities");
  const summary = await summarizeTree(root);
  assert.equal(summary.groups, 11);
  assert.ok(summary.nodes >= 39);
  assert.ok(summary.items >= 11_000);
  assert.ok(summary.maxFanOut <= 240);

  const stripe = await readNode(root, "payments-and-finance/stripe/customers");
  const stripeChildren = await readChildren(root, stripe);
  assert.ok(
    stripeChildren.some(
      (child) => child.kind === "item" && child.item.id === "PostCustomers",
    ),
  );

  const slack = await readNode(root, "communication/slack/chat");
  const slackChildren = await readChildren(root, slack);
  assert.ok(
    slackChildren.some(
      (child) => child.kind === "item" && child.item.id === "chat.postMessage",
    ),
  );

  const linear = await readNode(root, "project-management/linear");
  const linearChildren = await readChildren(root, linear);
  assert.ok(
    linearChildren.some(
      (child) => child.kind === "item" && child.item.id === "list_issues",
    ),
  );
});

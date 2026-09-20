import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import { errorMessage } from "../errors.js";
import type {
  CapabilityItem,
  CapabilityNode,
  CapabilityTreeSummary,
  TreeChild,
} from "./types.js";

const nodeFile = "index.json";
const itemsFile = "items.json";
const allowedFiles = new Set([nodeFile, itemsFile]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readJson = async (path: string): Promise<unknown> => {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`${path}: invalid JSON: ${errorMessage(error)}`);
  }
};

const requireString = (
  value: Record<string, unknown>,
  field: string,
  path: string,
): string => {
  const candidate = value[field];
  if (typeof candidate !== "string" || candidate.trim().length === 0) {
    throw new Error(`${path}: ${field} must be a non-empty string`);
  }
  return candidate;
};

const ensureOnlyFields = (
  value: Record<string, unknown>,
  fields: string[],
  path: string,
): void => {
  const allowed = new Set(fields);
  const unexpected = Object.keys(value).filter((field) => !allowed.has(field));
  if (unexpected.length > 0) {
    throw new Error(`${path}: unexpected fields: ${unexpected.join(", ")}`);
  }
};

const normalizedRelativePath = (path: string): string => {
  const parts = path.split("/").filter(Boolean);
  if (
    parts.length === 0 ||
    parts.some(
      (part) =>
        part === "." ||
        part === ".." ||
        part.includes("/") ||
        part.includes("\\"),
    )
  ) {
    throw new Error(`Invalid capability path: ${path}`);
  }
  return parts.join("/");
};

const directoryFor = (root: string, path: string): string => {
  const resolvedRoot = resolve(root);
  const directory = resolve(resolvedRoot, ...path.split("/"));
  if (!directory.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error(`Capability path is outside the tree: ${path}`);
  }
  return directory;
};

const parseNode = (
  value: unknown,
  path: string,
  directory: string,
): CapabilityNode => {
  const file = join(directory, nodeFile);
  if (!isRecord(value)) {
    throw new Error(`${file}: expected an object`);
  }
  ensureOnlyFields(value, ["id", "name", "description"], file);
  const id = requireString(value, "id", file);
  if (id !== basename(directory)) {
    throw new Error(
      `${file}: id "${id}" must equal directory name "${basename(directory)}"`,
    );
  }
  return {
    path,
    directory,
    id,
    name: requireString(value, "name", file),
    description: requireString(value, "description", file),
  };
};

const parseItems = (value: unknown, path: string): CapabilityItem[] => {
  if (!Array.isArray(value)) {
    throw new Error(`${path}: expected an array`);
  }
  const ids = new Set<string>();
  return value.map((candidate, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(candidate)) {
      throw new Error(`${itemPath}: expected an object`);
    }
    ensureOnlyFields(
      candidate,
      ["id", "name", "description", "context"],
      itemPath,
    );
    const item = {
      id: requireString(candidate, "id", itemPath),
      name: requireString(candidate, "name", itemPath),
      description: requireString(candidate, "description", itemPath),
      context: requireString(candidate, "context", itemPath),
    };
    if (item.id.includes("/") || item.id.includes("\\")) {
      throw new Error(`${itemPath}: id cannot contain a path separator`);
    }
    if (ids.has(item.id)) {
      throw new Error(`${path}: duplicate item id "${item.id}"`);
    }
    ids.add(item.id);
    return item;
  });
};

export const readNode = async (
  root: string,
  path: string,
): Promise<CapabilityNode> => {
  const normalizedPath = normalizedRelativePath(path);
  const directory = directoryFor(root, normalizedPath);
  return parseNode(
    await readJson(join(directory, nodeFile)),
    normalizedPath,
    directory,
  );
};

export const readChildren = async (
  root: string,
  node: CapabilityNode,
): Promise<TreeChild[]> => {
  const entries = await readdir(node.directory, { withFileTypes: true });
  const unexpected = entries
    .filter(
      (entry) =>
        !entry.isDirectory() &&
        (!entry.isFile() || !allowedFiles.has(entry.name)),
    )
    .map((entry) => entry.name);
  if (unexpected.length > 0) {
    throw new Error(
      `${node.directory}: unexpected entries: ${unexpected.join(", ")}`,
    );
  }
  const childNodes: Extract<TreeChild, { kind: "node" }>[] = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(async (entry): Promise<Extract<TreeChild, { kind: "node" }>> => {
        const path = `${node.path}/${entry.name}`;
        return {
          kind: "node",
          path,
          node: await readNode(root, path),
        };
      }),
  );
  const itemsEntry = entries.find(
    (entry) => entry.isFile() && entry.name === itemsFile,
  );
  const items = itemsEntry
    ? parseItems(
        await readJson(join(node.directory, itemsFile)),
        join(node.directory, itemsFile),
      )
    : [];
  const childIds = new Set(childNodes.map((child) => child.node.id));
  for (const item of items) {
    if (childIds.has(item.id)) {
      throw new Error(
        `${node.directory}: child node and item share id "${item.id}"`,
      );
    }
    childIds.add(item.id);
  }
  const itemChildren: TreeChild[] = items.map((item) => ({
    kind: "item",
    path: `${node.path}/${item.id}`,
    parent: node,
    item,
  }));
  const children = [...childNodes, ...itemChildren];
  if (children.length === 0) {
    throw new Error(`${node.directory}: capability node has no children`);
  }
  return children;
};

export const readRootChildren = async (
  root: string,
): Promise<CapabilityNode[]> => {
  const directory = resolve(root);
  const entries = await readdir(directory, { withFileTypes: true });
  const unexpected = entries
    .filter((entry) => !entry.isDirectory())
    .map((entry) => entry.name);
  if (unexpected.length > 0) {
    throw new Error(
      `${directory}: capability root may contain only directories: ${unexpected.join(", ")}`,
    );
  }
  const nodes = await Promise.all(
    entries
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => readNode(directory, entry.name)),
  );
  if (nodes.length === 0) {
    throw new Error(`${directory}: capability root has no groups`);
  }
  return nodes;
};

export const summarizeTree = async (
  root: string,
): Promise<CapabilityTreeSummary> => {
  const groups = await readRootChildren(root);
  const summary: CapabilityTreeSummary = {
    groups: groups.length,
    nodes: 0,
    items: 0,
    maxDepth: 0,
    maxFanOut: 0,
  };
  const visit = async (node: CapabilityNode): Promise<void> => {
    const children = await readChildren(root, node);
    summary.nodes += 1;
    summary.items += children.filter((child) => child.kind === "item").length;
    summary.maxDepth = Math.max(summary.maxDepth, node.path.split("/").length);
    summary.maxFanOut = Math.max(summary.maxFanOut, children.length);
    await Promise.all(
      children
        .filter((child) => child.kind === "node")
        .map((child) => visit(child.node)),
    );
  };
  await Promise.all(groups.map(visit));
  return summary;
};

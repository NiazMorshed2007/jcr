import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { repositoryRoot, skillCoverageFile } from "../src/bench/catalog.js";
import { errorMessage } from "../src/errors.js";
import { directChoiceLimit } from "../src/jcr/jev.js";
import { readNode, summarizeTree } from "../src/jcr/tree.js";
import { exitWithError } from "../src/ui/live.js";

type SkillCoverage = {
  skills: Record<string, { integrations: string[] }>;
  excluded: Record<string, { reason: string }>;
};

const skillsDirectory = join(repositoryRoot, ".agents", "skills");
const capabilitiesDirectory = join(repositoryRoot, "capabilities");

const main = async (): Promise<void> => {
  const coverage = JSON.parse(
    await readFile(skillCoverageFile, "utf8"),
  ) as SkillCoverage;
  const installedSkills = (
    await readdir(skillsDirectory, { withFileTypes: true })
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const configuredSkills = new Set([
    ...Object.keys(coverage.skills),
    ...Object.keys(coverage.excluded),
  ]);
  const errors: string[] = [];

  for (const skill of installedSkills) {
    if (!configuredSkills.has(skill))
      errors.push(`${skill}: no coverage entry`);
  }
  for (const skill of configuredSkills) {
    if (!installedSkills.includes(skill)) {
      errors.push(`${skill}: skill not installed`);
    }
  }

  const mappedPaths = new Set<string>();
  for (const [skill, entry] of Object.entries(coverage.skills)) {
    if (entry.integrations.length === 0) {
      errors.push(`${skill}: no capability paths`);
    }
    for (const path of entry.integrations) {
      mappedPaths.add(path);
      try {
        await readNode(capabilitiesDirectory, path);
      } catch {
        errors.push(`${skill}: missing capability node ${path}`);
      }
    }
  }
  for (const [skill, entry] of Object.entries(coverage.excluded)) {
    if (!entry.reason.trim()) errors.push(`${skill}: exclusion has no reason`);
  }

  let summary;
  try {
    summary = await summarizeTree(capabilitiesDirectory);
  } catch (error) {
    errors.push(errorMessage(error));
  }
  if (errors.length > 0 || !summary) {
    throw new Error(`Capability audit failed:\n${errors.join("\n")}`);
  }
  if (summary.maxFanOut > directChoiceLimit) {
    process.stderr.write(
      `Warning: max fan-out ${summary.maxFanOut} exceeds the ${directChoiceLimit}-option direct Choice size\n`,
    );
  }

  process.stdout.write(
    [
      "Capability audit passed",
      `Skills: ${installedSkills.length} (${Object.keys(coverage.skills).length} mapped, ${Object.keys(coverage.excluded).length} excluded)`,
      `Skill-backed nodes: ${mappedPaths.size}`,
      `Tree: ${summary.groups} groups, ${summary.nodes} nodes, ${summary.items.toLocaleString()} items`,
      `Shape: depth ${summary.maxDepth}, max fan-out ${summary.maxFanOut}`,
    ].join("\n") + "\n",
  );
};

main().catch(exitWithError);

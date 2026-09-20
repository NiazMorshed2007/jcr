import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CapabilityMode, Provider } from "../src/harnesses/index.js";
import {
  renderComparison,
  type ComparisonSnapshot,
} from "../src/ui/comparison.js";
import { exitWithError } from "../src/ui/live.js";
import { style } from "../src/ui/terminal.js";

const usage = 'Usage: npm run compare -- <claude|codex> "<prompt>"';
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const runMode = (
  provider: Provider,
  mode: CapabilityMode,
  prompt: string,
  metricsFile: string,
): Promise<ComparisonSnapshot> =>
  new Promise((resolve, reject) => {
    const rule = style.bold("═".repeat(72));
    const title = style.bold(
      `  ${provider.toUpperCase()} · ${mode.toUpperCase()}`,
    );
    process.stdout.write(`\n${rule}\n${title}\n${rule}\n`);
    const child = spawn(
      npm,
      [
        "run",
        provider,
        "--",
        "--mode",
        mode,
        "--prompt",
        prompt,
        "--metrics-file",
        metricsFile,
      ],
      { cwd: process.cwd(), env: process.env, stdio: "inherit" },
    );
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code !== 0) {
        reject(
          new Error(
            signal
              ? `${provider} ${mode} was terminated by ${signal}`
              : `${provider} ${mode} exited with code ${code ?? "unknown"}`,
          ),
        );
        return;
      }
      readFile(metricsFile, "utf8")
        .then((content) => resolve(JSON.parse(content) as ComparisonSnapshot))
        .catch(reject);
    });
  });

const main = async (): Promise<void> => {
  const [provider, ...promptParts] = process.argv.slice(2);
  const prompt = promptParts.join(" ").trim();
  if ((provider !== "claude" && provider !== "codex") || !prompt) {
    throw new Error(usage);
  }
  const metricsDirectory = await mkdtemp(join(tmpdir(), "jcr-compare-"));
  try {
    const skillsRun = await runMode(
      provider,
      "skills",
      prompt,
      join(metricsDirectory, "skills.json"),
    );
    const jcrRun = await runMode(
      provider,
      "jcr",
      prompt,
      join(metricsDirectory, "jcr.json"),
    );
    process.stdout.write(`\n${renderComparison(skillsRun, jcrRun)}\n`);
  } finally {
    await rm(metricsDirectory, { recursive: true, force: true });
  }
};

main().catch(exitWithError);

import { createInterface } from "node:readline/promises";
import { writeFile } from "node:fs/promises";
import { stdin, stdout } from "node:process";
import { config } from "dotenv";
import { createHarness } from "./harnesses/index.js";
import type {
  AgentEvent,
  CapabilityMode,
  Provider,
} from "./harnesses/index.js";
import type { ComparisonSnapshot } from "./ui/comparison.js";
import { renderInitialContext } from "./ui/initial-context.js";
import {
  exitWithError,
  renderLiveMetrics,
  renderResponseHeader,
  renderRunHeader,
  renderStatus,
  renderToolEvent,
} from "./ui/live.js";
import { renderRunSummary } from "./ui/run-summary.js";
import { style, type Styler } from "./ui/terminal.js";

config({ quiet: true });

const defaultModels: Record<Provider, string> = {
  claude: "haiku",
  codex: "gpt-5.6-luna",
};

type CliOptions = {
  provider?: Provider;
  prompt?: string;
  claudeModel?: string;
  codexModel?: string;
  mode?: CapabilityMode;
  metricsFile?: string;
  help: boolean;
};

const help = `Usage:
  npm start -- "<request>"
  npm start -- --provider <claude|codex> --mode <skills|jcr> --prompt "<request>"

Options:
  --provider <claude|codex>  Agent harness; asked interactively when omitted
  --mode <skills|jcr>        Capability discovery mode; asked when omitted
  --prompt <text>            Request sent to the agent (or pipe it on stdin)
  --claude-model <model>     Override the Claude model (CLAUDE_MODEL)
  --codex-model <model>      Override the Codex model (CODEX_MODEL)
  --metrics-file <path>      Write the final run metrics as JSON
  -h, --help                 Show this help

Examples:
  npm start -- "Create a Stripe customer, then post its link in Slack"
  npm run claude:jcr -- --prompt "Refund the duplicate charge pi_123"
  npm run codex -- --mode skills --prompt "Deploy this project to Railway"
  echo "Create a Linear issue for the failing build" | npm run claude:jcr`;

const parseProvider = (value: string): Provider => {
  if (value !== "claude" && value !== "codex") {
    throw new Error("--provider must be claude or codex");
  }
  return value;
};

const parseMode = (value: string, source: string): CapabilityMode => {
  if (value !== "skills" && value !== "jcr") {
    throw new Error(`${source} must be skills or jcr`);
  }
  return value;
};

const parseArgs = (args: string[]): CliOptions => {
  const options: CliOptions = { help: false };
  const positional: string[] = [];
  const valueAfter = (index: number, flag: string): string => {
    const value = args[index + 1];
    if (!value || value.startsWith("-")) {
      throw new Error(`${flag} requires a value`);
    }
    return value;
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    switch (arg) {
      case "-h":
      case "--help":
        options.help = true;
        break;
      case "--provider":
        options.provider = parseProvider(valueAfter(index, arg));
        index += 1;
        break;
      case "--mode":
        options.mode = parseMode(valueAfter(index, arg), arg);
        index += 1;
        break;
      case "--prompt":
        options.prompt = valueAfter(index, arg);
        index += 1;
        break;
      case "--claude-model":
        options.claudeModel = valueAfter(index, arg);
        index += 1;
        break;
      case "--codex-model":
        options.codexModel = valueAfter(index, arg);
        index += 1;
        break;
      case "--metrics-file":
        options.metricsFile = valueAfter(index, arg);
        index += 1;
        break;
      default:
        if (arg.startsWith("-")) {
          throw new Error(`Unknown option: ${arg}`);
        }
        positional.push(arg);
    }
  }

  if (options.prompt && positional.length > 0) {
    throw new Error("Use either --prompt or positional prompt text, not both");
  }
  if (!options.prompt && positional.length > 0) {
    options.prompt = positional.join(" ");
  }
  return options;
};

type PickerChoice<T extends string> = {
  value: T;
  label: string;
  accent: Styler;
};

const pick = async <T extends string>(
  title: string,
  choices: PickerChoice<T>[],
): Promise<T | undefined> => {
  const menu = choices
    .map(
      (choice, index) => `  ${choice.accent(`${index + 1}.`)} ${choice.label}`,
    )
    .join("\n");
  const numbers = choices.map((_, index) => index + 1).join(" or ");
  const names = choices.map((choice) => choice.value).join(", ");
  process.stdout.write(`\n${style.titleCyan(title)}\n\n${menu}\n\n`);
  const readline = createInterface({ input: stdin, output: stdout });
  try {
    while (true) {
      const answer = (
        await readline.question(
          `${style.gray("Select")} ${style.bold(numbers)} ${style.dim("[1]:")} `,
        )
      )
        .trim()
        .toLowerCase();
      if (answer === "q") return undefined;
      const selected =
        choices[answer === "" ? 0 : Number(answer) - 1] ??
        choices.find((choice) => choice.value === answer);
      if (selected) return selected.value;
      process.stdout.write(
        `${style.yellow("!")} Enter ${numbers}, ${names}, or q.\n`,
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("Ctrl+D")) {
      return undefined;
    }
    throw error;
  } finally {
    readline.close();
  }
};

const pickProvider = (models: Record<Provider, string>) =>
  pick<Provider>("Choose an agent", [
    {
      value: "claude",
      label: `Claude  ${style.dim(`(${models.claude})`)}`,
      accent: style.magenta,
    },
    {
      value: "codex",
      label: `Codex   ${style.dim(`(${models.codex})`)}`,
      accent: style.green,
    },
  ]);

const pickMode = () =>
  pick<CapabilityMode>("Choose capability discovery", [
    { value: "skills", label: "Skills", accent: style.cyan },
    {
      value: "jcr",
      label: `JCR ${style.dim("(Jev Capability Resolver)")}`,
      accent: style.magenta,
    },
  ]);

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8").trim();
};

const run = async (): Promise<void> => {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${help}\n`);
    return;
  }

  const prompt = options.prompt ?? (stdin.isTTY ? "" : await readStdin());
  if (!prompt) {
    throw new Error(
      "A request is required. Pass it as text, with --prompt, or on stdin.",
    );
  }
  if (!options.provider && !stdin.isTTY) {
    throw new Error(
      "The agent picker needs a terminal. Use --provider claude or --provider codex.",
    );
  }

  const models: Record<Provider, string> = {
    claude:
      options.claudeModel || process.env.CLAUDE_MODEL || defaultModels.claude,
    codex: options.codexModel || process.env.CODEX_MODEL || defaultModels.codex,
  };
  const provider = options.provider ?? (await pickProvider(models));
  if (!provider) return;

  const configuredMode =
    options.mode ??
    (process.env.AGENT_MODE
      ? parseMode(process.env.AGENT_MODE, "AGENT_MODE")
      : undefined);
  const mode =
    configuredMode ?? (stdin.isTTY ? await pickMode() : undefined) ?? "skills";
  const model = models[provider];

  let lastMetrics = "";
  let runHeaderPrinted = false;
  let responseStarted = false;
  let pendingStatus: string | undefined;
  const printRunHeader = (): void => {
    if (runHeaderPrinted) return;
    runHeaderPrinted = true;
    process.stdout.write(
      `\n${renderRunHeader(provider, model, mode, prompt)}\n`,
    );
  };
  const printPendingStatus = (): void => {
    if (!pendingStatus) return;
    process.stdout.write(`${renderStatus(pendingStatus)}\n`);
    pendingStatus = undefined;
  };

  const result = await createHarness(provider).run({
    prompt,
    model,
    mode,
    workingDirectory: process.cwd(),
    onEvent: (event: AgentEvent) => {
      if (event.type === "context") {
        process.stdout.write(
          `\n${renderInitialContext(event.provider, event.context)}\n`,
        );
        printRunHeader();
        printPendingStatus();
      }

      if (event.type === "status") {
        if (runHeaderPrinted) {
          process.stdout.write(`${renderStatus(event.message)}\n`);
        } else {
          pendingStatus = event.message;
        }
      }

      if (event.type === "text") {
        printRunHeader();
        printPendingStatus();
        if (!responseStarted) {
          responseStarted = true;
          process.stdout.write(`${renderResponseHeader(event.provider)}\n`);
        }
        process.stdout.write(`${event.message}\n`);
      }

      if (event.type === "tool") {
        printRunHeader();
        printPendingStatus();
        process.stdout.write(`${renderToolEvent(event.message)}\n`);
      }

      if (event.type === "metrics") {
        const context = event.metrics.usage?.contextTokens;
        const signature = `${context}:${event.metrics.toolCalls.length}:${event.metrics.modelCalls}`;
        if (signature !== lastMetrics) {
          lastMetrics = signature;
          process.stdout.write(`${renderLiveMetrics(event.metrics)}\n`);
        }
      }
    },
  });

  if (options.metricsFile) {
    const snapshot: ComparisonSnapshot = {
      provider: result.provider,
      ...(result.model ? { model: result.model } : {}),
      metrics: result.metrics,
    };
    await writeFile(
      options.metricsFile,
      `${JSON.stringify(snapshot, null, 2)}\n`,
    );
  }

  process.stdout.write(`\n${renderRunSummary(result)}\n`);
};

run().catch(exitWithError);

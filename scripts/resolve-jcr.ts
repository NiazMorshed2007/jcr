import { resolve } from "node:path";
import { config } from "dotenv";
import { renderAgentOutput } from "../src/jcr/output.js";
import { resolveCapabilities } from "../src/jcr/resolve.js";
import { exitWithError } from "../src/ui/live.js";

config({ quiet: true });

const usage = 'Usage: npm run jcr:resolve -- [--agent-output] "<request>"';

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const agentOutput = args.includes("--agent-output");
  const request = args
    .filter((arg) => arg !== "--agent-output")
    .join(" ")
    .trim();
  if (!request) {
    throw new Error(usage);
  }
  const result = await resolveCapabilities({
    request,
    capabilitiesDirectory: resolve(process.cwd(), "capabilities"),
  });
  const rendered = renderAgentOutput(result.resolution);
  result.metrics.agentOutputChars = rendered.length;
  process.stdout.write(
    agentOutput ? `${rendered}\n` : `${JSON.stringify(result, null, 2)}\n`,
  );
};

main().catch(exitWithError);

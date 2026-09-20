import { appendFile } from "node:fs/promises";
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { renderAgentOutput } from "./output.js";
import { resolveCapabilities } from "./resolve.js";

export type JcrToolOptions = {
  capabilitiesDirectory: string;
  metricsFile?: string;
};

export const handleCapabilityResolution = async (
  request: string,
  options: JcrToolOptions,
): Promise<string> => {
  const result = await resolveCapabilities({
    request,
    capabilitiesDirectory: options.capabilitiesDirectory,
  });
  const output = renderAgentOutput(result.resolution);
  result.metrics.agentOutputChars = output.length;
  if (options.metricsFile) {
    await appendFile(
      options.metricsFile,
      `${JSON.stringify({
        ...result.metrics,
        resolution: result.resolution,
      })}\n`,
      "utf8",
    );
  }
  return output;
};

export const createJcrSdkServer = (
  options: JcrToolOptions,
): McpSdkServerConfigWithInstance =>
  createSdkMcpServer({
    name: "jcr",
    version: "1.0.0",
    instructions:
      "Resolve requests into exact catalog items such as documented commands, procedures, and references. This server never executes them.",
    tools: [
      tool(
        "resolve_capabilities",
        "Resolve a request into minimal context for exact documented capability items. Pass the complete request, including every dependent step.",
        {
          request: z.string().min(1),
        },
        async ({ request }) => ({
          content: [
            {
              type: "text",
              text: await handleCapabilityResolution(request, options),
            },
          ],
        }),
      ),
    ],
  });

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { errorMessage } from "../errors.js";
import { handleCapabilityResolution } from "./tool.js";

const capabilitiesDirectory = process.env.CAPABILITIES_DIRECTORY;
if (!capabilitiesDirectory) {
  throw new Error("CAPABILITIES_DIRECTORY is required");
}

const server = new Server(
  { name: "jcr", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "resolve_capabilities",
      description:
        "Resolve a complete request into minimal context for exact documented capability items such as commands, procedures, and references. It never executes them.",
      inputSchema: {
        type: "object",
        properties: {
          request: {
            type: "string",
            minLength: 1,
            description:
              "The complete user request, including every dependent step",
          },
        },
        required: ["request"],
        additionalProperties: false,
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "resolve_capabilities") {
    return {
      isError: true,
      content: [{ type: "text", text: "Unknown tool" }],
    };
  }
  const value = request.params.arguments?.request;
  if (typeof value !== "string" || value.trim().length === 0) {
    return {
      isError: true,
      content: [{ type: "text", text: "request must be a non-empty string" }],
    };
  }
  try {
    return {
      content: [
        {
          type: "text",
          text: await handleCapabilityResolution(value, {
            capabilitiesDirectory,
            ...(process.env.JCR_METRICS_FILE
              ? { metricsFile: process.env.JCR_METRICS_FILE }
              : {}),
          }),
        },
      ],
    };
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: errorMessage(error),
        },
      ],
    };
  }
});

await server.connect(new StdioServerTransport());

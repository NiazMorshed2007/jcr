import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const configuredRoot = process.env.SKILLS_DIRECTORY;
if (!configuredRoot) {
  throw new Error("SKILLS_DIRECTORY is required");
}

const skillsRoot = resolve(configuredRoot);
const server = new Server(
  { name: "local-skill-loader", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "load_skill",
      description:
        "Load the complete instructions for one installed project skill by its exact name. This tool only reads local SKILL.md files and cannot execute skill operations.",
      inputSchema: {
        type: "object",
        properties: {
          skill: {
            type: "string",
            description: "Exact installed skill name",
          },
        },
        required: ["skill"],
        additionalProperties: false,
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "load_skill") {
    return {
      isError: true,
      content: [{ type: "text", text: "Unknown tool" }],
    };
  }

  const skill = request.params.arguments?.skill;
  if (typeof skill !== "string" || !/^[a-zA-Z0-9._:-]+$/.test(skill)) {
    return {
      isError: true,
      content: [{ type: "text", text: "Invalid skill name" }],
    };
  }

  const skillPath = resolve(skillsRoot, skill, "SKILL.md");
  if (!skillPath.startsWith(`${skillsRoot}${sep}`)) {
    return {
      isError: true,
      content: [{ type: "text", text: "Skill path is outside the catalog" }],
    };
  }

  try {
    const content = await readFile(skillPath, "utf8");
    return {
      content: [{ type: "text", text: content }],
    };
  } catch {
    return {
      isError: true,
      content: [{ type: "text", text: `Skill not found: ${skill}` }],
    };
  }
});

await server.connect(new StdioServerTransport());

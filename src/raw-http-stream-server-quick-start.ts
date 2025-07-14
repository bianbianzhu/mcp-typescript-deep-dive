import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import { randomUUID } from "node:crypto";
import * as z from "zod";

const PORT = 8999;

const app = express();
app.use(express.json());

// 👍 High level server
const server = new McpServer({
  name: "mcp-http-stream",
  version: "1.0.0",
});

server.registerTool(
  "add",
  {
    title: "Addition Tool",
    description: "Add two numbers",
    inputSchema: { a: z.number(), b: z.number() },
  },
  async ({ a, b }) => ({
    content: [{ type: "text", text: String(a + b) }],
  })
);

// 👎Low level server
const low_level_server = new Server({
  name: "mcp-http-stream-low-level",
  version: "1.0.0",
});

low_level_server.setRequestHandler(ListToolsRequestSchema, () => {
  const addToolSchema = z.object({
    a: z.number(),
    b: z.number(),
  });

  const addTool: Tool = {
    name: "add",
    description: "Add two numbers",
    inputSchema: z.toJSONSchema(addToolSchema),
  };

  return {
    tools: [],
  };
});

low_level_server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== "add") {
    return {
      content: [{ type: "text", text: `Tool ${req.params.name} not found` }],
      isError: true,
    };
  }

  const { a, b } = req.params.arguments;
  return {
    content: [{ type: "text", text: String(a + b) }],
  };
});

const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: randomUUID,
});

await low_level_server.connect(transport);

app
  .listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  })
  .on("error", (err) => {
    console.error(err);
    process.exit(1);
  });

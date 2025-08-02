import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTool } from "./tools.js";

export function initServer(options: { authToken: string }): McpServer {
  const { authToken } = options;

  const server = new McpServer({
    name: "notion-mcp-server",
    version: "0.0.1",
  });

  registerTool(server, { authToken });

  return server;
}

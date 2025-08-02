import express from "express";
import { parseArgs } from "./utils.js";
import { initServer } from "./server.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRootRouter } from "./routes/index.js";

/**
 * Reference:
 * https://github.com/bianbianzhu/notion-mcp-server
 */

export async function startMCPServer() {
  const { transportType, port, authToken } = parseArgs();

  if (transportType === "stdio") {
    const server = initServer({ authToken });
    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.log(`${transportType} MCP Server initialized`);
    return server;
  } else if (transportType === "httpstream") {
    if (!authToken) {
      throw new Error(
        "Auth token is required. Obtain a token from https://www.notion.so/my-integrations and set it as an environment variable called NOTION_AUTH_TOKEN or pass it as an argument to the server."
      );
    }

    const app = express();
    app.use(express.json());

    // Root router
    const rootRouter = createRootRouter({ port, authToken });
    app.use("/", rootRouter);

    app.listen(port, () => {
      console.log(`${transportType} MCP Server is running on port ${port}`);
      console.log(`END POINT: http://localhost:${port}/mcp`);
      console.log(`HEALTH CHECK: http://localhost:${port}/health`);
      console.log(`Authentication: Bearer token required`);
    });
  } else {
    throw new Error(`Invalid transport: ${transportType}`);
  }

  return {
    close: () => {},
  };
}

(async () => {
  try {
    await startMCPServer();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
})();

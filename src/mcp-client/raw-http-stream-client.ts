import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const transport = new StreamableHTTPClientTransport(
  new URL("http://localhost:3000")
);

const client = new Client({
  name: "another-client",
  version: "1.0.0",
});

await client.connect(transport);

// List tools
const tools = await client.listTools();

console.log(tools);

// Call a tool
const result = await client.callTool({
  name: "example-tool",
  arguments: {
    arg1: "value",
  },
});

console.log(result);

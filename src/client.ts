import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { URL } from "url";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// Protocol client that maintain 1:1 connection with servers
class MCPClient {
  public get client() {
    return this.#client;
  }

  #client: Client;
  #transport: StreamableHTTPClientTransport | null = null;
  #isCompleted: boolean = false;

  constructor() {
    this.#client = new Client({
      name: `mcp-client`,
      version: "1.0.0",
    });
  }

  async connectToServer(serverUrl: string) {
    const url = new URL(serverUrl);
    try {
      this.#transport = new StreamableHTTPClientTransport(url, {
        requestInit: {
          headers: {
            Authorization: `Bearer 1234567890`,
          },
        },
      });
      await this.#client.connect(this.#transport);
      console.log("Connected to server");

      this.setUpTransport();
    } catch (e) {
      console.log("Failed to connect to MCP server: ", e);
      throw e;
    }
  }

  private setUpTransport() {
    if (this.#transport === null) {
      return;
    }
    this.#transport.onclose = () => {
      console.log("transport closed.");
      this.#isCompleted = true;
    };

    this.#transport.onerror = async (error) => {
      console.log("transport error: ", error);
      await this.cleanup();
    };

    this.#transport.onmessage = (message) => {
      console.log("message received: ", message);
    };
  }

  async waitForCompletion() {
    while (!this.#isCompleted) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  async cleanup() {
    await this.#client.close();
  }
}

async function main() {
  const client = new MCPClient();

  try {
    await client.connectToServer("http://localhost:8080/mcp");

    const result = await client.client.listTools();
    console.log(result);

    // await client.waitForCompletion();
  } finally {
    await client.cleanup();
  }
}

main();

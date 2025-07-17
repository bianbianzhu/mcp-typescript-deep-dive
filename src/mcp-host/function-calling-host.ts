import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import {
  MessageParam,
  Tool as AnthropicTool,
} from "@anthropic-ai/sdk/resources";
import readline from "readline";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  CallToolRequest,
  CallToolRequestSchema,
  Tool as ModelContextProtocolTool,
  TextContent,
} from "@modelcontextprotocol/sdk/types.js";

type TransportType = "stdio" | "httpStream";

// 1. client
class MCPClient<T extends TransportType = TransportType> {
  public get client() {
    return this.#client;
  }

  #client: Client;
  #transportType: T;
  #transport: StreamableHTTPClientTransport | StdioClientTransport | null =
    null;

  constructor({ transportType }: { transportType: T }) {
    this.#client = new Client({
      name: "mcp-client",
      version: "1.0.0",
    });
    this.#transportType = transportType;
  }

  async connectToServer(
    ...args: T extends "httpStream" ? [serverUrl: string] : []
  ) {
    if (this.#transportType === "httpStream") {
      const serverUrl = args[0];

      if (!serverUrl) {
        throw new Error("serverUrl is required for httpStream transport");
      }

      const url = new URL(serverUrl);

      try {
        this.#transport = new StreamableHTTPClientTransport(url, {
          requestInit: {
            headers: {
              // for authentication - the fastmcp server example (index.ts)
              ["x-api-key"]: `Bearer 1234567890`,
            },
          },
        });

        await this.#client.connect(this.#transport, {
          timeout: 10000000,
        });

        console.log(
          `Connected to server via httpStream transport; transport session id: ${this.#transport.sessionId}`
        );
      } catch (error) {
        console.log("Failed to connect to MCP server via httpStream: ", error);
        throw error;
      }
    } else {
      try {
        this.#transport = new StdioClientTransport({
          command: "npx",
          // fastmcp server example (index.ts)
          args: ["tsx", "src/mcp-servers/fastmcp-stdio-server.ts"],
        });

        await this.#client.connect(this.#transport);
      } catch (error) {
        console.log("Failed to connect to MCP server via stdio: ", error);
        throw error;
      }
    }
  }

  async cleanup() {
    await this.#client.close();
  }
}

// 2. host - stdio interface
const PORT = process.env.PORT ?? 8080;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const anthropic = new Anthropic();

const client1 = new MCPClient({ transportType: "httpStream" });

await client1.connectToServer(`http://localhost:${PORT}/mcp`);

const { tools: modelContextProtocolToolsHttpStream } =
  await client1.client.listTools(); // returns { tools: [@modelcontextprotocol tool definitions] }

const client2 = new MCPClient({ transportType: "stdio" });

await client2.connectToServer();

const { tools: modelContextProtocolToolsStdio } =
  await client2.client.listTools(); // returns { tools: [@modelcontextprotocol tool definitions] }

const toolsPerClient = {
  ["1"]: { tools: modelContextProtocolToolsHttpStream, client: client1 },
  ["2"]: { tools: modelContextProtocolToolsStdio, client: client2 },
} as const;

const tools = convertModelContextProtocolToolsToAnthropicTools([
  ...modelContextProtocolToolsHttpStream,
  ...modelContextProtocolToolsStdio,
]);

const messageHistory: MessageParam[] = [];

rl.setPrompt("user: ");
rl.prompt();

rl.on("line", async (line) => {
  if (line === "stop") {
    await shutdown();
    return;
  }

  const userMessage: MessageParam = {
    role: "user",
    content: line,
  };

  messageHistory.push(userMessage);

  const response = await createMessage({
    messages: messageHistory,
    tools,
  });

  // messageHistory.push(response); // Error: id is not permitted in the messages

  const aiMessage: MessageParam = {
    role: response.role,
    content: response.content,
  };

  messageHistory.push(aiMessage);

  const displayContent = response.content.filter(
    (item) => item.type === "text"
  );

  for (const content of displayContent) {
    console.log(`Assistant: ${content.text}`);
  }

  // if there's at least one tool call in the content, the stop_reason is "tool_use"
  if (response.stop_reason === "tool_use") {
    const toolCalls = response.content.filter(
      (item) => item.type === "tool_use"
    );

    for (const toolCall of toolCalls) {
      const { name, input } = toolCall;

      if (!isValidCallToolRequestArguments(input)) {
        console.log("Invalid tool call arguments");
        continue;
      }

      console.log(
        "Requesting the permission to call the tool:",
        name,
        input,
        "[y/n]"
      );

      const answer = await new Promise<string>((resolve) => {
        rl.question("> ", (answer) => {
          resolve(answer);
        });
      });

      if (answer === "y") {
        const client = getClientForTool(name);

        if (!client) {
          console.log(
            `No client found for the tool; tool name: ${name}; skipping the tool call`
          );
          continue;
        }

        const toolResult = await client.client.callTool({
          name,
          arguments: input,
        });
        console.log("Tool result: ", toolResult);

        if (toolResult.isError) {
          console.log("Tool call failed");
          continue;
        }

        const { content } = toolResult;

        // check if the toolResult's content is a non-empty array
        if (!Array.isArray(content) || content.length === 0) {
          console.log("Tool call result content validation failed");
          continue;
        }

        // filter out the content that is not a text
        const textContents = content.filter(
          (item) => item.type === "text"
        ) as TextContent[];

        if (textContents.length === 0) {
          console.log("No text content in the tool call result");
          continue;
        }

        const toolResultMessage: MessageParam = {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: toolCall.id,
              content: textContents[0].text ?? "Failed to call the tool",
            },
          ],
        };

        messageHistory.push(toolResultMessage);

        // resend the message history with the tool result to the assistant
        // We assume that the assistant will give the final answer (without any tool calls)
        const response = await createMessage({
          messages: messageHistory,
          tools,
        });

        const aiMessages: MessageParam[] = response.content
          .filter((item) => item.type === "text")
          .map((item) => ({
            role: "assistant",
            content: item.text,
          }));

        messageHistory.push(...aiMessages);

        for (const aiMessage of aiMessages) {
          console.log(`Assistant: ${aiMessage.content}`);
        }
      } else {
        console.log("Tool call rejected");
        continue;
      }
    }
  }

  // console.log(JSON.stringify(messageHistory, null, 2));

  rl.prompt();
});

async function shutdown() {
  try {
    rl.close();

    await Promise.all([client1.cleanup(), client2.cleanup()]);

    console.log("Cleanup completed");
  } catch (error) {
    console.error("Error during shutdown:", error);
  }
}

const signals = ["SIGINT", "SIGTERM", "SIGHUP", "SIGTSTP"];
signals.forEach((signal) => {
  process.on(signal, async () => {
    console.log(`\n${signal} received. Shutting down gracefully...`);

    await shutdown();
  });
});

async function createMessage({
  messages,
  tools,
}: {
  messages: MessageParam[];
  tools?: AnthropicTool[];
}) {
  const response = await anthropic.messages.create({
    model: "claude-3-5-sonnet-20240620",
    messages,
    max_tokens: 1000,
    temperature: 0.5,
    system: "You are a helpful assistant.",
    tools,
  });

  return response;
}

function convertModelContextProtocolToolsToAnthropicTools(
  tools: ModelContextProtocolTool[]
): AnthropicTool[] {
  const anthropicTools: AnthropicTool[] = [];

  for (const tool of tools) {
    anthropicTools.push({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    });
  }

  return anthropicTools;
}

/**
 * To validate if the input is a valid call tool request arguments according to @modelcontextprotocol
 */
function isValidCallToolRequestArguments(
  input: unknown
): input is CallToolRequest["params"]["arguments"] {
  return CallToolRequestSchema.shape.params.shape.arguments.safeParse(input)
    .success;
}

function getClientForTool(toolName: string) {
  for (const { tools, client } of Object.values(toolsPerClient)) {
    if (tools.some((tool) => tool.name === toolName)) {
      return client;
    }
  }

  return null;
}

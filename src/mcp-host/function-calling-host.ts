import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import {
  MessageParam,
  Tool as AnthropicTool,
  ToolResultBlockParam,
} from "@anthropic-ai/sdk/resources";
import readline from "readline";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  CallToolResultSchema,
  CallToolRequest,
  CallToolRequestSchema,
  Tool as ModelContextProtocolTool,
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

const anthropic = new Anthropic();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

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

    const toolResultMessage: {
      role: "user";
      content: ToolResultBlockParam[];
    } = {
      role: "user",
      content: [],
    };

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
          console.error(
            `No client found for the tool; tool name: ${name}; skipping the tool call`
          );

          const toolResultContent: ToolResultBlockParam = {
            type: "tool_result",
            tool_use_id: toolCall.id,
            content: `Tool call failed: No MCP client found for the tool; tool name: ${name}; skipping the tool call`,
            is_error: true,
          };
          toolResultMessage.content.push(toolResultContent);

          continue;
        }

        const toolResult = await client.client.callTool({
          name,
          arguments: input,
        });
        console.log("Tool result: ", toolResult);

        const parsedToolResult = CallToolResultSchema.safeParse(toolResult);

        if (!parsedToolResult.success) {
          console.error("Tool call result validation failed");

          const toolResultContent: ToolResultBlockParam = {
            type: "tool_result",
            tool_use_id: toolCall.id,
            content: `Tool call result validation failed: ${parsedToolResult.error.message}`,
            is_error: true,
          };
          toolResultMessage.content.push(toolResultContent);

          continue;
        }

        const { isError, content } = parsedToolResult.data;

        if (isError) {
          console.error("Tool call failed");
          // content will be an error message
        }

        // filter out the content that is not a text (TODO: handle other types of content)
        const textContents = content.filter((item) => item.type === "text");

        if (textContents.length === 0) {
          console.error("No text content in the tool call result");

          const toolResultContent: ToolResultBlockParam = {
            type: "tool_result",
            tool_use_id: toolCall.id,
            content: `Tool call failed: No text content in the tool call result; The host does not support other types of content yet.`,
            is_error: true,
          };
          toolResultMessage.content.push(toolResultContent);
          continue;
        }

        const toolResultContent: ToolResultBlockParam = {
          type: "tool_result",
          tool_use_id: toolCall.id,
          content: textContents ?? "Failed to call the tool",
          is_error: isError,
        };

        toolResultMessage.content.push(toolResultContent);
      } else {
        console.warn("Tool call rejected by the user");

        const toolResultContent: ToolResultBlockParam = {
          type: "tool_result",
          tool_use_id: toolCall.id,
          content: `Tool call rejected by the user. The user does not want to call the tool. Use your own knowledge to answer the question. If you cannot answer the question, just say "I don't know"`,
          is_error: false,
        };

        toolResultMessage.content.push(toolResultContent);
        continue;
      }
    }

    messageHistory.push(toolResultMessage);

    // resend the message history with the tool result to the assistant
    // We assume that the assistant will give the final answer (without any tool calls)
    const followUpResponse = await createMessage({
      messages: messageHistory,
      tools,
    });

    const aiMessages: MessageParam[] = followUpResponse.content
      .filter((item) => item.type === "text")
      .map((item) => ({
        role: "assistant",
        content: item.text,
      }));

    messageHistory.push(...aiMessages);

    for (const aiMessage of aiMessages) {
      console.log(`Assistant: ${aiMessage.content}`);
    }
  }

  console.log(JSON.stringify(messageHistory, null, 2));

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

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import {
  MessageParam,
  Tool as AnthropicTool,
  ToolResultBlockParam,
  Message,
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
          args: ["tsx", "src/mcp-servers/low-level-file-system.ts"],
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

  try {
    await processMessage(line);
  } catch (error) {
    console.error("Error processing message:", error);
  }

  console.log(JSON.stringify(messageHistory, null, 2));
  rl.prompt();
});

const signals = ["SIGINT", "SIGTERM", "SIGHUP", "SIGTSTP"];
signals.forEach((signal) => {
  process.on(signal, async () => {
    console.log(`\n${signal} received. Shutting down gracefully...`);

    await shutdown();
  });
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

/**
 * Extract tool processing logic into a reusable function
 * This function processes all tool calls in a response and returns the tool result message
 */
async function processToolCalls(response: Message): Promise<{
  role: "user";
  content: ToolResultBlockParam[];
}> {
  const toolCalls = response.content.filter((item) => item.type === "tool_use");

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

      const toolResultContent: ToolResultBlockParam = {
        type: "tool_result",
        tool_use_id: toolCall.id,
        content: `Invalid tool call arguments: ${JSON.stringify(input)}`,
        is_error: true,
      };
      toolResultMessage.content.push(toolResultContent);

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
          content: `No text content in the tool call result; The tool call may be correct, but the tool call result is not a text. Currently, the host cannot handle other types, like image, audio, etc; Only text content is supported.`,
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

  return toolResultMessage;
}

/**
 * Display text content from a response
 */
function displayTextContent(response: Anthropic.Messages.Message): void {
  const displayContent = response.content.filter(
    (item) => item.type === "text"
  );

  for (const content of displayContent) {
    console.log(`Assistant: ${content.text}`);
  }
}

/**
 * Main message processing function with tool execution loop
 */
async function processMessage(userInput: string): Promise<void> {
  const userMessage: MessageParam = {
    role: "user",
    content: userInput,
  };

  messageHistory.push(userMessage);

  // Get initial response
  let currentResponse = await createMessage({
    messages: messageHistory,
    tools,
  });

  // Add initial AI message to history (removes response.id)
  const aiMessage: MessageParam = {
    role: currentResponse.role,
    content: currentResponse.content,
  };

  messageHistory.push(aiMessage);

  // Display initial text content
  displayTextContent(currentResponse);

  // Main processing loop - continues until stop_reason is not "tool_use"
  let iterationCount = 0;
  const maxIterations = 5; // Safety measure to prevent infinite loops

  while (
    currentResponse.stop_reason === "tool_use" &&
    iterationCount < maxIterations
  ) {
    console.log(`\n--- Tool execution round ${iterationCount + 1} ---`);

    // Process tool calls using the extracted function
    const toolResultMessage = await processToolCalls(currentResponse);

    // Add tool results to message history
    messageHistory.push(toolResultMessage);

    // Get next response from the assistant
    currentResponse = await createMessage({
      messages: messageHistory,
      tools,
    });

    // Add the new AI response to history
    const nextAiMessage: MessageParam = {
      role: currentResponse.role,
      content: currentResponse.content,
    };

    messageHistory.push(nextAiMessage);

    // Display the text content from this round
    displayTextContent(currentResponse);

    iterationCount++;
  }

  // Check if we hit the iteration limit
  if (iterationCount >= maxIterations) {
    console.warn(
      `\n⚠️  Maximum iterations (${maxIterations}) reached. Stopping tool execution loop.`
    );
  }

  // Final processing complete
  console.log(
    `\n✅ Processing complete after ${iterationCount} tool execution rounds.`
  );
}

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

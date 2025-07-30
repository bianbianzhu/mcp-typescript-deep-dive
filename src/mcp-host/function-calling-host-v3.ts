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
import { z } from "zod";
import path from "path";
import fs from "fs";

type TransportType = "stdio" | "httpStream";

const httpStream_args_schema = z.object({
  url: z
    .string()
    .url({
      message: "httpStream needs a valid URL; did you provide a folder path?",
    })
    .describe("The server URL for the httpStream transport."),
  headers: z
    .record(z.string(), z.string())
    .optional()
    .describe("The headers to send to the server."),
});
const stdio_args_schema = z.object({
  command: z.string().describe("The command to run the MCP server."),
  args: z.array(z.string()).describe("The arguments to run the MCP server."),
});

const argsSchema = {
  httpStream: httpStream_args_schema,
  stdio: stdio_args_schema,
} satisfies Record<TransportType, z.ZodType>;

const configSchema = z.object({
  mcpServers: z.record(
    z.string(),
    z.union([
      z.object({
        url: z.string().url(),
        headers: z.record(z.string(), z.string()).optional(),
      }),
      z.object({
        command: z.string(),
        args: z.array(z.string()),
      }),
    ])
  ),
});

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
    ...args: T extends "httpStream"
      ? [
          {
            url: string;
            headers?: Record<string, string>;
          },
        ]
      : [
          {
            command: string;
            args: string[];
          },
        ]
  ) {
    if (!args[0]) {
      throw new Error(
        `No arguments provided for the ${this.#transportType} transport`
      );
    }

    const parsedArgs = argsSchema[this.#transportType].safeParse(args[0]);

    if (!parsedArgs.success) {
      throw new Error(parsedArgs.error.message);
    }

    if (this.#transportType === "httpStream") {
      const { url, headers } = parsedArgs.data as z.infer<
        typeof httpStream_args_schema
      >;

      const urlObject = new URL(url);

      try {
        this.#transport = new StreamableHTTPClientTransport(urlObject, {
          requestInit: {
            headers: {
              // for authentication - the fastmcp server example (index.ts)
              ["x-api-key"]: `Bearer 1234567890`,
              ...headers,
            },
          },
        });

        await this.#client.connect(this.#transport, {
          timeout: 1000,
        });

        console.log(
          `Connected to server via httpStream transport; transport session id: ${this.#transport.sessionId}`
        );
      } catch (error) {
        console.log("Failed to connect to MCP server via httpStream: ", error);
        throw error;
      }
    } else {
      const { command, args } = parsedArgs.data as z.infer<
        typeof stdio_args_schema
      >;

      try {
        this.#transport = new StdioClientTransport({
          command,
          args,
        });

        await this.#client.connect(this.#transport);

        console.log(`Connected to server via stdio transport`);
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
const CONFIG_FILE_NAME = "mcp-v3.json";

const { clients, serverNames, mcpTools, getClientForTool } =
  await connectToMCPServers({
    configFileName: CONFIG_FILE_NAME,
  });

const tools = convertModelContextProtocolToolsToAnthropicTools(mcpTools);

const anthropic = new Anthropic();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const messageHistory: MessageParam[] = [];
const serverInfoMessage: MessageParam = {
  role: "user",
  content: `Currently, you are connected to the following MCP servers: ${Array.from(serverNames).join(", ")}.`,
};
messageHistory.push(serverInfoMessage);

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

    const clientsToCleanup = Array.from(clients.values());
    const promises = clientsToCleanup.map((client) => client.cleanup());

    await Promise.all(promises);

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
      `Requesting the permission to call the tool${
        isDestructiveTool(name, mcpTools)
          ? "; ❌❌❌This cannot be undone❌❌❌"
          : ""
      }:`,
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
    model: "claude-4-sonnet-20250514",
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

function loadMCPConfig(configFileName: string) {
  const mcpConfig = fs.readFileSync(
    // for ESM modules, we need to use import.meta.dirname to get the directory name
    path.join(import.meta.dirname, configFileName),
    "utf8"
  );

  const parsedConfig = configSchema.safeParse(JSON.parse(mcpConfig));

  if (!parsedConfig.success) {
    throw new Error(`Invalid MCP config: ${parsedConfig.error.message}`);
  }

  const { mcpServers } = parsedConfig.data;

  return mcpServers;
}

async function connectToMCPServers({
  configFileName,
}: {
  configFileName: string;
}) {
  const mcpServers = loadMCPConfig(configFileName);

  const clients = new Map<string, MCPClient>();
  const serverNames = new Set<string>();
  const toolsPerClient = new Map<string, ModelContextProtocolTool[]>();

  for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
    try {
      let client: MCPClient;

      if (isHttpStreamServerConfig(serverConfig)) {
        client = new MCPClient({ transportType: "httpStream" });
        await client.connectToServer(serverConfig);
      } else {
        client = new MCPClient({ transportType: "stdio" });
        await client.connectToServer(serverConfig);
      }

      // store client and server name
      clients.set(serverName, client);
      serverNames.add(serverName);

      // list tools for the server
      try {
        const { tools } = await client.client.listTools();
        toolsPerClient.set(serverName, tools);
      } catch (error) {
        console.error(
          `Failed to list tools for MCP server ${serverName}: ${error}`
        );
        toolsPerClient.set(serverName, []);
      }
    } catch (error) {
      console.error(`Failed to connect to MCP server ${serverName}: ${error}`);
    }
  }

  const mcpTools = Array.from(toolsPerClient.values()).flat(1);

  function getClientForTool(toolName: string): MCPClient | null {
    for (const [serverName, tools] of toolsPerClient.entries()) {
      if (tools.some((tool) => tool.name === toolName)) {
        return clients.get(serverName) ?? null;
      }
    }

    return null;
  }

  return {
    serverNames,
    toolsPerClient,
    clients,
    mcpTools,
    getClientForTool,
  };
}

function isHttpStreamServerConfig(
  serverConfig: z.infer<typeof configSchema>["mcpServers"][string]
): serverConfig is z.infer<typeof httpStream_args_schema> {
  return "url" in serverConfig && !("command" in serverConfig);
}

function isDestructiveTool(
  toolName: string,
  tools: ModelContextProtocolTool[]
): boolean {
  const tool = tools.find((tool) => tool.name === toolName);

  if (!tool) {
    return false;
  }

  return tool.annotations?.destructiveHint ?? false;
}

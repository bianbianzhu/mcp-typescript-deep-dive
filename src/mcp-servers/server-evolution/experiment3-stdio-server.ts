import {
  isInitializeRequest,
  isJSONRPCNotification,
  isJSONRPCRequest,
  JSONRPCMessage,
  JSONRPCMessageSchema,
  JSONRPCResponse,
  JSONRPCRequest,
  ListToolsRequestSchema,
  CallToolRequestSchema,
  InitializeRequestSchema,
  JSONRPCError,
  InitializedNotificationSchema,
  isInitializedNotification,
  InitializeResult,
} from "@modelcontextprotocol/sdk/types.js";
import { Readable, Writable } from "node:stream";
import { once } from "node:events";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

// ⚠️⚠️⚠️⚠️⚠️ 搭配 client-evolution/experiment3-raw-stdio-client.ts 使用 ⚠️⚠️⚠️⚠️⚠️

class StdioServerTransport {
  #_readBuffer: ReadBuffer = new ReadBuffer();
  #_start: boolean = false;
  #_stdin: Readable;
  #_stdout: Writable;

  constructor() {
    this.#_stdin = process.stdin;
    this.#_stdout = process.stdout;
  }

  onMessage?: (message: JSONRPCMessage) => void;
  onClose?: () => void;
  onError?: (error: Error) => void;

  async start(): Promise<void> {
    if (this.#_start) {
      throw new Error("Server is already started");
    }

    this.#_start = true;

    this.#_stdin.on("data", (buf) => {
      this.#_readBuffer.append(buf);

      while (true) {
        const message = this.#_readBuffer.readMessage();
        if (!message) {
          break;
        }

        this.onMessage?.(message);
      }
    });

    this.#_stdin.on("error", (error) => {
      this.onError?.(error);
    });
  }

  async close(): Promise<void> {
    this.#_readBuffer.clear();

    this.onClose?.();
  }

  async send(message: JSONRPCMessage): Promise<void> {
    const json = JSON.stringify(message) + "\n";

    const canWrite = this.#_stdout.write(json);

    if (!canWrite) {
      await once(this.#_stdout, "drain");
    }
  }
}

class ReadBuffer {
  #_buffer?: Buffer;

  append(data: Buffer): void {
    this.#_buffer = this.#_buffer ? Buffer.concat([this.#_buffer, data]) : data;
  }

  readMessage(): JSONRPCMessage | null {
    if (!this.#_buffer) {
      return null;
    }

    const index = this.#_buffer.indexOf("\n");
    if (index === -1) {
      return null;
    }

    const line = this.#_buffer.toString("utf-8", 0, index).replace(/\r$/, "");
    this.#_buffer = this.#_buffer.subarray(index + 1);

    const message = JSON.parse(line);

    const parsed = JSONRPCMessageSchema.safeParse(message);
    if (!parsed.success) {
      return null;
    }

    return parsed.data;
  }

  clear(): void {
    this.#_buffer = undefined;
  }
}

type ServerInfo = {
  name: string;
  version: string;
  title?: string;
};

type ServerOptions = {
  capabilities: {
    tools: Record<string, unknown>;
  };
};

class Server {
  #_transport?:
    | StdioServerTransport
    | StreamableHTTPClientTransport
    | SSEClientTransport;
  #_serverInfo: ServerInfo;
  #_options: ServerOptions;
  #_requestHandlers: Map<
    string,
    (request: JSONRPCRequest) => any | Promise<any>
  > = new Map();

  constructor(serverInfo: ServerInfo, options: ServerOptions) {
    this.#_serverInfo = serverInfo;
    this.#_options = options;
    this.setRequestHandler(InitializeRequestSchema, (request) => {
      if (!isInitializeRequest(request)) {
        const error: JSONRPCError = {
          jsonrpc: "2.0",
          id: request.id ?? 99,
          error: {
            code: -32601,
            message: `Method ${request.method} not found`,
          },
        };
        return error;
      }

      const metaData: InitializeResult = {
        serverInfo: this.#_serverInfo,
        ...this.#_options,
        protocolVersion: "2025-06-18",
      };

      const result: JSONRPCResponse = {
        jsonrpc: "2.0",
        id: request.id ?? 99,
        result: metaData,
      };

      return result;
    });

    this.setRequestHandler(InitializedNotificationSchema, (request) => {
      if (isInitializedNotification(request)) {
        return;
      }
    });
  }

  async connect(
    transport:
      | StdioServerTransport
      | StreamableHTTPClientTransport
      | SSEClientTransport
  ): Promise<void> {
    if (
      transport instanceof StreamableHTTPClientTransport ||
      transport instanceof SSEClientTransport
    ) {
      throw new Error(
        "Sorry, we don't support this transport yet. Please use StdioServerTransport instead."
      );
    }

    this.#_transport = transport;

    this.#_transport.onMessage = async (message) => {
      if (isJSONRPCNotification(message)) {
        return;
      }

      // 判断是否是JSONRPCRequest （JSONRPCMessageSchema 包括了JSONRPCRequest, JSONRPCNotification, JSONRPCResponse, JSONRPCError）
      if (isJSONRPCRequest(message)) {
        // 通过传进来的message的方法名，从Map中获取处理函数
        const handler = this.#_requestHandlers.get(message.method);
        if (handler) {
          // 调用处理函数，并返回响应
          const response = await handler(message);
          // 通过process.stdout发送响应
          this.#_transport?.send(response);
        } else {
          // 如果方法名对应的处理函数不存在，则发送错误响应
          this.#_transport?.send({
            jsonrpc: "2.0",
            id: message.id,
            error: {
              code: -32601,
              message: `Method ${message.method} not found`,
            },
          });
        }
      }
    };

    await this.#_transport?.start();
  }

  setRequestHandler(
    requestSchema:
      | typeof ListToolsRequestSchema
      | typeof CallToolRequestSchema
      | typeof InitializeRequestSchema
      | typeof InitializedNotificationSchema,
    handler: (request: JSONRPCRequest) => any | Promise<any>
  ): void {
    // 获取方法名
    const method = requestSchema.shape.method.value;

    // 检查是否支持该方法
    this.#assertRequestHandlerCapabilities(method);

    // 将方法名和处理函数绑定并存储在 Map 中
    this.#_requestHandlers.set(method, handler);
  }

  #assertRequestHandlerCapabilities(method: string): void {
    if (method === "tools/list" || method === "tools/call") {
      if (!this.#_options.capabilities.tools) {
        throw new Error("tools/list and tools/call are not supported");
      }
    }
  }

  get transport():
    | StdioServerTransport
    | StreamableHTTPClientTransport
    | SSEClientTransport
    | undefined {
    return this.#_transport;
  }
}

const server = new Server(
  {
    name: "evolution-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const test_experiment_3_inputSchema = z.object({
  text: z.string(),
});

const add_inputSchema = z.object({ a: z.number(), b: z.number() });

server.setRequestHandler(ListToolsRequestSchema, async (request) => {
  const tools = [
    {
      name: "test_experiment_3",
      description: "test_experiment_3",
      inputSchema: zodToJsonSchema(test_experiment_3_inputSchema),
    },
    {
      name: "add",
      description: "add two numbers",
      inputSchema: zodToJsonSchema(add_inputSchema),
    },
  ];

  const result: JSONRPCResponse = {
    jsonrpc: "2.0",
    id: request.id ?? 99,
    result: {
      tools,
    },
  };

  return result;
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params ?? {};

  if (name === "test_experiment_3") {
    const parsed = test_experiment_3_inputSchema.safeParse(args);
    if (!parsed.success) {
      throw new Error(
        `Invalid arguments for test_experiment_3: ${parsed.error}`
      );
    }

    const result: JSONRPCResponse = {
      jsonrpc: "2.0",
      id: request.id ?? 99,
      result: {
        content: [{ type: "text", text: "Experiment 3 success" }],
        isError: false,
      },
    };

    return result;
  }

  if (name === "add") {
    const parsed = add_inputSchema.safeParse(args);
    if (!parsed.success) {
      throw new Error(`Invalid arguments for add: ${parsed.error}`);
    }

    const { a, b } = parsed.data;

    const result: JSONRPCResponse = {
      jsonrpc: "2.0",
      id: request.id ?? 99,
      result: {
        content: [{ type: "text", text: `Add success: ${a + b}` }],
        isError: false,
      },
    };

    return result;
  }

  const notFoundError: JSONRPCError = {
    jsonrpc: "2.0",
    id: request.id ?? null,
    error: {
      code: -32601,
      message: `Method ${name} not found`,
    },
  };

  return notFoundError;
});

const transport = new StdioServerTransport();
await server.connect(transport);

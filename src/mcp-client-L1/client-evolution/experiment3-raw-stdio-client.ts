import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { z } from "zod";

const jsonrpcSchemaBase = z.object({
  jsonrpc: z.literal("2.0"),
});

const jsonrpcSchemaRequest = jsonrpcSchemaBase.extend({
  method: z.string().refine((val) => !/^rpc\./i.test(val), {
    message: "Method name cannot start with 'rpc.', ignore case",
  }),
  params: z.unknown().optional(), // params is optional - request with/without params. Params will be ignored for notification.
  id: z.union([z.number(), z.string().min(1)]).optional(), // when id is not provided, it is a notification
});

type JsonRpcRequest<T extends z.ZodTypeAny = z.ZodUnknown> = z.infer<
  typeof jsonrpcSchemaRequest
> & {
  params?: z.infer<T>;
};

const jsonrpcSchemaNotification = jsonrpcSchemaRequest.omit({
  id: true,
  params: true,
});

type NotificationRequest = z.infer<typeof jsonrpcSchemaNotification>;

const paramsSchemaBase = z.object({
  protocolVersion: z.enum(
    ["2025-06-18", "2025-03-26", "2024-11-05", "2024-10-07"],
    {
      message:
        "Unsupported protocol version (supported versions: 2025-06-18, 2025-03-26, 2024-11-05, 2024-10-07)",
    }
  ),
  capabilities: z.object({}).passthrough(),
});

const initializeRequestParamsSchema = paramsSchemaBase.extend({
  clientInfo: z.object({
    name: z.string(),
    version: z.string(),
  }),
});

const toolsCallRequestParamsSchema = z.object({
  name: z.string().min(1),
  arguments: z.object({}).passthrough(),
});

// success response
const jsonrpcSchemaResponse = jsonrpcSchemaBase.extend({
  result: z.unknown(),
  id: z.union([z.number(), z.string().min(1)]),
});

type SuccessResponse<T extends z.ZodTypeAny = z.ZodUnknown> = z.infer<
  typeof jsonrpcSchemaResponse
> & {
  result: z.infer<T>;
};

const jsonrpcSchemaError = jsonrpcSchemaBase.extend({
  error: z.object({
    code: z.number(),
    message: z.string(),
    data: z.unknown().optional(),
  }),
  id: z.union([z.number(), z.string().min(1)]).nullable(),
});

type ErrorResponse = z.infer<typeof jsonrpcSchemaError>;

const initializeResponseResultSchema = paramsSchemaBase.extend({
  serverInfo: z.object({
    name: z.string(),
    version: z.string(),
  }),
});

const toolSchema = z
  .object({
    name: z.string(),
    description: z.string(),
    inputSchema: z.object({
      type: z.literal("object"),
      properties: z.record(
        z.string(),
        z.object({
          type: z.string(),
          description: z.string(),
        })
      ),
      required: z.array(z.string()),
      additionalProperties: z.boolean().optional(),
    }),
  })
  .passthrough();

const toolsListResponseResultSchema = z.object({
  tools: z.array(toolSchema),
});

//========================= Actual client code ========================

// 1. prepare all the jsonrpc request data
// 1.1 initialize
const initializeRequest: JsonRpcRequest<typeof initializeRequestParamsSchema> =
  {
    jsonrpc: "2.0",
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: {
        name: "mcp-client",
        version: "1.0.0",
      },
    },
    id: 0,
  };

// 1.2 notification/initialized
const initializedNotification: NotificationRequest = {
  jsonrpc: "2.0",
  method: "notification/initialized",
};

// 1.3 tools/list
const toolsListRequest: JsonRpcRequest = {
  jsonrpc: "2.0",
  method: "tools/list",
  id: 1,
};

// 1.4 tools/call
const _toolsCallRequest: JsonRpcRequest<typeof toolsCallRequestParamsSchema> = {
  jsonrpc: "2.0",
  method: "tools/call",
  id: 2,
  params: {
    name: "add",
    arguments: {
      a: 1000,
      b: 123,
    },
  },
};

//===================================================

type StdioServerParameters = {
  command: string;
  args?: string[];
};

const JSONRPCMessageSchema = z.union([
  jsonrpcSchemaRequest,
  jsonrpcSchemaNotification,
  jsonrpcSchemaResponse,
  jsonrpcSchemaError,
]);

type JSONRPCMessage = z.infer<typeof JSONRPCMessageSchema>;

class StdioClientTransport {
  #_subProcess?: ChildProcess;
  #_readBuffer: ReadBuffer = new ReadBuffer();
  #_serverParams: StdioServerParameters;

  onClose?: () => void;
  onMessage?: (message: JSONRPCMessage) => void;

  constructor(serverParams: StdioServerParameters) {
    this.#_serverParams = serverParams;
  }

  /**
   * Start the server subprocess and prepare to communicate with it.
   */
  async start(): Promise<void> {
    if (this.#_subProcess) {
      throw new Error("Server is already running");
    }

    return new Promise((resolve, reject) => {
      this.#_subProcess = spawn(
        this.#_serverParams.command,
        this.#_serverParams.args ?? [],
        {
          stdio: ["pipe", "pipe", "pipe"],
          shell: false,
          env: process.env,
        }
      );

      this.#_subProcess.on("spawn", () => {
        console.log("✅ child process spawned");
        resolve();
      });

      this.#_subProcess.on("error", (err) => {
        reject(err);
      });

      this.#_subProcess.on("close", () => {
        this.#_subProcess = undefined;
        this.onClose?.();
      });

      this.#_subProcess.stdout?.on("data", (buf) => {
        this.#_readBuffer.append(buf);

        while (true) {
          const message = this.#_readBuffer.readMessage();
          if (message === null) {
            break;
          }

          this.onMessage?.(message);
        }
      });

      this.#_subProcess.stderr?.on("data", (buf) => {
        process.stderr.write(buf);
      });
    });
  }

  async close(): Promise<void> {
    this.#_subProcess = undefined;
    this.#_readBuffer.clear();
  }

  get childProcess(): ChildProcess | undefined {
    return this.#_subProcess;
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!this.#_subProcess) {
      throw new Error("Sub process is not running");
    }

    if (this.#_subProcess.stdin === null) {
      throw new Error("Sub process stdin is not available");
    }

    const json = JSON.stringify(message) + "\n";

    const canWrite = this.#_subProcess.stdin?.write(json);

    if (!canWrite) {
      await once(this.#_subProcess.stdin, "drain");
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

type ClientInfo = {
  name: string;
  version: string;
  title?: string;
};

type ClientOptions = {
  capabilities: Record<string, unknown>; // mock capabilities
};

class Client {
  #_transport?:
    | StdioClientTransport
    | StreamableHTTPClientTransport
    | SSEClientTransport;
  #_clientInfo: ClientInfo;

  #_pendingRequests = new Map<
    string | number | null,
    (response: JSONRPCMessage) => void
  >();

  constructor(clientInfo: ClientInfo, _options?: ClientOptions) {
    this.#_clientInfo = clientInfo;
  }

  async connect(
    transport:
      | StdioClientTransport
      | StreamableHTTPClientTransport
      | SSEClientTransport
  ): Promise<void> {
    if (
      transport instanceof StreamableHTTPClientTransport ||
      transport instanceof SSEClientTransport
    ) {
      throw new Error(
        "Sorry, we don't support this transport yet. Please use StdioClientTransport instead."
      );
    }

    this.#_transport = transport;

    this.#_transport.onMessage = (message) => {
      if (!("id" in message) || message.id === undefined) {
        return;
      }

      // This is just a mock implementation, MUST process the messages according to their types.
      const resolver = this.#_pendingRequests.get(message.id);
      if (resolver) {
        resolver(message);
        this.#_pendingRequests.delete(message.id);
      }
    };

    await this.#_transport.start();

    await this.#_transport.send(initializeRequest);

    await this.#_transport.send(initializedNotification);
  }

  get transport():
    | StdioClientTransport
    | StreamableHTTPClientTransport
    | SSEClientTransport
    | undefined {
    return this.#_transport;
  }

  async listTools() {
    if (!this.#_transport) {
      throw new Error("Transport is not connected");
    }

    if (
      this.#_transport instanceof StreamableHTTPClientTransport ||
      this.#_transport instanceof SSEClientTransport
    ) {
      throw new Error(
        "Sorry, we don't support this transport yet. Please use StdioClientTransport instead."
      );
    }

    const responsePromise = new Promise<JSONRPCMessage>((resolve) => {
      this.#_pendingRequests.set(toolsListRequest.id ?? 1, resolve);
    });

    await this.#_transport.send(toolsListRequest);

    return responsePromise;
  }

  async callTool({
    toolName,
    args,
  }: {
    toolName: string;
    args: Record<string, unknown>;
  }) {
    if (!this.#_transport) {
      throw new Error("Transport is not connected");
    }

    if (
      this.#_transport instanceof StreamableHTTPClientTransport ||
      this.#_transport instanceof SSEClientTransport
    ) {
      throw new Error(
        "Sorry, we don't support this transport yet. Please use StdioClientTransport instead."
      );
    }

    const toolsCallRequest: JsonRpcRequest<
      typeof toolsCallRequestParamsSchema
    > = {
      jsonrpc: "2.0",
      method: "tools/call",
      id: 2,
      params: {
        name: toolName,
        arguments: args,
      },
    };

    const responsePromise = new Promise<JSONRPCMessage>((resolve) => {
      this.#_pendingRequests.set(toolsCallRequest.id ?? 2, resolve);
    });

    await this.#_transport.send(toolsCallRequest);

    return responsePromise;
  }
}

const transport = new StdioClientTransport({
  command: "./node_modules/.bin/tsx",
  args: ["src/mcp-servers/raw-stdio-server-quick-start.ts"],
});

const client = new Client({
  name: "mcp-client",
  version: "1.0.0",
});

await client.connect(transport);

const tools = await client.listTools();

console.log(JSON.stringify(tools, null, 2));

const result = await client.callTool({ toolName: "add", args: { a: 1, b: 2 } });

console.log(JSON.stringify(result, null, 2));

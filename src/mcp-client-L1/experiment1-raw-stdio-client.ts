import { spawn } from "child_process";
import z from "zod";

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

type NotificationRequest = Omit<
  z.infer<typeof jsonrpcSchemaRequest>,
  "id" | "params"
>;

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
const toolsCallRequest: JsonRpcRequest<typeof toolsCallRequestParamsSchema> = {
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

// 2. 启动子进程
const child = spawn(
  // ⚠️ "bash", ["-i", "-c", "tsx src/mcp-servers/raw-stdio-server-quick-start.ts"],
  // a bash subprocess, it doesn't have access to the local node_modules/.bin directory where tsx is installed.
  // use the direct path to tsx
  "./node_modules/.bin/tsx",
  ["src/mcp-servers/raw-stdio-server-quick-start.ts"],
  {
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
    shell: false,
  }
);

child.on("spawn", () => {
  console.log("✅ child process spawned");
});

child.stdout.on("data", (buf) => {
  const output = buf.toString();
  console.log("💡 child process has stdout");
  console.log("🔥 sending output to main process");
  process.stdout.write(output);
});

child.stderr.on("data", (buf) => {
  const output = buf.toString();
  console.error("❌ child process has stderr");
  console.error("🔥 sending error to main process");
  process.stderr.write(output);
});

child.on("exit", (code, signal) => {
  console.log("⏹️ child process exited with code", code, "and signal", signal);
});

child.on("close", (code, signal) => {
  console.log("🛑 child process closed with code", code, "and signal", signal);
  process.exit(code ?? 1);
});

process.stdin.on("end", () => {
  console.log("⏹️ main process stdin ended, closing child stdin");
  child.stdin.end();
});

process.on("SIGINT", () => {
  child.stdin.end();
  child.kill("SIGINT");
  process.exit(0);
});

// 3. 发送请求 - 必须有换行符
child.stdin.write(JSON.stringify(initializeRequest) + "\n");
child.stdin.write(JSON.stringify(initializedNotification) + "\n");
child.stdin.write(JSON.stringify(toolsListRequest) + "\n");
child.stdin.write(JSON.stringify(toolsCallRequest) + "\n");

child.stdin.end();

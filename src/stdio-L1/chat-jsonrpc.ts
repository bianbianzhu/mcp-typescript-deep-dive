import "dotenv/config";
import readline from "readline";
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

//=======================Actual Code=======================

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const history = [];

let isServerOnline = false;

rl.setPrompt("user: ");
rl.prompt();

rl.on("line", async (line) => {
  if (line === "stop") {
    rl.close();
    return;
  }

  try {
    const request = JSON.parse(line);

    const parsed = jsonrpcSchemaRequest.safeParse(request);

    if (!parsed.success) {
      const requestParsedErrorResponse: ErrorResponse = {
        jsonrpc: "2.0",
        id: request.id ?? null,
        error: {
          code: -32600,
          message: `Invalid request: ${parsed.error.message}`,
        },
      };
      history.push(requestParsedErrorResponse);

      console.log(JSON.stringify(requestParsedErrorResponse, null, 2));
      rl.prompt();
      return;
    }

    history.push(parsed.data);

    const { method, params, id } = parsed.data;

    if (id === undefined) {
      // notification, no response needed
      rl.prompt();
      return;
    }

    // 看看超市开不开门
    if (method === "initialize") {
      const initializeRequestParams =
        initializeRequestParamsSchema.safeParse(params);

      if (!initializeRequestParams.success) {
        const initializeRequestParamsErrorResponse: ErrorResponse = {
          jsonrpc: "2.0",
          id: request.id ?? null,
          error: {
            code: -32000,
            message: `Bad Request: ${initializeRequestParams.error.message}`,
          },
        };

        history.push(initializeRequestParamsErrorResponse);

        console.log(
          JSON.stringify(initializeRequestParamsErrorResponse, null, 2)
        );
        rl.prompt();
        return;
      }

      isServerOnline = Math.random() < 0.5;

      if (!isServerOnline) {
        const initializeFailedResponse: ErrorResponse = {
          jsonrpc: "2.0",
          id: request.id ?? null,
          error: {
            code: -32002,
            message: "Server offline",
          },
        };

        history.push(initializeFailedResponse);

        console.log(JSON.stringify(initializeFailedResponse, null, 2));
        rl.prompt();
        return;
      }

      const initializeResponse: SuccessResponse<
        typeof initializeResponseResultSchema
      > = {
        jsonrpc: "2.0",
        id: request.id ?? null,
        result: {
          capabilities: {
            tools: {},
            logging: {},
          },
          protocolVersion: "2025-06-18",
          serverInfo: {
            name: "chat-jsonrpc",
            version: "1.0.0",
          },
        },
      };

      history.push(initializeResponse);

      console.log(JSON.stringify(initializeResponse, null, 2));
      rl.prompt();
      return;
    }

    if (method === "tools/list") {
      if (!isServerOnline) {
        const toolsListFailedResponse: ErrorResponse = {
          jsonrpc: "2.0",
          id: request.id ?? null,
          error: {
            code: -32002,
            message:
              "Server may not be online; Try initialize the connection first",
          },
        };

        history.push(toolsListFailedResponse);

        console.log(JSON.stringify(toolsListFailedResponse, null, 2));
        rl.prompt();
        return;
      }

      const toolsListResponse: SuccessResponse<
        typeof toolsListResponseResultSchema
      > = {
        jsonrpc: "2.0",
        id: request.id ?? null,
        result: {
          tools: [
            {
              name: "get_weather",
              description: "Get the weather for a given location",
              inputSchema: {
                type: "object",
                properties: {
                  location: {
                    type: "string",
                    description: "The location to get the weather for",
                  },
                },
                required: ["location"],
                additionalProperties: false,
              },
              annotations: {
                title: "Get Weather",
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
              },
            },
          ],
        },
      };

      history.push(toolsListResponse);

      console.log(JSON.stringify(toolsListResponse, null, 2));
      rl.prompt();
      return;
    }

    const unhandledMethodResponse: ErrorResponse = {
      jsonrpc: "2.0",
      id: request.id ?? null,
      error: {
        code: -32601,
        message: "Method not found",
      },
    };

    history.push(unhandledMethodResponse);

    console.log(JSON.stringify(unhandledMethodResponse, null, 2));
  } catch (error) {
    console.log("Your request is not a valid JSON-RPC request");
  }

  rl.prompt();
});

rl.on("close", () => {
  console.log("bye");
});

const signals = ["SIGINT", "SIGTERM", "SIGHUP", "SIGTSTP"];
signals.forEach((signal) => {
  process.on(signal, () => {
    console.log(`\n${signal} received. Shutting down gracefully...`);

    // Close readline interface
    rl.close();

    console.log("Cleanup completed");
  });
});

// initialize
// {  "method": "initialize",  "params": {    "protocolVersion": "2025-06-18",    "capabilities": {    },    "clientInfo": {      "name": "postman-mcp-client",      "version": "1.0.0"    }  },  "jsonrpc": "2.0",  "id": 0}

// tools/list
// {  "method": "tools/list",  "jsonrpc": "2.0",  "id": 0}

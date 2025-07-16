import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolResult,
  isInitializeRequest,
  Tool,
  ToolSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { Ajv } from "ajv"; // don't use import Ajv from "ajv"; (TS error)

const PORT = 8999;

const app = express();
app.use(express.json());

const highLevelSessions = new Map<
  string,
  {
    server: McpServer;
    transport: StreamableHTTPServerTransport;
  }
>();

// 👍 High level server
function createHighLevelServer() {
  const hightLevelServer = new McpServer({
    name: "mcp-http-stream",
    version: "1.0.0",
  });

  hightLevelServer.registerTool(
    "add",
    {
      title: "Addition Tool",
      description: "Add two numbers",
      inputSchema: { a: z.number(), b: z.number() },
    },
    async ({ a, b }) => ({
      content: [
        { type: "text", text: String(a + b) },
        {
          type: "text",
          text: "this is high level server addition tool",
        },
      ],
    })
  );

  hightLevelServer.registerTool(
    "subtract",
    {
      title: "Subtraction Tool",
      description: "Subtract two numbers",
      inputSchema: { a: z.number(), b: z.number() },
    },
    async ({ a, b }) => ({
      content: [
        { type: "text", text: String(a - b) },
        {
          type: "text",
          text: "this is high level server subtraction tool",
        },
      ],
    })
  );

  return hightLevelServer;
}

// ============ Express server route ============
app.post("/mcp/high-level", async (req, res) => {
  const sid = req.headers["mcp-session-id"];

  let transport: StreamableHTTPServerTransport;
  let server: McpServer;

  if (sid && typeof sid === "string") {
    const session = highLevelSessions.get(sid);

    if (!session) {
      res.status(404).json({
        jsonrpc: "2.0",
        id: req.body.id ?? null,
        error: {
          code: -32000,
          message: "Bad Request: Session not found",
        },
      });
      return;
    }

    server = session.server;
    transport = session.transport;
  } else if (!sid && isInitializeRequest(req.body)) {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      onsessioninitialized: (_sessionId) => {
        highLevelSessions.set(_sessionId, {
          server,
          transport,
        });
      },
    });

    server = createHighLevelServer();

    await server.connect(transport);
  } else {
    res.status(400).json({
      jsonrpc: "2.0",
      id: req.body.id ?? null,
      error: {
        code: -32000,
        message: "Bad Request: Invalid request",
      },
    });
    return;
  }

  await transport.handleRequest(req, res, req.body);
});

// ========== END of high level server ==========
// 🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧🚧

const lowLevelSessions = new Map<
  string,
  {
    server: Server;
    transport: StreamableHTTPServerTransport;
  }
>();

// 👎 Low level server
function createLowLevelServer() {
  const lowLevelServer = new Server(
    {
      name: "mcp-http-stream-low-level",
      version: "1.0.0",
    },
    {
      capabilities: {
        prompts: {},
        resources: {},
        tools: {},
      } /** YOU MUST SET tools to be empty object to avoid the error:
                    if (!this._capabilities.tools) {
                    throw new Error(`Server does not support tools (required for ${method})`);
                } */,
    }
  );

  //  =========1st tool: add========
  // define the zod schema
  const addToolSchema = z.object({
    a: z.number().describe("The first number to add"),
    b: z.number().describe("The second number to add"),
  });

  // wired, but it works - convert zod schema to json schema
  const addToolJsonSchema = zodToJsonSchema(addToolSchema) as z.infer<
    typeof ToolSchema
  >["inputSchema"];

  // provides the tool name, description, and input schema
  const addTool: Tool = {
    name: "add",
    description: "Add two numbers",
    inputSchema: addToolJsonSchema, // only accepts the json schema
  };

  // since args will be validated by ajv, we can safely cast the args to the schema type
  function addToolExecute(args: z.infer<typeof addToolSchema>): CallToolResult {
    return {
      content: [
        { type: "text", text: String(args.a + args.b) },
        {
          type: "text",
          text: "this is low level server addition tool",
        },
      ],
      isError: false,
    };
  }

  //  =========2nd tool: subtract========
  // define the zod schema
  const subtractToolSchema = z.object({
    a: z.number().describe("The first number to subtract"),
    b: z.number().describe("The second number to subtract"),
  });

  // wired, but it works - convert zod schema to json schema
  const subtractToolJsonSchema = zodToJsonSchema(subtractToolSchema) as z.infer<
    typeof ToolSchema
  >["inputSchema"];

  // provides the tool name, description, and input schema
  const subtractTool: Tool = {
    name: "subtract",
    description: "Subtract two numbers",
    inputSchema: subtractToolJsonSchema, // only accepts the json schema
  };

  // since args will be validated by ajv, we can safely cast the args to the schema type
  function subtractToolExecute(
    args: z.infer<typeof subtractToolSchema>
  ): CallToolResult {
    return {
      content: [
        { type: "text", text: String(args.a - args.b) },
        {
          type: "text",
          text: "this is low level server subtraction tool",
        },
      ],
      isError: false,
    };
  }

  // ======== A Map of tool names and their execute functions===========
  const toolMap = new Map<string, (args: unknown) => CallToolResult>([
    [addTool.name, addToolExecute],
    [subtractTool.name, subtractToolExecute],
  ]);

  // ======== END of tool definitions===========

  // general tool execution handler
  function handleToolExecution({
    tool, // for schema validation
    args, // the arguments for the execute function
    execute, // the execute function
  }: {
    tool: Tool;
    args: unknown;
    execute: (args: unknown) => CallToolResult;
  }): CallToolResult {
    const ajv = new Ajv();
    // ajv: the json schema validator
    const validate = ajv.compile(tool.inputSchema);
    const isValid = validate(args) as boolean;

    if (!isValid) {
      return {
        content: [
          {
            type: "text",
            text: `Invalid arguments`,
          },
        ],
        isError: true,
      };
    }

    try {
      const result = execute(args);
      return result;
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: error instanceof Error ? error.message : String(error),
          },
        ],
        isError: true,
      };
    }
  }

  // define toolList
  const toolList: Tool[] = [addTool];

  lowLevelServer.setRequestHandler(ListToolsRequestSchema, () => {
    return {
      tools: toolList,
    };
  });

  lowLevelServer.setRequestHandler(
    CallToolRequestSchema,
    async (req, _extra) => {
      const { name: toolName, arguments: args } = req.params;

      const tool = toolList.find((tool) => tool.name === toolName);

      if (!tool) {
        return {
          content: [{ type: "text", text: `Tool ${toolName} not found` }],
          isError: true,
        };
      }

      const result = handleToolExecution({
        tool,
        args,
        execute: toolMap.get(toolName)!,
      });

      return result;
    }
  );

  return lowLevelServer;
}

app.post("/mcp/low-level", async (req, res) => {
  const sid = req.headers["mcp-session-id"];

  let transport: StreamableHTTPServerTransport;
  let server: Server;

  if (sid && typeof sid === "string") {
    const session = lowLevelSessions.get(sid);

    if (!session) {
      res.status(404).json({
        jsonrpc: "2.0",
        id: req.body.id ?? null,
        error: {
          code: -32000,
          message: "Bad Request: Session not found",
        },
      });
      return;
    }

    server = session.server;
    transport = session.transport;
  } else if (!sid && isInitializeRequest(req.body)) {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      onsessioninitialized: (_sessionId) => {
        lowLevelSessions.set(_sessionId, {
          server,
          transport,
        });
      },
    });

    server = createLowLevelServer();

    await server.connect(transport);
  } else {
    res.status(400).json({
      jsonrpc: "2.0",
      id: req.body.id ?? null,
      error: {
        code: -32000,
        message: "Bad Request: Invalid request",
      },
    });
    return;
  }

  await transport.handleRequest(req, res, req.body);
});

app
  .listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  })
  .on("error", (err) => {
    console.error(err);
    process.exit(1);
  });

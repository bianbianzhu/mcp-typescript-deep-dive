import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  isInitializeRequest,
  isJSONRPCNotification,
  isJSONRPCRequest,
} from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import jwt from "jsonwebtoken";

const PORT = 8999;

const app = express();
app.use(express.json());

const sessions = new Map<
  string,
  {
    server: McpServer;
    transport: StreamableHTTPServerTransport;
  }
>();

// 👍 High level server
function createServer() {
  const server = new McpServer({
    name: "mcp-http-stream",
    version: "1.0.0",
  });

  server.registerTool(
    "multiply",
    {
      title: "Multiplication Tool",
      description: "Multiply two numbers",
      inputSchema: { a: z.number(), b: z.number() },
    },
    async ({ a, b }) => ({
      content: [{ type: "text", text: String(a * b) }],
      isError: false,
    })
  );

  server.registerTool(
    "divide",
    {
      title: "Division Tool",
      description: "Divide two numbers",
      inputSchema: { a: z.number(), b: z.number() },
    },
    async ({ a, b }) => ({
      content: [{ type: "text", text: String(a / b) }],
      isError: false,
    })
  );

  return server;
}

// ============ Express server route ============
const mockDatabase: {
  users: {
    id: number;
    username: string;
    password: string;
    role: string;
    permissions: string[];
  }[];
} = {
  users: [
    {
      id: 1,
      username: "admin@example.com",
      password: "admin",
      role: "admin",
      permissions: ["read", "write"],
    },
    {
      id: 2,
      username: "user@example.com",
      password: "user",
      role: "user",
      permissions: ["read"],
    },
  ],
};

app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    res.status(400).json({ message: "Username and password are required" });
    return;
  }

  const user = mockDatabase.users.find((user) => user.username === username);

  if (!user) {
    res.status(401).json({ message: "User not found" });
    return;
  }

  if (user.password !== password) {
    res.status(401).json({ message: "Invalid credentials" });
    return;
  }

  const token = jwt.sign(
    { userId: user.id, role: user.role, permissions: user.permissions },
    process.env.JWT_SECRET ?? "secret",
    { expiresIn: "1h" }
  );

  res.status(200).json({ message: "Login successful", token });
});

app.post("/mcp", async (req, res) => {
  const sid = req.headers["mcp-session-id"];
  const token = req.headers["authorization"];

  if (!token) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  if (!token.startsWith("Bearer ")) {
    res.status(401).json({ message: "Invalid token" });
    return;
  }

  const jwtToken = token.split(" ")[1];

  let updatedBody = req.body;

  try {
    const payload = jwt.verify(jwtToken, process.env.JWT_SECRET ?? "secret");

    if (
      !(
        typeof payload === "object" &&
        payload !== null &&
        "userId" in payload &&
        "role" in payload &&
        "permissions" in payload
      )
    ) {
      res.status(401).json({ message: "Invalid token" });
      return;
    }

    if (isJSONRPCRequest(updatedBody) || isJSONRPCNotification(updatedBody)) {
      updatedBody.params = {
        ...updatedBody.params,
        userId: payload.userId,
        role: payload.role,
        permissions: payload.permissions,
      };
    }
  } catch (error) {
    res.status(401).json({ message: "Invalid token" });
    return;
  }

  let transport: StreamableHTTPServerTransport;
  let server: McpServer;

  if (sid && typeof sid === "string") {
    const session = sessions.get(sid);

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
        sessions.set(_sessionId, {
          server,
          transport,
        });
        console.log(`New session initialized: ${_sessionId}`);
      },
    });

    server = createServer();

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
    console.log(`Server is running on port ${PORT} - raw http-stream server`);
  })
  .on("error", (err) => {
    console.error(err);
    process.exit(1);
  });

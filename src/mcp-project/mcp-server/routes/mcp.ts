import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  isInitializeRequest,
  JSONRPCError,
} from "@modelcontextprotocol/sdk/types.js";
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { initServer } from "../server.js";

export function createMCPRouter(options: { authToken: string }): Router {
  const { authToken } = options;

  const router: Router = Router();

  const sessions = new Map<
    string,
    {
      server: McpServer;
      transport: StreamableHTTPServerTransport;
    }
  >();

  router.post("/", async (req, res) => {
    const sid = req.headers["mcp-session-id"];

    let transport: StreamableHTTPServerTransport;
    let server: McpServer;

    if (sid && typeof sid === "string") {
      const session = sessions.get(sid);

      const sessionNotFoundResponse: JSONRPCError = {
        jsonrpc: "2.0",
        id: req.body?.id ?? null,
        error: {
          code: -32000,
          message: "❌ Bad Request: Session not found",
        },
      };

      if (!session) {
        res.status(404).json(sessionNotFoundResponse);
        return;
      }

      server = session.server;
      transport = session.transport;
    } else if (!sid && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: randomUUID,
        onsessioninitialized: (sessionId) => {
          sessions.set(sessionId, {
            transport,
            server,
          });
          console.log(`⭐️ New session initialized: ${sessionId}`);
        },
      });

      transport.onclose = () => {
        if (transport.sessionId) {
          console.log(`❌ Closing session: ${transport.sessionId}`);
          sessions.delete(transport.sessionId);
        }
      };

      server = initServer({ authToken });

      await server.connect(transport);
    } else {
      const badRequestResponse: JSONRPCError = {
        jsonrpc: "2.0",
        id: req.body?.id ?? null,
        error: {
          code: -32000,
          message: "❌ Bad Request: Invalid request",
        },
      };

      res.status(400).json(badRequestResponse);
      return;
    }

    await transport.handleRequest(req, res, req.body);
  });

  return router;
}

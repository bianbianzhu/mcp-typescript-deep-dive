import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "node:crypto";
import { FastMCPSession } from "fastmcp";
import http from "http";

async function main<T extends FastMCPSession>(args: {
  port: number;
  endpoint?: string;
  createServer: (req: http.IncomingMessage) => Promise<T>; // 根据请求创建一个server session
  onClose?: () => Promise<void>; // 在session关闭前执行
  onConnect?: () => Promise<void>; // 在session连接后执行
  onUnhandledRequest?: (
    req: http.IncomingMessage,
    res: http.ServerResponse
  ) => Promise<void>; // 用于处理未被定义该如何处理的请求
}): Promise<{ close: () => Promise<void> }> {
  const {
    port,
    endpoint = "/mcp",
    createServer,
    onClose,
    onConnect,
    onUnhandledRequest,
  } = args;

  const activeSessions: Record<
    string,
    {
      fastMCPSession: T;
      serverTransport: StreamableHTTPServerTransport;
    }
  > = {};

  const httpServer = http.createServer(async (req, res) => {
    const path = new URL(req.url!, "http://localhost").pathname;

    if (path === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("healthy");
      return;
    }

    if (path === endpoint && req.method === "POST") {
      let transport: StreamableHTTPServerTransport;
      let session: T;

      const sessionId = req.headers["x-mcp-session-id"] as string | undefined;

      const body = await getBody(req);

      function isInitializeRequest(body: unknown): boolean {
        return (
          typeof body === "object" &&
          body !== null &&
          "method" in body &&
          body.method === "initialize"
        );
      }

      if (sessionId) {
        const activeSession = activeSessions[sessionId];
        if (!activeSession) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Session not found");
          return;
        }

        transport = activeSession.serverTransport;
        session = activeSession.fastMCPSession;
      } else if (isInitializeRequest(body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: randomUUID,
          onsessioninitialized: (_sessionId) => {
            activeSessions[_sessionId] = {
              fastMCPSession: session,
              serverTransport: transport,
            };
          },
        });

        transport.onclose = async () => {
          if (onClose) {
            await onClose();
          }
        };

        session = await createServer(req);

        await session.connect(transport);

        if (onConnect) {
          await onConnect();
        }
      } else {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Invalid request");
        return;
      }

      await transport.handleRequest(req, res, body);
      return;
    }

    if (onUnhandledRequest) {
      await onUnhandledRequest(req, res);
    } else {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    }
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(port, "::", () => {
      console.log(`HTTP server is running on port ${port}`);
      resolve();
    });
  });

  return {
    close: async () => {
      for (const session of Object.values(activeSessions)) {
        session.serverTransport.close();
      }

      return new Promise((resolve, reject) => {
        httpServer.close((err) => {
          if (err) {
            reject(err);
            return;
          }

          resolve();
        });
      });
    },
  };
}

function getBody(request: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const bodyParts: Buffer[] = [];
    let body: string;
    request
      .on("data", (chunk) => {
        bodyParts.push(chunk);
      })
      .on("end", () => {
        body = Buffer.concat(bodyParts).toString();
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          console.error("[mcp-proxy] error parsing body", error);
          resolve(null);
        }
      });
  });
}

(async () => {
  let serverWithClose: { close: () => Promise<void> } | undefined;
  try {
    serverWithClose = await main({
      port: 6666,
      createServer: async () => {
        return new FastMCPSession({
          name: "my-test-mcp-server",
          version: "1.0.0",
          prompts: [],
          resources: [],
          resourcesTemplates: [],
          tools: [],
          instructions: "This is a test MCP server",
        });
      },
      onConnect: async () => {
        console.log("hahaha you are connected");
      },
      onClose: async () => {
        console.log("hahaha you are closed");
      },
    });
  } catch (error) {
    console.error(error);
  }
})();

import { JSONRPCError } from "@modelcontextprotocol/sdk/types.js";
import { NextFunction, Request, Response } from "express";

export function createAuthMiddleware(authToken: string) {
  function middleware(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers["authorization"];

    const token = authHeader?.split(" ")[1]; // remove 'Bearer'

    const missingTokenResponse: JSONRPCError = {
      jsonrpc: "2.0",
      id: req.body?.id ?? null,
      error: {
        code: -32001,
        message: "❌ Unauthorized: Missing Bearer token",
      },
    };

    if (!token) {
      res.status(401).json(missingTokenResponse);
      return;
    }

    const invalidTokenResponse: JSONRPCError = {
      jsonrpc: "2.0",
      id: req.body?.id ?? null,
      error: {
        code: -32002,
        message: "❌ Forbidden: Invalid Bearer token",
      },
    };

    if (token !== authToken) {
      res.status(403).json(invalidTokenResponse);
      return;
    }

    next();
  }

  return middleware;
}

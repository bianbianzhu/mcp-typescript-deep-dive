import { Router } from "express";
import { createHealthCheckRouter } from "./health-check.js";
import { createAuthMiddleware } from "../middlewares/auth.js";
import { createMCPRouter } from "./mcp.js";

export function createRootRouter(config: { port: number; authToken: string }) {
  const { port, authToken } = config;

  const rootRouter: Router = Router();

  const healthCheckRouter = createHealthCheckRouter(port);
  const authMiddleware = createAuthMiddleware(authToken);
  const mcpRouter = createMCPRouter({ authToken });

  rootRouter.use("/health", healthCheckRouter);
  rootRouter.use("/mcp", authMiddleware, mcpRouter);

  return rootRouter;
}

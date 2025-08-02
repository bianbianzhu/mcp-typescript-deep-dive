import { Router } from "express";

export function createHealthCheckRouter(port: number): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.status(200).json({
      status: "✅ ok",
      timeStamp: new Date().toISOString(),
      transport: "httpstream",
      port,
    });

    return;
  });

  return router;
}

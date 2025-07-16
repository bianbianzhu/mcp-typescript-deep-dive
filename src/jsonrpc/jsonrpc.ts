import express from "express";
import { z } from "zod";

const jsonrpcSchema = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.string(),
  params: z.array(z.number()).optional(),
  id: z.union([z.number(), z.string().min(1)]).optional(), // number or non-empty string
});

const app = express();

app.use(express.json());

app.post("/jsonrpc", (req, res) => {
  const parsed = jsonrpcSchema.safeParse(req.body);

  const errorResponse: {
    jsonrpc: string;
    error: {
      code: number;
      message: string;
    };
    id?: number | string | null;
  } = {
    jsonrpc: "2.0",
    error: {
      code: -32600,
      message: "Invalid request",
    },
  };

  if (!parsed.success) {
    res.status(400).json({
      ...errorResponse,
      error: {
        code: -32600,
        message: `Invalid request: ${parsed.error.message}`,
      },
    });
    return;
  }

  // POST http://localhost:9999/jsonrpc
  const { method, params, id } = parsed.data;

  if (method === "subtract") {
    if (!params || !Array.isArray(params) || params.length !== 2) {
      res.status(400).json({
        ...errorResponse,
        error: {
          code: -32602,
          message: "Invalid params",
        },
      });
      return;
    }

    const a = params[0];
    const b = params[1];
    const result = a - b;

    const response: Record<string, unknown> = {
      jsonrpc: req.body.jsonrpc,
      result,
    };

    if (id) {
      response.id = id;
    }

    res.status(200).json(response);
    return;
  }
});

app.listen(9999, () => {
  console.log("jsonrpc server is running on port 9999");
});

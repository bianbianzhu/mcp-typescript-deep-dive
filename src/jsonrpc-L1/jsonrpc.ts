import express from "express";
import { z } from "zod";

const PORT = 9999;

const jsonrpcSchemaBase = z.object({
  jsonrpc: z.literal("2.0"),
});

const jsonrpcSchemaRequest = jsonrpcSchemaBase.extend({
  method: z.string().refine((val) => !/^rpc\./i.test(val), {
    message: "Method name cannot start with 'rpc.', ignore case",
  }),
  params: z.array(z.number()).optional(), // params is optional - request with/without params. Params will be ignored for notification.
  id: z.union([z.number(), z.string().min(1)]).optional(), // when id is not provided, it is a notification
});

// success response
const jsonrpcSchemaResponse = jsonrpcSchemaBase.extend({
  result: z.unknown(),
  id: z.union([z.number(), z.string().min(1)]),
});

type SuccessResponse = z.infer<typeof jsonrpcSchemaResponse>;

const jsonrpcSchemaError = jsonrpcSchemaBase.extend({
  error: z.object({
    code: z.number(),
    message: z.string(),
    data: z.unknown().optional(),
  }),
  id: z.union([z.number(), z.string().min(1)]).nullable(),
});

type ErrorResponse = z.infer<typeof jsonrpcSchemaError>;

const app = express();

app.use(express.json());

app.post("/jsonrpc", (req, res) => {
  // 1. validate request jsonrpc schema
  const parsed = jsonrpcSchemaRequest.safeParse(req.body);

  if (!parsed.success) {
    const requestParsedErrorResponse: ErrorResponse = {
      jsonrpc: "2.0",
      id: req.body.id ?? null,
      error: {
        code: -32600,
        message: `Invalid request: ${parsed.error.message}`,
      },
    };

    res.status(400).json(requestParsedErrorResponse);
    return;
  }

  // POST http://localhost:9999/jsonrpc
  const { method, params, id } = parsed.data;

  // 2. check if request is notification
  if (id === undefined) {
    res.status(202).send(); // send nothing to client; avoid using res.sendStatus(202) since it is a shortcut for res.status(202).send('Accepted')
    return;
  }

  // 3. handle request
  if (method === "subtract") {
    if (!params || !Array.isArray(params) || params.length !== 2) {
      const errorResponse: ErrorResponse = {
        jsonrpc: "2.0",
        id: req.body.id ?? null,
        error: {
          code: -32602,
          message: "Invalid params",
        },
      };

      res.status(400).json(errorResponse);
      return;
    }

    const a = params[0];
    const b = params[1];
    const result = a - b;

    const response: SuccessResponse = {
      jsonrpc: "2.0",
      id,
      result,
    };

    res.status(200).json(response);
    return;
  }

  // 4. handle unknown method
  const errorResponse: ErrorResponse = {
    jsonrpc: "2.0",
    id: req.body.id ?? null,
    error: {
      code: -32601,
      message: "Method not found",
    },
  };

  res.status(404).json(errorResponse);
});

app
  .listen(PORT, () => {
    console.log("jsonrpc server is running on port 9999");
  })
  .on("error", (err) => {
    console.error(err);
    process.exit(1);
  });

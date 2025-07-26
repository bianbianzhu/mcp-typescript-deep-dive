import { z } from "zod";

// ⚠️⚠️⚠️⚠️⚠️ 搭配 client-evolution/experiment1-raw-stdio-client.ts 使用 ⚠️⚠️⚠️⚠️⚠️

const jsonrpcSchemaBase = z.object({
  jsonrpc: z.literal("2.0"),
});

const jsonrpcSchemaResponse = jsonrpcSchemaBase.extend({
  result: z.unknown(),
  id: z.union([z.number(), z.string().min(1)]),
});

type SuccessResponse<T extends z.ZodTypeAny = z.ZodUnknown> = z.infer<
  typeof jsonrpcSchemaResponse
> & {
  result: z.infer<T>;
};

process.stdin.on("data", (buf) => {
  process.stdout.write(`❇️ Data received from client\n`);

  // input 是所有flush进来的数据拼接起来的
  // 在client experiment1-raw-stdio-client.ts 中，client会发送4条请求： initialize, notifications/initialized, tools/list, tools/call
  // 这四条jsonrpc很可能会被拼接在一起，然后flush进server的stdin
  const input = buf.toString();

  const response: SuccessResponse = {
    jsonrpc: "2.0",
    id: 0,
    result: {
      message: `🌼 server received: ${input}`,
    },
  };

  process.stdout.write(JSON.stringify(response) + "\n");
});

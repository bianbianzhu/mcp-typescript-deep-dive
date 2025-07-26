import {
  JSONRPCMessage,
  JSONRPCMessageSchema,
  JSONRPCResponse,
} from "@modelcontextprotocol/sdk/types.js";

// ⚠️⚠️⚠️⚠️⚠️ 搭配 client-evolution/experiment2-raw-stdio-client.ts 使用 ⚠️⚠️⚠️⚠️⚠️

class ReadBuffer {
  #_buffer?: Buffer;

  append(data: Buffer): void {
    this.#_buffer = this.#_buffer ? Buffer.concat([this.#_buffer, data]) : data;
  }

  readMessage(): JSONRPCMessage | null {
    if (!this.#_buffer) {
      return null;
    }

    const index = this.#_buffer.indexOf("\n");
    if (index === -1) {
      return null;
    }

    const line = this.#_buffer.toString("utf-8", 0, index).replace(/\r$/, "");
    this.#_buffer = this.#_buffer.subarray(index + 1);

    const message = JSON.parse(line);

    const parsed = JSONRPCMessageSchema.safeParse(message);
    if (!parsed.success) {
      return null;
    }

    return parsed.data;
  }

  clear(): void {
    this.#_buffer = undefined;
  }
}

const readBuffer = new ReadBuffer();

function onMessage(message: JSONRPCMessage) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

process.stdin.on("data", (buf) => {
  readBuffer.append(buf);

  while (true) {
    const message = readBuffer.readMessage();
    if (!message) {
      break;
    }

    if (!("id" in message)) {
      continue;
    }

    const response: JSONRPCResponse = {
      jsonrpc: "2.0",
      id: message.id ?? 0,
      result: {
        message: `🌼 server received: ${JSON.stringify(message)}`,
      },
    };

    onMessage(response); // better to put the above logic in the onMessage function
  }
});

import {
  isJSONRPCNotification,
  JSONRPCMessage,
  JSONRPCMessageSchema,
  JSONRPCResponse,
} from "@modelcontextprotocol/sdk/types.js";
import { Readable, Writable } from "node:stream";
import { once } from "node:events";

// ⚠️⚠️⚠️⚠️⚠️ 搭配 client-evolution/experiment2.5-raw-stdio-client.ts 使用 ⚠️⚠️⚠️⚠️⚠️

class StdioServerTransport {
  #_readBuffer: ReadBuffer = new ReadBuffer();
  #_start: boolean = false;
  #_stdin: Readable;
  #_stdout: Writable;

  constructor(onMessage?: (message: JSONRPCMessage) => void) {
    this.#_stdin = process.stdin;
    this.#_stdout = process.stdout;
    this.onMessage = onMessage;
  }

  onMessage?: (message: JSONRPCMessage) => void;
  onClose?: () => void;
  onError?: (error: Error) => void;

  async start(): Promise<void> {
    if (this.#_start) {
      throw new Error("Server is already started");
    }

    this.#_start = true;

    this.#_stdin.on("data", (buf) => {
      this.#_readBuffer.append(buf);

      while (true) {
        const message = this.#_readBuffer.readMessage();
        if (!message) {
          break;
        }

        this.onMessage?.(message);
      }
    });

    this.#_stdin.on("error", (error) => {
      this.onError?.(error);
    });
  }

  async close(): Promise<void> {
    this.#_readBuffer.clear();

    this.onClose?.();
  }

  async send(message: JSONRPCMessage): Promise<void> {
    const json = JSON.stringify(message) + "\n";

    const canWrite = this.#_stdout.write(json);

    if (!canWrite) {
      await once(this.#_stdout, "drain");
    }
  }
}

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

const transport = new StdioServerTransport(onMessage);

await transport.start();

function onMessage(message: JSONRPCMessage): void {
  //   if (!("id" in message)) {
  //     return;
  //   } // 如果id不存在，则认为这是一个notification，不需要处理

  if (isJSONRPCNotification(message)) {
    return;
  } // 使用isJSONRPCNotification来判断是否是notification更加elegant

  const response: JSONRPCResponse = {
    jsonrpc: "2.0",
    id: message.id ?? 0,
    result: {
      message: `🌼 server received: ${JSON.stringify(message)}`,
    },
  };

  transport.send(response);
}

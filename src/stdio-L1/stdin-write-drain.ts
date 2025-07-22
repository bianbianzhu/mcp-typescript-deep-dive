import { spawn } from "child_process";
import { once } from "events";
import Stream from "stream";

const child = spawn("zsh", ["-i", "-c", "pnpm run mcp:raw-stdio"], {
  stdio: ["pipe", "pipe", "pipe"],
  shell: false,
  env: process.env,
});

// 监听子进程的 spawn 事件 - 子进程成功启动时触发
child.on("spawn", () => {
  process.stdout.write("✅ child process spawned\n");
});

// 监听子进程的 stdout 输出
child.stdout.on("data", (buf) => {
  const input = buf.toString().trim();
  process.stdout.write(`💡 std output from child: ${input}\n`); // 当前进程打印子进程的输出 - 不然你看不见子进程的输出
});

// 监听子进程的 stderr 错误输出
child.stderr.on("data", (buf) => {
  const input = buf.toString().trim();
  process.stderr.write(`❌ std error from child: ${input}\n`); // 当前进程打印子进程的错误输出 - 不然你看不见子进程的错误输出
});

child.on("exit", (code, signal) => {
  process.stdout.write(`child exited with code ${code} and signal ${signal}\n`);
});

child.on("close", (code, signal) => {
  process.stdout.write(`child closed with code ${code} and signal ${signal}\n`);
});

// 1. 直接写入子进程的 stdin
await writeWithPressure(
  child.stdin,
  '{  "method": "initialize",  "params": {    "protocolVersion": "2025-06-18",    "capabilities": {},    "clientInfo": {      "name": "mcp",      "version": "0.1.0"    }  },  "jsonrpc": "2.0",  "id": 0}\n' // 缺少换行符，消息可能不会被处理
);

await writeWithPressure(
  child.stdin,
  '{"method":"notifications/initialized", "jsonrpc":"2.0"}\n'
);

await writeWithPressure(
  child.stdin,
  '{ "method": "tools/list", "jsonrpc": "2.0", "id": 1 }\n'
);

await writeWithPressure(
  child.stdin,
  '{ "method": "tools/call", "params": { "name": "add", "arguments": { "a": 15, "b": 13 } }, "jsonrpc": "2.0", "id": 2 }\n'
);

child.stdin.end();

async function writeWithPressure(stream: Stream.Writable, data: string) {
  const canWrite = stream.write(data);
  if (!canWrite) {
    await once(stream, "drain");
  }
}

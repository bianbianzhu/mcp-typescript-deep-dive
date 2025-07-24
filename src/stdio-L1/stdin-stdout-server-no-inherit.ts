import { spawn } from "child_process";

const child = spawn("zsh", ["-i", "-c", "pnpm run mcp:raw-stdio"], {
  //   stdio: "inherit",
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

// 在子进程退出时触发
child.on("exit", (code, signal) => {
  process.stdout.write(`child exited with code ${code} and signal ${signal}\n`);
});

// 在子进程退出之后，子进程的所有stdio stream关闭时触发
child.on("close", (code, signal) => {
  process.stdout.write(`child closed with code ${code} and signal ${signal}\n`);
});

// const nextTick = new Promise<void>((resolve) => {
//   setImmediate(resolve);
// });

// await nextTick;

// 1. 直接写入子进程的 stdin
child.stdin.write(
  '{  "method": "initialize",  "params": {    "protocolVersion": "2025-06-18",    "capabilities": {},    "clientInfo": {      "name": "mcp",      "version": "0.1.0"    }  },  "jsonrpc": "2.0",  "id": 0}\n' // 缺少换行符，消息可能不会被处理
);

child.stdin.write('{"method":"notifications/initialized", "jsonrpc":"2.0"}\n');

// unlike python, typescript MUST not have `params: null`, it can have `params: {}` or simply omit it
child.stdin.write('{ "method": "tools/list", "jsonrpc": "2.0", "id": 1 }\n');

child.stdin.write(
  '{ "method": "tools/call", "params": { "name": "subtract", "arguments": { "a": 15, "b": 13 } }, "jsonrpc": "2.0", "id": 2 }\n'
);

child.stdin.end();

// •	spawn('zsh', ['-i', '-c', 'pnpm run mcp:dev']...)：
// •	使用 zsh 作为 shell；
// •	-i 启动交互式 shell；
// •	-c 执行后面的命令(pnpm run mcp:dev)；
// •	stdio: 'inherit'：让子进程共享父进程的标准输入/输出/错误流，方便你在终端中实时查看日志，也可输入交互命令  ￼ ￼；
// •	stdio: ['pipe', 'pipe', 'pipe']：自由控制子进程的每个标准流，stdout, stderr, stdin
// •	shell: false：已经显式启动 zsh，不需要额外 shell；
// •	env: process.env：沿用当前进程环境变量（路径、pnpm 等）。

// •	使用 spawn：适合启动长时间运行的进程，支持流式输出处理  ￼ ￼；
// •	zsh -i -c：确保执行 pnpm run mcp:dev 时，使用交互式 zsh 并加载你的配置（如 .zshrc）。

import { ChildProcessWithoutNullStreams, spawn } from "child_process";

// 1. 以 spawn 启动一个子进程（这里举例 bash 为交互 shell
const child = spawn("bash");

// 完整的参数
const _childProcessExample: ChildProcessWithoutNullStreams = spawn("bash", [], {
  stdio: ["pipe", "pipe", "pipe"], // 默认三个流都是 pipe
});

// 2. 向子进程 stdin 发送输入
child.stdin.write("npx -y @modelcontextprotocol/inspector\n"); // 必须有换行符，不然消息可能不会被处理

// 3. inspector 启动后，子进程的 stdout 会输出 inspector 的日志

// 4. 监听子进程的 stdout 的 data 事件，当有数据输出时，会触发data事件 - 通过主进程打印 inspector 的日志
child.stdout.on("data", (buf) => {
  const output = buf.toString();
  console.log("output from child:", output);
});

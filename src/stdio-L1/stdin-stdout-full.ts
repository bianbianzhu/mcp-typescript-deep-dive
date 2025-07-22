import { spawn } from "child_process";

// 1. 启动子进程
const child = spawn("bash", ["-i", "-c", "pnpm run mcp:raw-stdio"], {
  stdio: ["pipe", "pipe", "pipe"],
});

child.on("spawn", () => {
  console.log("✅ child process spawned");
});

// 2. 忠实地将主进程的 stdin 转发给子进程
process.stdin.on("data", (buf) => {
  const input = buf.toString().trim();
  // 如果是zsh，避免使用process.stdout.write 或者 console.log 或者 console.error 在这里打印父进程的输入，这会导致因为安全机制被挂起

  // 如果是bash，可以在这里打印父进程的输入
  console.log("🌟 input from main process:", input);
  console.log("🔥 sending input to child process");
  child.stdin.write(`${input}\n`);
});

// 3. 将子进程的 stdout 直接 pipe 到主进程的 stdout
// 避免转发 stdout 时用 process.stdout.write(${output}\n)，因为output 带已有换行符
child.stdout.on("data", (buf) => {
  const output = buf.toString();
  console.log("💡 child process has stdout");
  console.log("🔥 sending output to main process");
  process.stdout.write(output);
});

// 4. 将子进程的 stderr 直接 pipe 到主进程的 stderr
// 避免转发 stderr 时用 process.stderr.write(${output}\n)，因为output 带已有换行符
child.stderr.on("data", (buf) => {
  const output = buf.toString();
  console.error("❌ child process has stderr");
  console.error("🔥 sending error to main process");
  process.stderr.write(output);
});

child.on("exit", (code, signal) => {
  console.log("⏹️ child process exited with code", code, "and signal", signal);
});

child.on("close", (code, signal) => {
  console.log("🛑 child process closed with code", code, "and signal", signal);
  // 当子进程关闭后，确保主进程也退出
  process.exit(code ?? 1);
});

// 处理主进程 stdin 的结束事件，优雅地关闭子进程的 stdin
process.stdin.on("end", () => {
  console.log("⏹️ main process stdin ended, closing child stdin");
  child.stdin.end();
});

process.on("SIGINT", () => {
  child.stdin.end();
  child.kill("SIGINT");
  process.exit(0);
});

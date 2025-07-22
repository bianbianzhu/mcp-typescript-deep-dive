import { spawn } from "child_process";

const child = spawn("zsh", ["-i", "-c", "pnpm run mcp:raw-stdio"], {
  stdio: "inherit",
  shell: false,
  env: process.env,
});

child.on("error", (err) => {
  console.error("Failed to start subprocess:", err);
});

child.on("exit", (code, signal) => {
  if (code !== null) {
    console.log(`Child exited with code ${code}`);
  } else {
    console.log(`Child was killed with signal ${signal}`);
  }
});

// •	spawn('zsh', ['-i', '-c', 'pnpm run mcp:dev']...)：
// •	使用 zsh 作为 shell；
// •	-i 启动交互式 shell；
// •	-c 执行后面的命令(pnpm run mcp:dev)；
// •	stdio: 'inherit'：让子进程共享父进程的标准输入/输出/错误流，方便你在终端中实时查看日志，也可输入交互命令  ￼ ￼；
// •	shell: false：已经显式启动 zsh，不需要额外 shell；
// •	env: process.env：沿用当前进程环境变量（路径、pnpm 等）。

// 1. 从当前进程读取 - 即向当前进程输入
// 监听 process.stdin.on('data', …)
// 监听当前进程的data事件，当有数据输入时，会触发data事件
process.stdin.on("data", (data) => {
  // data is a Buffer
  const input = data.toString().trim();
  console.log("echo data input and show in console:", input);
  process.stdout.write(
    `echo data input and show in process.stdout: ${input}\n`
  );
});

// 2. 向当前进程输出
// console.log - 最简单，常用
// process.stdout.write - 底层实现，更快，更底层

// console.log 在Node.js 环境下底层通常是通过 process.stdout.write 来实现的
// 讲白了就是 Writes str + \n to process.stdout
// console.log 会自动添加换行符，有格式化功能，带有额外功能（排版、调试方法等），适合一般日志、调试用途

process.stdout.write("Hello, world!\n"); // 不带换行符, 得手动添加
console.log("Hello, world!");

// 3. 向当前进程错误输出
// console.error('...') - 最简单，常用
// process.stderr.write('...') - 底层实现，更快，更底层

// console.error 在Node.js 环境下底层通常是通过 process.stderr.write 来实现的
// 讲白了就是 Writes str + \n to process.stderr

process.stderr.write("This is an error message\n");
console.error("This is an error message");

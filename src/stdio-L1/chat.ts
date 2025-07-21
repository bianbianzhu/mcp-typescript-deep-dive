import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { MessageParam } from "@anthropic-ai/sdk/resources";
import readline from "readline";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const anthropic = new Anthropic();

const messageHistory: MessageParam[] = [];

rl.setPrompt("user: ");
rl.prompt();

rl.on("line", async (line) => {
  if (line === "stop") {
    rl.close();
    return;
  }

  const userMessage: MessageParam = {
    role: "user",
    content: line,
  };

  messageHistory.push(userMessage);

  const responseMsg = await createMessage([...messageHistory, userMessage]);

  const aiMessage: MessageParam = {
    role: responseMsg.role,
    content: responseMsg.content,
  };

  messageHistory.push(aiMessage);

  // display purpose
  console.log(
    `Assistant: ${responseMsg.content[0].type === "text" ? responseMsg.content[0].text : "unknown"}`
  );

  rl.prompt();
});

rl.on("close", () => {
  console.log("bye");
});

const signals = ["SIGINT", "SIGTERM", "SIGHUP", "SIGTSTP"];
signals.forEach((signal) => {
  process.on(signal, () => {
    console.log(`\n${signal} received. Shutting down gracefully...`);

    // Close readline interface
    rl.close();

    console.log("Cleanup completed");
  });
});

async function createMessage(messages: MessageParam[]) {
  const response = await anthropic.messages.create({
    model: "claude-3-5-sonnet-latest",
    max_tokens: 1000,
    temperature: 0.5,
    system: "You are a helpful assistant.",
    messages,
  });

  return response;
}

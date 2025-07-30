// npm install @langchain-anthropic
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatAnthropic } from "@langchain/anthropic";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";

const multiServerMCPClient = new MultiServerMCPClient({
  mcpServers: {
    context7: {
      command: "npx",
      args: ["-y", "@upstash/context7-mcp@latest"],
    },
    "personal-mcp-server": {
      url: "http://localhost:8080/mcp",
      headers: {
        "x-api-key": "Bearer 1234567890",
        "x-mcp-toolsets": "calculate_bmi, get_weather, delete_file",
      },
    },
    "file-system": {
      command: "npx",
      args: ["tsx", "src/mcp-servers/low-level-file-system.ts"],
    },
  },
});

const llmCompatibleTools = await multiServerMCPClient.getTools();

const model = new ChatAnthropic({
  model: "claude-3-7-sonnet-latest",
});

const agent = createReactAgent({
  llm: model,
  tools: llmCompatibleTools,
});

const result = await agent.invoke({
  messages: [
    {
      role: "user",
      content: "what is the weather in sf",
    },
  ],
});

console.log(result.messages[result.messages.length - 1].content);

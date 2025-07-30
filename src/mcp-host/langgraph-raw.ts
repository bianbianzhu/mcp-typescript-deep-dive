import { ChatAnthropic } from "@langchain/anthropic";
import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import {
  Annotation,
  END,
  MemorySaver,
  messagesStateReducer,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
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

const toolNode = new ToolNode(llmCompatibleTools);

const GraphAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
});

const model = new ChatAnthropic({
  model: "claude-4-sonnet-20250514",
});

const modelWithTools = model.bindTools(llmCompatibleTools);

async function callModel(state: typeof GraphAnnotation.State) {
  const { messages } = state;

  const response = await modelWithTools.invoke(messages);

  return {
    messages: [response],
  };
}

function shouldContinue(state: typeof GraphAnnotation.State) {
  const { messages } = state;
  const lastMessage = messages[messages.length - 1] as AIMessage;

  if (lastMessage.tool_calls?.length) {
    return "tools";
  }

  return END;
}

const workflow = new StateGraph(GraphAnnotation);

workflow
  .addNode("agent", callModel)
  .addNode("tools", toolNode)
  .addEdge(START, "agent")
  .addConditionalEdges("agent", shouldContinue)
  .addEdge("tools", "agent");

const checkpointer = new MemorySaver();

const app = workflow.compile({
  checkpointer,
});

const state = await app.invoke(
  {
    messages: [new HumanMessage("what are the tools available?")],
  },
  {
    configurable: {
      thread_id: 1000,
    },
  }
);

console.log(state.messages[state.messages.length - 1].content);

const state2 = await app.invoke(
  {
    messages: [
      new HumanMessage(
        "read the file cities.txt under src folder and use the 1st city name to search the weather"
      ),
    ],
  },
  {
    configurable: {
      thread_id: 1000,
    },
  }
);

console.log(state2.messages[state2.messages.length - 1].content);

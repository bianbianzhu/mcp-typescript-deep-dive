import Anthropic from "@anthropic-ai/sdk";
import { MessageParam, Tool } from "@anthropic-ai/sdk/resources";

const anthropic = new Anthropic();

// Define tools
const tools: Tool[] = [
  {
    name: "get_weather",
    description: "Get the current weather in a given location",
    input_schema: {
      type: "object",
      properties: {
        location: {
          type: "string",
          description: "The city and state, e.g. San Francisco, CA",
        },
      },
      required: ["location"],
    },
  },
  {
    name: "get_time",
    description: "Get the current time in a given timezone",
    input_schema: {
      type: "object",
      properties: {
        timezone: {
          type: "string",
          description: "The timezone, e.g. America/New_York",
        },
      },
      required: ["timezone"],
    },
  },
];

// Initial request
const response = await anthropic.messages.create({
  model: "claude-opus-4-20250514",
  max_tokens: 1024,
  tools,
  messages: [
    {
      role: "user",
      content: "What's the weather in SF and NYC, and what time is it there?",
    },
  ],
});

// Build conversation with tool results
const messages: MessageParam[] = [
  {
    role: "user",
    content: "What's the weather in SF and NYC, and what time is it there?",
  },
  {
    role: "assistant",
    content: response.content, // Contains multiple tool_use blocks
  },
  {
    role: "user",
    content: [
      {
        type: "tool_result",
        tool_use_id: "toolu_01", // Must match the ID from tool_use
        content: "San Francisco: 68°F, partly cloudy",
      },
      {
        type: "tool_result",
        tool_use_id: "toolu_02",
        content: "New York: 45°F, clear skies",
      },
      {
        type: "tool_result",
        tool_use_id: "toolu_03",
        content: "San Francisco time: 2:30 PM PST",
      },
      {
        type: "tool_result",
        tool_use_id: "toolu_04",
        content: "New York time: 5:30 PM EST",
      },
    ],
  },
];

// Get final response
const finalResponse = await anthropic.messages.create({
  model: "claude-opus-4-20250514",
  max_tokens: 1024,
  tools,
  temperature: 0.5,
  messages,
});

console.log(finalResponse.content[0]);

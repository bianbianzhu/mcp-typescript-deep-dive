import { FastMCP } from "fastmcp";
import fs from "fs/promises";
import z from "zod";

const fastmcp = new FastMCP({
  name: "example-server",
  version: "1.0.0",
});

// add a resource
fastmcp.addResource({
  load: async () => {
    const appConfig = await fs.readFile("src/data/app-config.json", "utf-8");
    return {
      text: appConfig,
    };
  },
  mimeType: "application/json",
  name: "app-config",
  uri: "file:///app-config.json",
});

// add resource template
fastmcp.addResourceTemplate({
  arguments: [
    {
      description: "Name of the log",
      name: "name",
      required: true,
    },
    {
      description: "timestamp of the log",
      name: "timestamp",
      required: false,
    },
  ],
  load: async ({ name, timestamp }) => {
    return {
      text: `Example log content for ${name} ${timestamp}`,
    };
  },
  mimeType: "text/plain",
  name: "Logs",
  uriTemplate: "file:///logs/{name}.log",
});

// add resource template with complete function
fastmcp.addResourceTemplate({
  arguments: [
    {
      complete: async (value) => {
        if (value === "123") {
          return {
            values: ["123456"],
          };
        }

        return {
          values: [],
        };
      },
      description: "ID of the issue",
      name: "issueId",
    },
  ],
  load: async ({ issueId }) => {
    return {
      text: `Issue ${issueId}`,
    };
  },
  mimeType: "text/plain",
  name: "Issue",
  uriTemplate: "issue:///{issueId}",
});

// tool that embeds a resource
fastmcp.addTool({
  description: "Get application logs",
  execute: async () => {
    return {
      content: [
        {
          resource: await fastmcp.embedded("file:///app-config.json"),
          type: "resource",
        },
      ],
    };
  },
  name: "get_app_config",
  parameters: z.object({}),
});

fastmcp.start({
  transportType: "stdio",
});

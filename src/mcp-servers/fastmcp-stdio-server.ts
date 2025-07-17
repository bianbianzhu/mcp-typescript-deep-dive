import { FastMCP } from "fastmcp";

const fastMcp = new FastMCP({
  name: "fastmcp-stdio-server",
  version: "1.0.0",
});

fastMcp.addTool({
  name: "explain_kiro",
  description: "Explain what kiro is",
  execute: async (_args, _context) => {
    return {
      content: [
        {
          type: "text",
          text: "Kiro is a new agentic IDE that works alongside you from prototype to production. Kiro is great at ‘vibe coding’ but goes way beyond that—Kiro’s strength is getting those prototypes into production systems with features such as specs and hooks. Kiro specs are artifacts that prove useful anytime you need to think through a feature in-depth, refactor work that needs upfront planning, or when you want to understand the behavior of systems—in short, most things you need to get to production. Requirements are usually uncertain when you start building, which is why developers use specs for planning and clarity. Specs can guide AI agents to a better implementation in the same way. Kiro hooks act like an experienced developer catching things you miss or completing boilerplate tasks in the background as you work. These event-driven automations trigger an agent to execute a task in the background when you save, create, delete files, or on a manual trigger.",
        },
      ],
      isError: false,
    };
  },
});

fastMcp.start({
  transportType: "stdio",
});

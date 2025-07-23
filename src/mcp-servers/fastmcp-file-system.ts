import { FastMCP } from "fastmcp";

const fastMCP = new FastMCP({
  name: "fastmcp-file-system",
  version: "1.0.0",
  ping: {
    enabled: true,
  },
});

fastMCP.start({
  transportType: "httpStream",
  httpStream: {
    port: 8765,
  },
});

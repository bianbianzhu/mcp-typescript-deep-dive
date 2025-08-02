import "dotenv/config";
import { z } from "zod";
import { DEFAULT_PORT, DEFAULT_TRANSPORT } from "./constants.js";
import { authTokenSchema, portSchema, transportSchema } from "./schema.js";

export function parseArgs() {
  const args = process.argv.slice(2);
  let transport: z.infer<typeof transportSchema> = DEFAULT_TRANSPORT;
  let port: number = DEFAULT_PORT;
  let authToken: string = process.env.NOTION_AUTH_TOKEN ?? "";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const hasNextArg = i + 1 < args.length;

    if (arg === "--transport" && hasNextArg) {
      const value = args[i + 1].toLowerCase();
      transport = transportSchema.parse(value);

      i++; // skip the next argument
    } else if (arg === "--port" && hasNextArg) {
      const value = parseInt(args[i + 1], 10);
      const parsed = portSchema.parse(value);

      port = parsed;
      i++; // skip the next argument
    } else if (arg === "--auth-token" && hasNextArg) {
      const value = args[i + 1];
      const parsed = authTokenSchema.parse(value);

      authToken = parsed;
      i++; // skip the next argument
    } else if (arg === "--help") {
      console.log(`Usage: Notion-mcp-server
            
            Options:
            --transport <transport> 
            --port <port>
            --auth-token <token>
            --help
            `);
      process.exit(0);
    }
  }

  return { transportType: transport, port, authToken };
}

import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url"; // For ES Modules __dirname equivalent

class Logger {
  info(message: string) {
    console.log(`[INFO] ${message}`);
  }

  error(message: string) {
    console.error(`[ERROR] ${message}`);
  }

  debug(message: string) {
    console.debug(`[DEBUG] ${message}`);
  }

  warn(message: string) {
    console.warn(`[WARN] ${message}`);
  }
}

const server = new McpServer({
  name: "example-server",
  version: "1.0.0",
});

const logger = new Logger();

// Get directory relative to the current module file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, "../data"); // Example: data dir sibling to src

logger.info(`Current file: ${__filename}`);
logger.info(`Current directory: ${__dirname}`);
logger.info(`Data directory: ${DATA_DIR}`);

// Ensure data directory exists
// try {
//   await fs.mkdir(DATA_DIR, { recursive: true });
//   logger.info(`Data directory ensured: ${DATA_DIR}`);
// } catch (error) {
//   logger.error(`Failed to create data directory ${DATA_DIR}: ${error}`);
//   // Decide if this is a fatal error for the server
// }

// Static resource example
server.registerResource(
  "app-config", // Unique name for this resource registration
  "config://app", // The URI clients will use
  {
    title: "digital Agent Config",
    description: "Digital Agent Config",
    mimeType: "application/json",
  },
  async (uri) => {
    // Handler function
    logger.debug(`Reading resource: ${uri.href}`);
    // load if from the json file
    const configData = await fs.readFile(
      path.join(DATA_DIR, "app-config.json"),
      "utf-8"
    );

    return {
      contents: [
        {
          uri: uri.href, // Echo back the requested URI
          mimeType: "application/json", // Specify the content type
          text: JSON.stringify(configData, null, 2), // The actual content
        },
      ],
    };
  }
);

// Dynamic resource template for files in DATA_DIR
server.registerResource(
  "data-files", // Resource group name
  new ResourceTemplate("src/data/{filename}", {
    // URI Template
    // List function: returns available resources matching the template
    list: async () => {
      logger.debug(`Listing resources for template: file:///data/{filename}`);
      logger.debug(`Looking in directory: ${DATA_DIR}`);
      try {
        const files = await fs.readdir(DATA_DIR);
        logger.debug(`Found files: ${files.join(", ")}`);
        const resourceList = await Promise.all(
          files.map(async (file) => {
            const filePath = path.join(DATA_DIR, file);
            try {
              const stats = await fs.stat(filePath);
              if (stats.isFile()) {
                // Basic MIME type detection (can be improved)
                const mimeType =
                  path.extname(file) === ".txt"
                    ? "text/plain"
                    : "application/octet-stream";
                const resource = {
                  uri: `file:///data/${file}`,
                  name: file,
                  mimeType: mimeType,
                  _meta: {
                    size: stats.size,
                  },
                };
                logger.debug(`Added resource: ${resource.uri}`);
                return resource;
              }
            } catch (statError: any) {
              // Ignore files that disappear or access errors
              if (statError.code !== "ENOENT") {
                logger.warn(
                  `Could not stat file ${filePath}: ${statError.message}`
                );
              }
            }
            return null;
          })
        );
        const validResources = resourceList.filter((r) => r !== null);
        logger.info(
          `Found ${validResources.length} data files: ${validResources.map((r) => r?.uri).join(", ")}`
        );
        return {
          resources: validResources,
        };
      } catch (error: any) {
        logger.error(`Error listing data files: ${error.message}`);
        return { resources: [] }; // Return empty resources list on error
      }
    },
    // Define subscribe/unsubscribe if needed (see Advanced Features)
    // subscribe: async (uri, params) => { /* ... */ },
    // unsubscribe: async (uri, params) => { /* ... */ },
  }),
  {
    title: "data-files",
    description: "data-files",
    mimeType: "application/json",
  },
  // Read function: handles 'resources/read' for URIs matching the template
  async (uri, params) => {
    // params contains matched template variables, e.g., { filename: '...' }
    const filename = params.filename;
    logger.debug(`Reading resource: ${uri.href} (filename: ${filename})`);
    logger.debug(`DATA_DIR: ${DATA_DIR}`);
    logger.debug(`Template params: ${JSON.stringify(params)}`);

    if (!filename || typeof filename !== "string") {
      logger.error(`Invalid filename parameter: ${filename}`);
      throw new Error("Invalid or missing filename parameter in URI");
    }

    // IMPORTANT: Prevent path traversal attacks
    const requestedPath = path.join(DATA_DIR, filename);
    const resolvedDataDir = path.resolve(DATA_DIR);
    const resolvedRequestedPath = path.resolve(requestedPath);

    logger.debug(`Requested path: ${requestedPath}`);
    logger.debug(`Resolved data dir: ${resolvedDataDir}`);
    logger.debug(`Resolved requested path: ${resolvedRequestedPath}`);

    if (
      !resolvedRequestedPath.startsWith(resolvedDataDir + path.sep) &&
      resolvedRequestedPath !== resolvedDataDir
    ) {
      logger.error(`Access denied: Path traversal attempt: ${requestedPath}`);
      throw new Error("Access denied: Invalid path");
    }

    try {
      // Check if file exists first
      const stats = await fs.stat(requestedPath);
      if (!stats.isFile()) {
        logger.error(`Not a file: ${requestedPath}`);
        throw new Error(`Resource is not a file: ${uri.href}`);
      }

      const fileContents = await fs.readFile(requestedPath); // Read as buffer
      const mimeType =
        path.extname(filename) === ".txt"
          ? "text/plain"
          : "application/octet-stream";

      logger.info(
        `Successfully read file: ${requestedPath} (${stats.size} bytes)`
      );

      return {
        contents: [
          {
            uri: uri.href, // Use the full URI from the request
            mimeType: mimeType,
            blob: fileContents.toString("base64"), // Send content as base64 blob
            size: stats.size,
          },
        ],
      };
    } catch (error: any) {
      if (error.code === "ENOENT") {
        logger.error(`File not found: ${requestedPath}`);
        logger.error(`Available files in ${DATA_DIR}:`);
        try {
          const files = await fs.readdir(DATA_DIR);
          files.forEach((file) => logger.error(`  - ${file}`));
        } catch (readDirError) {
          logger.error(`  Could not list directory: ${readDirError}`);
        }
        throw new Error(`Resource not found: ${uri.href}`); // Specific error
      }
      logger.error(`Error reading file ${requestedPath}: ${error.message}`);
      throw new Error(`Error reading resource: ${error.message}`);
    }
  }
);
// Optional: To notify clients of dynamic resource list changes:
// server.sendResourceListChanged();

const transport = new StdioServerTransport();

server.connect(transport);

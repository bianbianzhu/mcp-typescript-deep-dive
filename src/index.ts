import "dotenv/config";
import { FastMCP, imageContent, audioContent, UserError } from "fastmcp";
import { z } from "zod";
import { existsSync } from "fs";
import { readFile } from "fs/promises";

const server = new FastMCP({
  name: "test-server",
  version: "0.0.1",
  authenticate: async (request) => {
    const authHeader = request.headers["x-api-key"];

    if (
      !authHeader ||
      typeof authHeader !== "string" ||
      !authHeader.startsWith("Bearer ")
    ) {
      throw new Response(null, {
        status: 401,
        statusText: "No API key provided or invalid format",
      });
    }

    const token = authHeader.substring(7);

    if (token !== "1234567890" && token !== "abc") {
      throw new Response(null, {
        status: 401,
        statusText: "Unauthorized",
      });
    }

    return {
      id: token === "1234567890" ? crypto.randomUUID() : "abc",
    };
  },
});

server.addTool({
  name: "add",
  description: "Add two numbers",
  parameters: z.object({
    a: z.number().int().describe("The first number to add"),
    b: z.number().int().describe("The second number to add"),
  }),
  execute: async (args) => {
    return String(args.a + args.b);
  },
});

// Simple tool with parameters defined in zod
server.addTool({
  name: "calculate_bmi", // Tool Name
  description:
    "Calculate the BMI (Body Mass Index) of a person. The input is the height and weight of the person. The output is the BMI value (a number).", // Tool Description
  parameters: z.object({
    heightMeters: z.number().describe("The height of the person in meters"),
    weightKg: z.number().describe("The weight of the person in kilograms"),
  }), // Input schema shape (zod)
  execute: async (args, context) => {
    const { heightMeters, weightKg } = args; // Validated arguments
    const { log } = context;

    log.debug(`Executing calculate_bmi with args: ${JSON.stringify(args)}`);
    const bmi = weightKg / (heightMeters * heightMeters);
    log.info(`BMI for ${heightMeters}m and ${weightKg}kg is ${bmi}`);

    // On execution error, Error response:
    if (bmi < 0) {
      return {
        content: [
          {
            type: "text",
            text: "Error: BMI cannot be negative",
          },
        ],
        isError: true,
      };
    }

    // Success response
    return {
      content: [
        {
          type: "text",
          text: `BMI: ${bmi.toFixed(2)}`,
        },
      ],
      isError: false,
    };
  }, // Handler function receives validated arguments
  annotations: {
    title: "Get your BMI",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  }, // Tool annotations
});

const openweatherApiKey = process.env.OPENWEATHER_API_KEY ?? "";

// Async tool that fetches external data
server.addTool({
  name: "get_weather", // Tool Name
  description:
    "Get weather information for a specific city. The input is the city name. The output is the weather information for the city.", // Tool Description
  parameters: z.object({
    city: z.string().min(1).describe("The name of the city"),
  }), // Input schema shape (zod)
  execute: async (args, context) => {
    const { city } = args;
    const { log } = context;

    log.debug(`Executing get_weather with args: ${JSON.stringify(args)}`);

    // API call to openweather api
    const encodedCity = encodeURIComponent(city);
    const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodedCity}&appid=${openweatherApiKey}`;

    try {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.text(); // use text() to get the raw JSON response
      log.info(`Successfully fetched weather data for ${city}`);

      // Success response
      return {
        content: [
          {
            type: "text",
            text: data,
          },
        ],
        isError: false,
      };
    } catch (err) {
      // On execution error, Error response:
      log.error(`Error fetching weather data: ${err}`);

      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      return {
        content: [
          {
            type: "text",
            text: `Error fetching weather data: ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  }, // Handler function receives validated arguments
  annotations: {
    title: "Get weather information",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  }, // Tool annotations
});

// For testing the context.session
server.addTool({
  name: "delete_file", // internal identifier
  description: "Permanently deletes a file at the given path.",
  parameters: z.object({
    path: z.string().describe("The path of the file to delete"),
  }), // validated input schema
  annotations: {
    title: "Delete File", // human-readable title
    readOnlyHint: false, // ⚠️ MUST BE FALSE (default is false)
    destructiveHint: true, // indicates irreversible change
    openWorldHint: false, // not affect external resources
  },
  execute: async (args, context) => {
    // context.log;
    // context.reportProgress;
    const { session } = context;

    if (!session) {
      throw new Response(null, {
        status: 401,
        statusText: "Unauthorized",
      });
    }

    // console.log("The context session is: ", context.session);

    // … your deletion logic here …
    // e.g. await fs.unlink(args.path);
    return {
      content: [
        {
          type: "text",
          text: `Deleted: ${args.path} and context session id is ${session.id})}`,
        },
      ],
      isError: false,
    };
  },
});

server.addTool({
  name: "sayHello",
  execute: async (_args, { session }) => {
    return `Hello, ${session?.id}!`;
  },
});

// For testing the progress reporting
server.addTool({
  name: "download_file",
  description: "Download a file from the internet",
  parameters: z.object({
    url: z.string().describe("The URL of the file to download"),
  }),
  execute: async (args, { reportProgress }) => {
    const { url } = args;

    try {
      await reportProgress({
        progress: 0,
        total: 100,
      });

      await sleep(1000); // mock downloading time

      await reportProgress({
        progress: 55,
        total: 100,
      });

      await sleep(1000); // mock downloading time

      await reportProgress({
        progress: 90,
        total: 100,
      });

      await sleep(1000); // mock the internet connection ping time

      await reportProgress({
        progress: 100,
        total: 100,
      });

      // await sleep(0); // NOT LONGER NEEDED: to make sure progress 100 is shown

      return {
        content: [
          {
            type: "text",
            text:
              `Download from ${url} completed: ` +
              "This is a story about a cat",
          },
        ],
        isError: false,
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: "Error downloading file",
          },
        ],
        isError: true,
      };
    }
  },
});

// for testing the context.log
server.addTool({
  name: "load_data_from_db",
  description: "Load data from the database",
  parameters: z.object({
    query: z.string().describe("The query to load data from the database"),
  }),
  annotations: {
    title: "Load data from the database",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  execute: async (args, { log }) => {
    const { query } = args;
    log.info(`Loading data from the database with query`, { query });

    await sleep(1000); // mock the database query time
    log.debug("Technical details: ", {
      query,
      queryResult: "xxxx",
      database: "postgres",
      connection: "localhost:5432",
    });

    log.warn("Minor issue occurred");

    log.error("Failed to connect to the database", {
      connection: "localhost:5432",
    });

    return "Data loaded from the database";
  },
});

// for testing the execute return types
server.addTool({
  name: "generate_audio",
  description: "Generate audio from text",
  parameters: z.object({
    text: z.string().describe("The text to generate audio from"),
  }),
  execute: async (args, { log, reportProgress }) => {
    const { text } = args;
    log.info(`Executing generate_audio`, { text });

    reportProgress({
      progress: 0,
      total: 100,
    });

    await sleep(1000); // mock the audio generation time

    reportProgress({
      progress: 100,
      total: 100,
    });

    await sleep(0); // to make sure progress 100 is shown

    return {
      content: [
        {
          type: "audio",
          mimeType: "audio/mpeg",
          data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
        },
        {
          type: "text",
          text: "Audio generated successfully",
        },
        {
          type: "image",
          mimeType: "image/png",
          data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
        },
      ],
      isError: false,
    };
  },
});

// for testing the imageContent helper function
server.addTool({
  name: "generate_image",
  description: "Generate an image from various resources",
  parameters: z.object({
    url: z.string().optional().describe("The URL of the image to generate"),
    path: z.string().optional().describe("The path of the image to generate"),
    buffer: z
      .instanceof(Buffer)
      .optional()
      .describe("The buffer of the image to generate"),
  }),
  execute: async (args) => {
    const { url, path, buffer } = args;

    if (url && !path && !buffer) {
      return {
        content: [
          await imageContent({ url }),
          {
            type: "text",
            text: "Image generated successfully",
          },
        ],
        isError: false,
      };
    }

    if (path && !url && !buffer) {
      return imageContent({ path });
    }

    if (buffer && !url && !path) {
      return imageContent({ buffer });
    }

    // error response
    return {
      content: [
        {
          type: "text",
          text: "Invalid arguments: either url, path, or buffer must be provided, but only one of them can be provided",
        },
      ],
      isError: true,
    };
  },
});

// for testing the combination return types
server.addTool({
  name: "generate_image_and_text",
  description: "Generate an image and text from various resources",
  parameters: z.object({
    url: z.string().optional().describe("The URL of the image to generate"),
  }),

  execute: async (_args) => {
    const imgContent = await imageContent({
      url: "https://example.com/image.png",
    });
    const audContent = await audioContent({
      url: "https://example.com/audio.mp3",
    });
    return {
      content: [
        {
          type: "text",
          text: "Hello, world!",
        },
        imgContent,
        audContent,
      ],
      isError: false,
    };
  },
});

server.addTool({
  name: "readFile",
  description: "Read a file from the file system",
  parameters: z.object({
    path: z.string().min(1),
  }),
  execute: async (args, { log }) => {
    try {
      // Check for user permission issues
      if (args.path.includes("../")) {
        // throw new UserError("Path traversal is not allowed");

        return {
          content: [
            {
              type: "text",
              text: "Path traversal is not allowed (using isError)",
            },
          ],
          isError: true,
        };
      }

      if (!existsSync(args.path)) {
        throw new UserError(`File not found: ${args.path}`);
      }

      // Attempt to read the file
      const content = await readFile(args.path, "utf-8");

      return {
        content: [
          {
            type: "text",
            text: content,
          },
        ],
        isError: false,
      };
    } catch (error) {
      // If it's already a UserError, let it propagate
      if (error instanceof UserError) {
        throw error;
      }

      // if the error is not a UserError, log it
      // Log internal errors for debugging
      log.error(`Failed to read file: ${args.path}`, {
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      });

      // And return a sanitized error to the user
      throw new UserError("An error occurred while reading the file");
    }
  },
});

server.addTool({
  name: "get_process_info",
  description:
    "Get fundamental process information - good to test STDIO: Each npx tsx src/index.ts creates a separate process (server) with exactly 1 session",
  execute: async (_args, _context) => {
    const processId = process.pid;
    const sessionCount = server.sessions.length; // sessions are created when a new connection is established
    const uptime = process.uptime();
    const memoryUsage = process.memoryUsage();

    return {
      content: [
        {
          type: "text",
          text: `🔍 PROCESS INFO:
Process ID (PID): ${processId}
Total Sessions: ${sessionCount}
Uptime: ${uptime.toFixed(2)}s
Memory RSS: ${(memoryUsage.rss / 1024 / 1024).toFixed(2)}MB
Started at: ${new Date().toISOString()}`,
        },
      ],
      isError: false,
    };
  },
});

(async () => {
  try {
    const signals = ["SIGINT", "SIGTERM", "SIGHUP", "SIGTSTP"];
    signals.forEach((signal) => {
      process.on(signal, async () => {
        console.log(`\n${signal} received. Shutting down gracefully...`);
        await server.stop();
        console.log("Server stopped successfully");
        process.exit(0);
      });
    });

    // Start the server
    // server.start({
    //   transportType: "stdio",
    // });

    server.start({
      transportType: "httpStream",
      httpStream: {
        port: 8080,
        // endpoint: "/api/mcp",
      },
    });
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
})();

// sleep function accepts a number of milliseconds and returns a promise that resolves after the given times
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

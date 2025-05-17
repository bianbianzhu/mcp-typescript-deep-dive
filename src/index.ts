import { FastMCP } from "fastmcp";
import { z } from "zod";

const server = new FastMCP({
  name: "test-server",
  version: "0.0.1",
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

// Start the server
server.start({
  transportType: "stdio",
});

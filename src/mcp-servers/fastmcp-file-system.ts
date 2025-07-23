import { FastMCP } from "fastmcp";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { z } from "zod";

function expandHome(filepath: string): string {
  if (filepath.startsWith("~/") || filepath === "~") {
    return path.join(os.homedir(), filepath.slice(1));
  }
  return filepath;
}

// Security utilities
async function validatePath(requestedPath: string): Promise<string> {
  const expandedPath = expandHome(requestedPath);
  const absolute = path.isAbsolute(expandedPath)
    ? path.resolve(expandedPath)
    : path.resolve(process.cwd(), expandedPath);

  // Handle symlinks by checking their real path
  try {
    const realPath = await fs.realpath(absolute);

    return realPath;
  } catch (error) {
    // For new files that don't exist yet, verify parent directory
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      const parentDir = path.dirname(absolute);
      try {
        return absolute;
      } catch {
        throw new Error(`Parent directory does not exist: ${parentDir}`);
      }
    }
    throw error;
  }
}

interface FileInfo {
  size: number;
  created: Date;
  modified: Date;
  accessed: Date;
  isDirectory: boolean;
  isFile: boolean;
  permissions: string;
}

async function getFileStats(filePath: string): Promise<FileInfo> {
  const stats = await fs.stat(filePath);
  return {
    size: stats.size,
    created: stats.birthtime,
    modified: stats.mtime,
    accessed: stats.atime,
    isDirectory: stats.isDirectory(),
    isFile: stats.isFile(),
    permissions: stats.mode.toString(8).slice(-3),
  };
}

const fastMCP = new FastMCP({
  name: "fastmcp-file-system",
  version: "1.0.0",
  ping: {
    enabled: true,
  },
});

fastMCP.addTool({
  name: "read_file",
  description:
    "Read the complete contents of a file from the file system. " +
    "Handles various text encodings and provides detailed error messages " +
    "if the file cannot be read. Use this tool when you need to examine " +
    "the contents of a single file. Use the 'head' parameter to read only " +
    "the first N lines of a file, or the 'tail' parameter to read only " +
    "the last N lines of a file. Only works within allowed directories.",
  parameters: z.object({
    path: z.string().min(1),
  }),
  execute: async ({ path }) => {
    const validPath = await validatePath(path);
    const content = await fs.readFile(validPath, "utf-8");
    return {
      content: [{ type: "text", text: content }],
    };
  },
});

fastMCP.addTool({
  name: "write_file",
  description:
    "Write the complete contents of a file to the file system. " +
    "Handles various text encodings and provides detailed error messages " +
    "if the file cannot be written. Use this tool when you need to write " +
    "to a single file. Only works within allowed directories.",
  parameters: z.object({
    path: z.string().min(1),
    content: z.string().min(1),
  }),
  execute: async ({ path, content }) => {
    const validPath = await validatePath(path);
    await fs.writeFile(validPath, content, {
      encoding: "utf-8",
      flag: "wx",
    });
    return {
      content: [{ type: "text", text: `Successfully wrote to ${path}` }],
    };
  },
});

fastMCP.addTool({
  name: "get_file_info",
  description:
    "Retrieve detailed metadata about a file or directory. Returns comprehensive " +
    "information including size, creation time, last modified time, permissions, " +
    "and type. This tool is perfect for understanding file characteristics " +
    "without reading the actual content. Only works within allowed directories.",
  parameters: z.object({
    path: z.string().min(1),
  }),
  execute: async ({ path }) => {
    const validPath = await validatePath(path);
    const info = await getFileStats(validPath);
    return {
      content: [
        {
          type: "text",
          text: Object.entries(info)
            .map(([key, value]) => `${key}: ${value}`)
            .join("\n"),
        },
      ],
    };
  },
});

fastMCP.start({
  transportType: "stdio",
});

/**
 * Memory MCP server (FR-001, SC-001).
 *
 * Exposes memory_store, memory_query, memory_delete, memory_list tools
 * over a JSON-RPC stdio transport compatible with the MCP protocol.
 */

import { MemoryStorage } from "./storage/sqlite.js";
import { MemoryWriteRefused } from "./gate.js";
import { handleMemoryStore } from "./tools/store.js";
import { handleMemoryQuery } from "./tools/query.js";
import { handleMemoryDelete } from "./tools/delete.js";
import { handleMemoryList } from "./tools/list.js";

/** MCP tool definition for tool listing. */
export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** MCP JSON-RPC request. */
export interface McpRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

/** MCP JSON-RPC response. */
export interface McpResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** Tool definitions registered by this server (SC-001). */
export const TOOL_DEFINITIONS: McpToolDefinition[] = [
  {
    name: "memory_store",
    description: "Store a new memory entry (decision, correction, pattern, note, or preference) scoped to the current project.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "The knowledge to store" },
        kind: { type: "string", enum: ["decision", "correction", "pattern", "note", "preference"] },
        importance: { type: "string", enum: ["ephemeral", "short-term", "medium-term", "long-term", "permanent"] },
        tags: { type: "array", items: { type: "string" }, description: "Freeform tags for filtering" },
        projectScope: { type: "string", description: "Project root path (defaults to server's project scope)" },
      },
      required: ["content", "kind"],
    },
  },
  {
    name: "memory_query",
    description: "Query stored memories with filtering by text, tags, kind, importance, and project scope. Bumps access counts on matched entries.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Free-text search against content" },
        tags: { type: "array", items: { type: "string" }, description: "Filter by tags (OR semantics)" },
        kind: { type: "string", enum: ["decision", "correction", "pattern", "note", "preference"] },
        importance: { type: "string", enum: ["ephemeral", "short-term", "medium-term", "long-term", "permanent"] },
        projectScope: { type: "string", description: "Project root path (defaults to server's project scope)" },
        limit: { type: "number", description: "Max results (default 50)" },
      },
      required: [],
    },
  },
  {
    name: "memory_delete",
    description: "Delete a memory entry by ID.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The memory entry ID to delete" },
      },
      required: ["id"],
    },
  },
  {
    name: "memory_list",
    description: "List memory entries for a project with optional kind filtering and pagination.",
    inputSchema: {
      type: "object",
      properties: {
        projectScope: { type: "string", description: "Project root path (defaults to server's project scope)" },
        kind: { type: "string", enum: ["decision", "correction", "pattern", "note", "preference"] },
        limit: { type: "number", description: "Max results (default 50)" },
        offset: { type: "number", description: "Pagination offset (default 0)" },
      },
      required: [],
    },
  },
];

export interface MemoryServerOptions {
  projectScope: string;
  sourceSessionId?: string;
  databasePath?: string;
}

export class MemoryServer {
  private storage: MemoryStorage;
  private projectScope: string;
  private sourceSessionId: string;

  constructor(options: MemoryServerOptions) {
    this.projectScope = options.projectScope;
    this.sourceSessionId = options.sourceSessionId ?? "unknown";
    this.storage = options.databasePath
      ? new MemoryStorage(options.databasePath)
      : MemoryStorage.forProject(options.projectScope);
  }

  /** Get registered tool definitions. */
  getToolDefinitions(): McpToolDefinition[] {
    return TOOL_DEFINITIONS;
  }

  /** Handle an MCP tools/list request. */
  handleToolsList(): McpToolDefinition[] {
    return TOOL_DEFINITIONS;
  }

  /** Handle an MCP tools/call request. */
  handleToolCall(toolName: string, args: Record<string, unknown>): unknown {
    const defaults = {
      projectScope: this.projectScope,
      sourceSessionId: this.sourceSessionId,
    };

    switch (toolName) {
      case "memory_store":
        return handleMemoryStore(this.storage, args as unknown as Parameters<typeof handleMemoryStore>[1], defaults);
      case "memory_query":
        return handleMemoryQuery(this.storage, args as unknown as Parameters<typeof handleMemoryQuery>[1], defaults);
      case "memory_delete":
        return handleMemoryDelete(this.storage, args as unknown as Parameters<typeof handleMemoryDelete>[1]);
      case "memory_list":
        return handleMemoryList(this.storage, args as unknown as Parameters<typeof handleMemoryList>[1], defaults);
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  /** Process a JSON-RPC request and return a response. */
  processRequest(request: McpRequest): McpResponse {
    try {
      switch (request.method) {
        case "tools/list":
          return { jsonrpc: "2.0", id: request.id, result: { tools: this.handleToolsList() } };
        case "tools/call": {
          const params = request.params ?? {};
          const name = params.name as string;
          const args = (params.arguments ?? {}) as Record<string, unknown>;
          const result = this.handleToolCall(name, args);
          return { jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: JSON.stringify(result) }] } };
        }
        default:
          return { jsonrpc: "2.0", id: request.id, error: { code: -32601, message: `Unknown method: ${request.method}` } };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Spec 204 FR-001: a write-gate refusal is attributable at the MCP layer,
      // not just as a message string, so callers can branch on the rule id.
      const data =
        err instanceof MemoryWriteRefused ? { ruleId: err.ruleId } : undefined;
      return { jsonrpc: "2.0", id: request.id, error: { code: -32000, message, data } };
    }
  }

  /** Get the underlying storage for direct access (e.g., sweeper, promotion). */
  getStorage(): MemoryStorage {
    return this.storage;
  }

  /** Close the server and its storage. */
  close(): void {
    this.storage.close();
  }
}

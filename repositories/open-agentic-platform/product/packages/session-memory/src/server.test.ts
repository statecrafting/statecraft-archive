import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryServer, TOOL_DEFINITIONS } from "./server.js";
import type { McpRequest } from "./server.js";

describe("MemoryServer", () => {
  let server: MemoryServer;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "memory-server-test-"));
    server = new MemoryServer({
      projectScope: "/test-project",
      sourceSessionId: "test-session",
      databasePath: join(tempDir, "memory.db"),
    });
  });

  afterEach(() => {
    server.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("tool definitions (SC-001)", () => {
    it("registers exactly 4 tools", () => {
      const tools = server.getToolDefinitions();
      expect(tools).toHaveLength(4);
    });

    it("includes memory_store, memory_query, memory_delete, memory_list", () => {
      const names = TOOL_DEFINITIONS.map((t) => t.name);
      expect(names).toContain("memory_store");
      expect(names).toContain("memory_query");
      expect(names).toContain("memory_delete");
      expect(names).toContain("memory_list");
    });

    it("each tool has name, description, and inputSchema", () => {
      for (const tool of TOOL_DEFINITIONS) {
        expect(tool.name).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.inputSchema).toBeTruthy();
      }
    });
  });

  describe("tools/list", () => {
    it("returns tool definitions via JSON-RPC", () => {
      const req: McpRequest = { jsonrpc: "2.0", id: 1, method: "tools/list" };
      const res = server.processRequest(req);
      expect(res.error).toBeUndefined();
      const result = res.result as { tools: unknown[] };
      expect(result.tools).toHaveLength(4);
    });
  });

  describe("memory_store via tools/call", () => {
    it("stores an entry and returns it", () => {
      const req: McpRequest = {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "memory_store",
          arguments: { content: "Use ESM imports", kind: "decision", tags: ["imports"] },
        },
      };
      const res = server.processRequest(req);
      expect(res.error).toBeUndefined();
      const result = res.result as { content: { type: string; text: string }[] };
      const entry = JSON.parse(result.content[0].text);
      expect(entry.content).toBe("Use ESM imports");
      expect(entry.kind).toBe("decision");
      expect(entry.projectScope).toBe("/test-project");
      expect(entry.sourceSessionId).toBe("test-session");
    });

    it("returns error for invalid kind", () => {
      const req: McpRequest = {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "memory_store", arguments: { content: "test", kind: "invalid" } },
      };
      const res = server.processRequest(req);
      expect(res.error).toBeDefined();
      expect(res.error!.message).toContain("kind must be one of");
    });

    it("returns error for missing content", () => {
      const req: McpRequest = {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "memory_store", arguments: { kind: "note" } },
      };
      const res = server.processRequest(req);
      expect(res.error).toBeDefined();
      expect(res.error!.message).toContain("content is required");
    });
  });

  describe("memory_query via tools/call", () => {
    beforeEach(() => {
      server.handleToolCall("memory_store", { content: "Use vitest", kind: "decision", tags: ["testing"] });
      server.handleToolCall("memory_store", { content: "Actually use jest", kind: "correction", tags: ["testing"] });
      server.handleToolCall("memory_store", { content: "PascalCase for components", kind: "pattern", tags: ["naming"] });
    });

    it("queries by project scope (default)", () => {
      const req: McpRequest = {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "memory_query", arguments: {} },
      };
      const res = server.processRequest(req);
      expect(res.error).toBeUndefined();
      const entries = JSON.parse((res.result as { content: { text: string }[] }).content[0].text);
      expect(entries).toHaveLength(3);
    });

    it("filters by kind", () => {
      const req: McpRequest = {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: { name: "memory_query", arguments: { kind: "correction" } },
      };
      const res = server.processRequest(req);
      const entries = JSON.parse((res.result as { content: { text: string }[] }).content[0].text);
      expect(entries).toHaveLength(1);
      expect(entries[0].kind).toBe("correction");
    });

    it("filters by text", () => {
      const req: McpRequest = {
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "memory_query", arguments: { text: "vitest" } },
      };
      const res = server.processRequest(req);
      const entries = JSON.parse((res.result as { content: { text: string }[] }).content[0].text);
      expect(entries).toHaveLength(1);
    });

    it("filters by tags", () => {
      const req: McpRequest = {
        jsonrpc: "2.0",
        id: 8,
        method: "tools/call",
        params: { name: "memory_query", arguments: { tags: ["naming"] } },
      };
      const res = server.processRequest(req);
      const entries = JSON.parse((res.result as { content: { text: string }[] }).content[0].text);
      expect(entries).toHaveLength(1);
    });
  });

  describe("memory_delete via tools/call", () => {
    it("deletes an existing entry", () => {
      const entry = server.handleToolCall("memory_store", { content: "to delete", kind: "note" }) as { id: string };
      const req: McpRequest = {
        jsonrpc: "2.0",
        id: 9,
        method: "tools/call",
        params: { name: "memory_delete", arguments: { id: entry.id } },
      };
      const res = server.processRequest(req);
      const result = JSON.parse((res.result as { content: { text: string }[] }).content[0].text);
      expect(result.deleted).toBe(true);
    });

    it("returns false for nonexistent entry", () => {
      const req: McpRequest = {
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: { name: "memory_delete", arguments: { id: "nonexistent" } },
      };
      const res = server.processRequest(req);
      const result = JSON.parse((res.result as { content: { text: string }[] }).content[0].text);
      expect(result.deleted).toBe(false);
    });

    it("returns error for missing id", () => {
      const req: McpRequest = {
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: { name: "memory_delete", arguments: {} },
      };
      const res = server.processRequest(req);
      expect(res.error).toBeDefined();
    });
  });

  describe("memory_list via tools/call", () => {
    beforeEach(() => {
      for (let i = 0; i < 5; i++) {
        server.handleToolCall("memory_store", { content: `Entry ${i}`, kind: "note" });
      }
      server.handleToolCall("memory_store", { content: "A decision", kind: "decision" });
    });

    it("lists all entries for project", () => {
      const req: McpRequest = {
        jsonrpc: "2.0",
        id: 12,
        method: "tools/call",
        params: { name: "memory_list", arguments: {} },
      };
      const res = server.processRequest(req);
      const entries = JSON.parse((res.result as { content: { text: string }[] }).content[0].text);
      expect(entries).toHaveLength(6);
    });

    it("filters by kind", () => {
      const req: McpRequest = {
        jsonrpc: "2.0",
        id: 13,
        method: "tools/call",
        params: { name: "memory_list", arguments: { kind: "decision" } },
      };
      const res = server.processRequest(req);
      const entries = JSON.parse((res.result as { content: { text: string }[] }).content[0].text);
      expect(entries).toHaveLength(1);
    });

    it("supports pagination", () => {
      const req: McpRequest = {
        jsonrpc: "2.0",
        id: 14,
        method: "tools/call",
        params: { name: "memory_list", arguments: { limit: 2, offset: 0 } },
      };
      const res = server.processRequest(req);
      const entries = JSON.parse((res.result as { content: { text: string }[] }).content[0].text);
      expect(entries).toHaveLength(2);
    });
  });

  describe("unknown method", () => {
    it("returns error for unknown JSON-RPC method", () => {
      const req: McpRequest = { jsonrpc: "2.0", id: 15, method: "unknown/method" };
      const res = server.processRequest(req);
      expect(res.error).toBeDefined();
      expect(res.error!.code).toBe(-32601);
    });
  });

  describe("unknown tool", () => {
    it("returns error for unknown tool name", () => {
      const req: McpRequest = {
        jsonrpc: "2.0",
        id: 16,
        method: "tools/call",
        params: { name: "unknown_tool", arguments: {} },
      };
      const res = server.processRequest(req);
      expect(res.error).toBeDefined();
      expect(res.error!.message).toContain("Unknown tool");
    });
  });

  describe("persistence (SC-002)", () => {
    it("entries persist across server instances", () => {
      const dbFile = join(tempDir, "persist.db");
      const server1 = new MemoryServer({ projectScope: "/proj", databasePath: dbFile });
      server1.handleToolCall("memory_store", { content: "persistent entry", kind: "decision" });
      server1.close();

      const server2 = new MemoryServer({ projectScope: "/proj", databasePath: dbFile });
      const entries = server2.handleToolCall("memory_query", { projectScope: "/proj" }) as unknown[];
      expect(entries).toHaveLength(1);
      server2.close();
    });
  });
});

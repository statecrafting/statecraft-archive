import { describe, it, expect, beforeEach } from "vitest";
import { ToolDisplayRegistry, FALLBACK_TOOL_CONFIG } from "./registry.js";
import type { ToolDisplayConfig, ContentRenderer } from "./types.js";

function makeConfig(toolId: string, overrides?: Partial<ToolDisplayConfig>): ToolDisplayConfig {
  return {
    toolId,
    label: toolId,
    icon: "terminal",
    accentColor: "#3b82f6",
    inputDisplay: { fields: ["command"], format: "block" },
    resultDisplay: { contentRenderer: "code", maxCollapsedLines: 20 },
    collapse: { defaultState: "expanded", collapseThreshold: 50 },
    ...overrides,
  };
}

describe("ToolDisplayRegistry", () => {
  let registry: ToolDisplayRegistry;

  beforeEach(() => {
    registry = new ToolDisplayRegistry();
  });

  it("registers and retrieves a config", () => {
    const config = makeConfig("Bash");
    registry.register(config);
    expect(registry.get("Bash")).toEqual(config);
  });

  it("returns fallback for unknown tools (FR-002)", () => {
    const result = registry.get("UnknownTool");
    expect(result.toolId).toBe("UnknownTool");
    expect(result.label).toBe("UnknownTool");
    expect(result.resultDisplay.contentRenderer).toBe(FALLBACK_TOOL_CONFIG.resultDisplay.contentRenderer);
  });

  it("overwrites existing config on re-register", () => {
    registry.register(makeConfig("Bash", { accentColor: "#red" }));
    registry.register(makeConfig("Bash", { accentColor: "#blue" }));
    expect(registry.get("Bash").accentColor).toBe("#blue");
  });

  it("registerAll registers multiple configs", () => {
    registry.registerAll([makeConfig("Bash"), makeConfig("Read")]);
    expect(registry.has("Bash")).toBe(true);
    expect(registry.has("Read")).toBe(true);
  });

  it("unregister removes a config", () => {
    registry.register(makeConfig("Bash"));
    expect(registry.unregister("Bash")).toBe(true);
    expect(registry.has("Bash")).toBe(false);
    expect(registry.unregister("Bash")).toBe(false);
  });

  it("listToolIds returns all registered ids", () => {
    registry.registerAll([makeConfig("Bash"), makeConfig("Read"), makeConfig("Edit")]);
    expect(registry.listToolIds().sort()).toEqual(["Bash", "Edit", "Read"]);
  });

  it("toJSON / fromJSON round-trips (NF-003)", () => {
    const configs = [makeConfig("Bash"), makeConfig("Read")];
    registry.registerAll(configs);
    const json = registry.toJSON();
    const newRegistry = new ToolDisplayRegistry();
    newRegistry.fromJSON(json);
    expect(newRegistry.get("Bash")).toEqual(configs[0]);
    expect(newRegistry.get("Read")).toEqual(configs[1]);
  });

  it("runtime extension for MCP tools (FR-009)", () => {
    expect(registry.has("mcp_my_tool")).toBe(false);
    registry.register(makeConfig("mcp_my_tool", { label: "My MCP Tool", icon: "plug" }));
    expect(registry.has("mcp_my_tool")).toBe(true);
    expect(registry.get("mcp_my_tool").label).toBe("My MCP Tool");
  });

  describe("content renderers", () => {
    it("registers and retrieves a content renderer (FR-005)", () => {
      const renderer: ContentRenderer = {
        id: "code",
        render: () => null,
      };
      registry.registerContentRenderer(renderer);
      expect(registry.getContentRenderer("code")).toBe(renderer);
    });

    it("returns undefined for unknown renderer", () => {
      expect(registry.getContentRenderer("unknown")).toBeUndefined();
    });

    it("lists content renderer ids", () => {
      registry.registerContentRenderer({ id: "code", render: () => null });
      registry.registerContentRenderer({ id: "diff", render: () => null });
      expect(registry.listContentRendererIds().sort()).toEqual(["code", "diff"]);
    });
  });
});

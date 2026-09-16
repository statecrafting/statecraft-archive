import { describe, it, expect } from "vitest";
import { defaultToolConfigs } from "./defaults.js";
import { ToolDisplayRegistry } from "../registry.js";

describe("defaultToolConfigs", () => {
  it("provides configs for 7 standard tools", () => {
    expect(defaultToolConfigs).toHaveLength(7);
  });

  it("covers Bash, Read, Edit, Write, Glob, Grep, MCP", () => {
    const ids = defaultToolConfigs.map((c) => c.toolId).sort();
    expect(ids).toEqual(["Bash", "Edit", "Glob", "Grep", "MCP", "Read", "Write"]);
  });

  it("all configs have required fields", () => {
    for (const config of defaultToolConfigs) {
      expect(config.toolId).toBeTruthy();
      expect(config.label).toBeTruthy();
      expect(config.icon).toBeTruthy();
      expect(config.accentColor).toBeTruthy();
      expect(config.inputDisplay).toBeTruthy();
      expect(config.resultDisplay).toBeTruthy();
      expect(config.collapse).toBeTruthy();
    }
  });

  it("Bash config uses inline input with command field (SC-001)", () => {
    const bash = defaultToolConfigs.find((c) => c.toolId === "Bash")!;
    expect(bash.inputDisplay.fields).toContain("command");
    expect(bash.inputDisplay.format).toBe("inline");
    expect(bash.resultDisplay.contentRenderer).toBe("code");
  });

  it("Edit config uses diff renderer (SC-002)", () => {
    const edit = defaultToolConfigs.find((c) => c.toolId === "Edit")!;
    expect(edit.resultDisplay.contentRenderer).toBe("diff");
  });

  it("all configs register without error (NF-001, SC-006)", () => {
    const registry = new ToolDisplayRegistry();
    registry.registerAll(defaultToolConfigs);
    expect(registry.listToolIds()).toHaveLength(7);
  });

  it("adding new tool requires only a config entry (NF-001, SC-006)", () => {
    const registry = new ToolDisplayRegistry();
    registry.registerAll(defaultToolConfigs);

    // Add a custom tool - no changes to renderer core needed
    registry.register({
      toolId: "CustomTool",
      label: "Custom Tool",
      icon: "star",
      accentColor: "#10b981",
      inputDisplay: { fields: ["query"], format: "inline" },
      resultDisplay: { contentRenderer: "json", maxCollapsedLines: 20 },
      collapse: { defaultState: "expanded", collapseThreshold: 30 },
    });

    expect(registry.listToolIds()).toHaveLength(8);
    expect(registry.get("CustomTool").label).toBe("Custom Tool");
  });

  it("configs are JSON-serializable (NF-003)", () => {
    const json = JSON.stringify(defaultToolConfigs);
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(7);
    expect(parsed[0].toolId).toBe(defaultToolConfigs[0].toolId);
  });
});

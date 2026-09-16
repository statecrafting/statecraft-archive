// SPDX-License-Identifier: AGPL-3.0-or-later
// Feature: 071-skill-command-factory

import { describe, expect, it } from "vitest";
import { DefaultToolFilter, computeEffectiveTools } from "./filter.js";

describe("DefaultToolFilter", () => {
  const allTools = ["Bash", "FileRead", "FileWrite", "Grep", "Glob", "Edit"];

  it("returns all permitted tools when allowed_tools is *", () => {
    const filter = new DefaultToolFilter();
    const result = filter.filter("*", allTools);
    expect(result).toEqual(allTools);
  });

  it("returns intersection of allowed and available tools", () => {
    const filter = new DefaultToolFilter();
    const result = filter.filter(["Bash", "FileRead", "Grep"], allTools);
    expect(result).toEqual(["Bash", "FileRead", "Grep"]);
  });

  it("excludes denied tools even with * allowed (NF-003, SC-002)", () => {
    const filter = new DefaultToolFilter(["FileWrite", "Edit"]);
    const result = filter.filter("*", allTools);
    expect(result).toEqual(["Bash", "FileRead", "Grep", "Glob"]);
  });

  it("excludes denied tools from explicit allow list", () => {
    const filter = new DefaultToolFilter(["FileWrite"]);
    const result = filter.filter(["Bash", "FileWrite", "Grep"], allTools);
    expect(result).toEqual(["Bash", "Grep"]);
  });

  it("returns empty array when all allowed tools are denied", () => {
    const filter = new DefaultToolFilter(["Bash"]);
    const result = filter.filter(["Bash"], allTools);
    expect(result).toEqual([]);
  });

  it("ignores allowed tools not in allTools", () => {
    const filter = new DefaultToolFilter();
    const result = filter.filter(["Bash", "NonExistent"], allTools);
    expect(result).toEqual(["Bash"]);
  });
});

describe("computeEffectiveTools", () => {
  it("is a convenience wrapper over DefaultToolFilter", () => {
    const result = computeEffectiveTools(
      ["Bash", "FileRead"],
      ["Bash", "FileRead", "FileWrite"],
      ["FileWrite"],
    );
    expect(result).toEqual(["Bash", "FileRead"]);
  });
});

// Spec 120 FR-002: the vocabulary matches the contract fixture; the
// requirement derivation over each profile shape; the decision refuses on
// any missing required token and lists every missing preferred one.

import { test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import {
  CAPABILITIES,
  NO_REQUIREMENTS,
  REQUEST_CAPABILITIES,
  decide,
  isCapability,
  orderedCapabilities,
  parseCapabilityList,
  parseRequirements,
  requestedCapabilities,
  requirementsFor,
  requirementsPayload,
  tierFor,
} from "./capabilities";

const FIXTURE = join(import.meta.dir, "..", "..", "..", "crates", "statecraft-contract", "fixtures", "capabilities.json");

test("B-1: the vocabulary is the contract crate's, in wire order", () => {
  expect(JSON.parse(readFileSync(FIXTURE, "utf8"))).toEqual([...CAPABILITIES]);
  expect(CAPABILITIES.length).toBe(6);
  for (const c of CAPABILITIES) expect(isCapability(c)).toBe(true);
  expect(isCapability("sandbox")).toBe(false);
  expect(isCapability(3)).toBe(false);
  expect(REQUEST_CAPABILITIES).toEqual(["tool-allowlist", "max-turns", "mcp-config", "cost"]);
});

test("orderedCapabilities keeps wire order and drops duplicates; parseCapabilityList refuses an unknown token by name", () => {
  expect(orderedCapabilities(["cost", "hook-enforcement", "cost", "tool-allowlist"])).toEqual(["tool-allowlist", "cost", "hook-enforcement"]);
  expect(parseCapabilityList(["cost", "max-turns"], "x")).toEqual(["max-turns", "cost"]);
  expect(() => parseCapabilityList(["cost", "nope"], "require")).toThrow(/require: unknown capability "nope"; accepted: tool-allowlist, max-turns/);
  expect(() => parseCapabilityList("cost", "require")).toThrow(/expected a list/);
});

test("B-2, B-7: the tier derives from the four request tokens alone", () => {
  expect(tierFor([...CAPABILITIES])).toBe("reference");
  expect(tierFor(["tool-allowlist", "max-turns", "mcp-config", "cost", "hook-enforcement"])).toBe("reference");
  expect(tierFor(["tool-allowlist", "max-turns", "mcp-config", "cost"])).toBe("reference");
  expect(tierFor(["workspace-write", "hook-enforcement"])).toBe("basic");
  expect(tierFor(["tool-allowlist", "max-turns", "cost"])).toBe("basic");
  expect(tierFor([])).toBe("basic");
});

test("B-4: requirementsFor derives the preferred set from what the request uses and the required set from the profile", () => {
  // A bypass profile with a bare request uses cost and nothing else.
  expect(requirementsFor({ mode: "bypass" }, {})).toEqual({ required: [], preferred: ["cost"] });
  // Guarded asks for the allowlist (the baseline list is a list).
  expect(requirementsFor({ mode: "guarded" }, {})).toEqual({ required: [], preferred: ["tool-allowlist", "cost"] });
  // A bypass profile carrying a list asks for it too.
  expect(requirementsFor({ mode: "bypass", disallowedTools: ["WebFetch"] }, {})).toEqual({ required: [], preferred: ["tool-allowlist", "cost"] });
  // A turn cap is preferred; an MCP server set is required (043 B-6).
  expect(requirementsFor({ mode: "bypass" }, { maxTurns: 3, mcpConfigPath: "/m.json" })).toEqual({
    required: ["mcp-config"],
    preferred: ["max-turns", "cost"],
  });
  // The profile's require list is required, and a token required is not
  // also listed as preferred.
  expect(requirementsFor({ mode: "guarded", require: ["workspace-write", "cost"] }, { maxTurns: 1 })).toEqual({
    required: ["cost", "workspace-write"],
    preferred: ["tool-allowlist", "max-turns"],
  });
  // Caller-named requirements merge in wire order.
  expect(requirementsFor({ mode: "bypass" }, { requirements: { required: ["hook-enforcement"], preferred: ["workspace-write"] } })).toEqual({
    required: ["hook-enforcement"],
    preferred: ["cost", "workspace-write"],
  });
});

test("B-6: requestedCapabilities is the union both drivers' session.init derive from", () => {
  expect(requestedCapabilities({ mode: "guarded", require: ["workspace-write"] }, { maxTurns: 2 })).toEqual([
    "tool-allowlist",
    "max-turns",
    "cost",
    "workspace-write",
  ]);
});

test("B-5: decide refuses on any missing required token and lists every missing preferred one, in wire order", () => {
  const codex = ["workspace-write", "hook-enforcement"] as const;
  expect(decide(codex, { required: [], preferred: ["tool-allowlist", "cost"] })).toEqual({ refused: [], degraded: ["tool-allowlist", "cost"] });
  expect(decide(codex, { required: ["tool-allowlist"], preferred: ["cost"] })).toEqual({ refused: ["tool-allowlist"], degraded: ["cost"] });
  expect(decide(codex, { required: ["workspace-write"], preferred: [] })).toEqual({ refused: [], degraded: [] });
  const claude = ["tool-allowlist", "max-turns", "mcp-config", "cost", "hook-enforcement"] as const;
  expect(decide(claude, { required: ["workspace-write"], preferred: ["max-turns"] })).toEqual({ refused: ["workspace-write"], degraded: [] });
  // An older manifest that declared nothing refuses everything required.
  expect(decide([], { required: ["mcp-config"], preferred: ["cost"] })).toEqual({ refused: ["mcp-config"], degraded: ["cost"] });
  expect(decide([], NO_REQUIREMENTS)).toEqual({ refused: [], degraded: [] });
});

test("B-3: the wire payload is explicit, and parseRequirements reads absence as none and refuses a bad token", () => {
  expect(requirementsPayload(NO_REQUIREMENTS)).toEqual({ required: [], preferred: [] });
  expect(parseRequirements(undefined)).toEqual(NO_REQUIREMENTS);
  expect(parseRequirements(null)).toEqual(NO_REQUIREMENTS);
  expect(parseRequirements({ required: ["cost"] })).toEqual({ required: ["cost"], preferred: [] });
  expect(parseRequirements({ required: null, preferred: ["hook-enforcement", "cost"] })).toEqual({ required: [], preferred: ["cost", "hook-enforcement"] });
  expect(() => parseRequirements({ required: ["nope"] })).toThrow(/requirements.required: unknown capability/);
  expect(() => parseRequirements([])).toThrow(/expected an object/);
});

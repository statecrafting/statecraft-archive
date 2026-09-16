import { describe, expect, it, beforeEach } from "vitest";
import type { Provider } from "./types.js";
import { ProviderError } from "./types.js";
import {
  InMemoryProviderRegistry,
  getProviderRegistry,
  resetProviderRegistryForTests,
} from "./registry.js";

function mockProvider(id: string): Provider {
  const caps = {
    streaming: true,
    toolUse: false,
    vision: false,
    extendedThinking: false,
    maxContextTokens: 100_000,
  };
  return {
    id,
    capabilities: caps,
    async spawn() {
      throw new ProviderError("no key", "missing_api_key", false);
    },
    async query() {
      return [];
    },
    async *stream() {
      yield { type: "text_delta" as const, delta: "" };
    },
    async abort() {},
  };
}

describe("InMemoryProviderRegistry", () => {
  let registry: InMemoryProviderRegistry;

  beforeEach(() => {
    registry = new InMemoryProviderRegistry();
  });

  it("registers and retrieves by id (FR-001)", () => {
    const p = mockProvider("anthropic");
    registry.register(p);
    expect(registry.get("anthropic")).toBe(p);
    expect(registry.has("anthropic")).toBe(true);
  });

  it("throws on duplicate id (FR-005 / SC-005)", () => {
    registry.register(mockProvider("openai"));
    expect(() => registry.register(mockProvider("openai"))).toThrow(
      /already registered/,
    );
  });

  it("list returns ids and capabilities (FR-004)", () => {
    registry.register(mockProvider("a"));
    registry.register(mockProvider("b"));
    const listed = registry.list();
    expect(listed).toHaveLength(2);
    expect(listed.map((x) => x.id).sort()).toEqual(["a", "b"]);
    expect(listed[0].capabilities.streaming).toBe(true);
  });

  it("unregister removes provider", () => {
    registry.register(mockProvider("x"));
    expect(registry.unregister("x")).toBe(true);
    expect(registry.has("x")).toBe(false);
    expect(registry.unregister("x")).toBe(false);
  });

  it("get throws when missing", () => {
    expect(() => registry.get("nope")).toThrow(/not registered/);
  });
});

describe("getProviderRegistry singleton", () => {
  beforeEach(() => {
    resetProviderRegistryForTests();
  });

  it("returns the same instance", () => {
    const a = getProviderRegistry();
    const b = getProviderRegistry();
    expect(a).toBe(b);
  });
});

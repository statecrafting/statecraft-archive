import { describe, expect, it } from "vitest";
import { parseProviderModel } from "./model-selector.js";

describe("parseProviderModel", () => {
  it("returns null provider for plain model ids", () => {
    expect(parseProviderModel("claude-sonnet-4-20250514")).toEqual({
      providerId: null,
      model: "claude-sonnet-4-20250514",
    });
  });

  it("parses known provider prefix", () => {
    expect(
      parseProviderModel("anthropic:claude-3-5-sonnet-20241022"),
    ).toEqual({
      providerId: "anthropic",
      model: "claude-3-5-sonnet-20241022",
    });
  });

  it("does not treat single colon hostnames as providers without known prefix", () => {
    expect(parseProviderModel("not-a-provider:foo")).toEqual({
      providerId: null,
      model: "not-a-provider:foo",
    });
  });
});

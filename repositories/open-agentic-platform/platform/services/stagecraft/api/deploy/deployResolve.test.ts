import { describe, expect, it } from "vitest";
import {
  isReservedConfigRefKey,
  resolveChartSelection,
  resolveTenantShape,
  RESERVED_CONFIG_REF_PREFIXES,
} from "./deployResolve";

describe("isReservedConfigRefKey (spec 214 FR-004)", () => {
  it("rejects ENCORE_ and KUBERNETES_ prefixed keys", () => {
    expect(isReservedConfigRefKey("ENCORE_RUNTIME_CONFIG")).toBe(true);
    expect(isReservedConfigRefKey("KUBERNETES_SERVICE_HOST")).toBe(true);
  });

  it("rejects reserved prefixes case-insensitively (same process env var)", () => {
    expect(isReservedConfigRefKey("encore_foo")).toBe(true);
    expect(isReservedConfigRefKey("Kubernetes_Foo")).toBe(true);
  });

  it("allows ordinary app config keys, including near-miss prefixes", () => {
    expect(isReservedConfigRefKey("API_BASE_URL")).toBe(false);
    expect(isReservedConfigRefKey("FEATURE_FLAG")).toBe(false);
    // ENCODER_ is not ENCORE_; must not be a false positive.
    expect(isReservedConfigRefKey("ENCODER_PRESET")).toBe(false);
  });

  it("exposes the reserved prefix list for the proxy diagnostic", () => {
    expect(RESERVED_CONFIG_REF_PREFIXES).toContain("ENCORE_");
    expect(RESERVED_CONFIG_REF_PREFIXES).toContain("KUBERNETES_");
  });
});

describe("resolveTenantShape (spec 214 FR-002, sole-shape mapping)", () => {
  it("maps any factory-created project (synthetic adapter id) to acme-vue-encore", () => {
    expect(resolveTenantShape("synthetic-adapter-abcd1234-my-app")).toBe(
      "acme-vue-encore",
    );
  });

  it("returns null when the project has no factory adapter", () => {
    expect(resolveTenantShape(null)).toBeNull();
    expect(resolveTenantShape(undefined)).toBeNull();
    expect(resolveTenantShape("")).toBeNull();
  });

  it("honours an explicit registered chart name", () => {
    expect(resolveTenantShape("synthetic-adapter-x", "acme-vue-encore")).toBe(
      "acme-vue-encore",
    );
    expect(resolveTenantShape(null, "acme-vue-encore")).toBe("acme-vue-encore");
  });

  it("ignores an unknown explicit chart and falls back to the adapter", () => {
    expect(resolveTenantShape("synthetic-adapter-x", "not-a-real-chart")).toBe(
      "acme-vue-encore",
    );
    expect(resolveTenantShape(null, "not-a-real-chart")).toBeNull();
  });
});

describe("resolveChartSelection (spec 214 FR-002)", () => {
  it("resolves a factory project to the acme-vue-encore chart selection", () => {
    expect(resolveChartSelection("synthetic-adapter-x")).toEqual({
      chart: "acme-vue-encore",
      version: "0.1.0",
    });
  });

  it("resolves an explicit registered chart override", () => {
    expect(resolveChartSelection(null, "acme-vue-encore")).toEqual({
      chart: "acme-vue-encore",
      version: "0.1.0",
    });
  });

  it("returns null when no shape is derivable (deployd applies its default)", () => {
    expect(resolveChartSelection(null)).toBeNull();
  });
});

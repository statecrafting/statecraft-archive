// Spec 227 Stage 2: patchEnvExample plumbs Base-app config into .env.example.

import { describe, expect, test } from "vitest";
import { patchEnvExample } from "./envExample";

const TEMPLATE = [
  "# Gateway proxy config",
  "# client-credentials client when the public stack proxies to the internal stack.",
  "# PRIVATE_API_BASE_URL=",
  "# GATEWAY_OAUTH_TOKEN_URL=",
  "# GATEWAY_TIMEOUT_MS=30000",
].join("\n");

describe("patchEnvExample", () => {
  test("uncomments and sets a blank-default key in place", () => {
    const out = patchEnvExample(TEMPLATE, {
      PRIVATE_API_BASE_URL: "https://internal.example.com",
    });
    expect(out).toContain("PRIVATE_API_BASE_URL=https://internal.example.com");
    expect(out).not.toContain("# PRIVATE_API_BASE_URL=");
    // untouched keys keep their commented default
    expect(out).toContain("# GATEWAY_TIMEOUT_MS=30000");
    expect(out).toContain("# GATEWAY_OAUTH_TOKEN_URL=");
  });

  test("overrides a commented key that already carries a default value", () => {
    const out = patchEnvExample(TEMPLATE, { GATEWAY_TIMEOUT_MS: "5000" });
    expect(out).toContain("GATEWAY_TIMEOUT_MS=5000");
    expect(out).not.toContain("# GATEWAY_TIMEOUT_MS=30000");
  });

  test("patches multiple keys in one pass, once each", () => {
    const out = patchEnvExample(TEMPLATE, {
      PRIVATE_API_BASE_URL: "https://api",
      GATEWAY_TIMEOUT_MS: "9000",
    });
    const lines = out.split("\n");
    expect(lines.filter((l) => l.startsWith("PRIVATE_API_BASE_URL="))).toHaveLength(1);
    expect(lines.filter((l) => l.startsWith("GATEWAY_TIMEOUT_MS="))).toHaveLength(1);
  });

  test("appends a key with no matching line under an override block", () => {
    const out = patchEnvExample("FOO=bar", { PRIVATE_API_BASE_URL: "https://x" });
    expect(out).toContain("# OAP create-project overrides");
    expect(out).toContain("PRIVATE_API_BASE_URL=https://x");
    expect(out.startsWith("FOO=bar")).toBe(true);
  });

  test("no overrides leaves the body unchanged", () => {
    expect(patchEnvExample(TEMPLATE, {})).toBe(TEMPLATE);
  });

  test("strips CR/LF so a value cannot inject extra env lines", () => {
    const out = patchEnvExample(TEMPLATE, {
      PRIVATE_API_BASE_URL: "https://x\nEVIL=1\r\nALSO=2",
    });
    const lines = out.split("\n");
    // Exactly one line for the key, and no injected EVIL=/ALSO= lines.
    expect(
      lines.filter((l) => l.startsWith("PRIVATE_API_BASE_URL="))
    ).toHaveLength(1);
    expect(lines.some((l) => l.startsWith("EVIL="))).toBe(false);
    expect(lines.some((l) => l.startsWith("ALSO="))).toBe(false);
    expect(out).toContain("PRIVATE_API_BASE_URL=https://xEVIL=1ALSO=2");
  });

  test("does not cross-match a key that is a substring of another", () => {
    const body = "# GATEWAY_TIMEOUT_MS_EXTRA=1\n# GATEWAY_TIMEOUT_MS=30000";
    const out = patchEnvExample(body, { GATEWAY_TIMEOUT_MS: "7" });
    expect(out).toContain("# GATEWAY_TIMEOUT_MS_EXTRA=1");
    expect(out).toContain("GATEWAY_TIMEOUT_MS=7");
  });

  test("overrides a baked AUTH_DRIVER for the spec 229 auth axis", () => {
    // The profile scaffold bakes AUTH_DRIVER=rauthy; the create form's driver
    // choice patches it (mock override, or an idempotent rauthy re-set).
    const body = "AUTH_DRIVER=rauthy\n# GATEWAY_TIMEOUT_MS=30000";
    const toMock = patchEnvExample(body, { AUTH_DRIVER: "mock" });
    expect(toMock).toContain("AUTH_DRIVER=mock");
    expect(toMock).not.toContain("AUTH_DRIVER=rauthy");
    expect(patchEnvExample(body, { AUTH_DRIVER: "rauthy" })).toContain(
      "AUTH_DRIVER=rauthy"
    );
  });
});

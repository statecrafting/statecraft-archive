import { describe, expect, it } from "vitest";
import {
  deriveHost,
  deriveHostLabel,
  isValidLabel,
  HOST_LABEL_MAX,
  type HostVariant,
} from "./hostname";

const BASE = "example.com";

describe("deriveHostLabel (spec 214 FR-007)", () => {
  it("joins org/project/env with double hyphens; public has no suffix", () => {
    expect(
      deriveHostLabel({
        orgSlug: "acme",
        projectSlug: "my-test-project-1",
        envSlug: "dev",
        variant: "public",
      })
    ).toBe("acme--my-test-project-1--dev");
  });

  it("appends --int for the internal variant", () => {
    expect(
      deriveHostLabel({
        orgSlug: "acme",
        projectSlug: "my-test-project-1",
        envSlug: "dev",
        variant: "internal",
      })
    ).toBe("acme--my-test-project-1--dev--int");
  });

  it("defaults variant to public", () => {
    expect(deriveHostLabel({ orgSlug: "acme", projectSlug: "p", envSlug: "dev" })).toBe(
      deriveHostLabel({ orgSlug: "acme", projectSlug: "p", envSlug: "dev", variant: "public" })
    );
  });

  it("lowercases and sanitizes non-label characters", () => {
    expect(
      deriveHostLabel({ orgSlug: "Acme Inc", projectSlug: "My_Proj", envSlug: "DEV" })
    ).toBe("acme-inc--my-proj--dev");
  });

  it("truncates to <=63 with a stable hash suffix on overflow", () => {
    const long = {
      orgSlug: "o".repeat(40),
      projectSlug: "p".repeat(40),
      envSlug: "e".repeat(40),
    };
    const label = deriveHostLabel(long);
    expect(label.length).toBeLessThanOrEqual(HOST_LABEL_MAX);
    expect(isValidLabel(label)).toBe(true);
    expect(deriveHostLabel(long)).toBe(label); // deterministic
  });

  it("distinguishes inputs that share a truncated prefix (hash suffix)", () => {
    const a = deriveHostLabel({ orgSlug: "x".repeat(70), projectSlug: "a", envSlug: "dev" });
    const b = deriveHostLabel({ orgSlug: "x".repeat(70), projectSlug: "b", envSlug: "dev" });
    expect(a).not.toBe(b);
    expect(a.length).toBeLessThanOrEqual(HOST_LABEL_MAX);
    expect(b.length).toBeLessThanOrEqual(HOST_LABEL_MAX);
  });

  it("public and internal variants of the same env never collide", () => {
    const base = { orgSlug: "acme", projectSlug: "proj", envSlug: "dev" };
    expect(deriveHostLabel({ ...base, variant: "public" })).not.toBe(
      deriveHostLabel({ ...base, variant: "internal" })
    );
  });
});

describe("deriveHost", () => {
  it("places the label as a single level under tenants.{base}", () => {
    const host = deriveHost({
      orgSlug: "acme",
      projectSlug: "proj",
      envSlug: "dev",
      baseDomain: BASE,
    });
    expect(host).toBe(`acme--proj--dev.tenants.${BASE}`);
    const label = host.slice(0, host.indexOf(".tenants."));
    expect(label).not.toContain("."); // single label => wildcard-cert-covered
    expect(isValidLabel(label)).toBe(true);
  });
});

describe("property: 100 random triples are valid, collision-free, cert-covered (SC-004)", () => {
  it("holds", () => {
    // Deterministic LCG so a failure reproduces. Label-safe (alnum) slug
    // parts: each part is hyphen-free, so the `--` join is unambiguous and
    // distinct triples map to distinct labels by construction (the overflow
    // hash preserves that for truncated labels). The DB-side collision check
    // (deploy.ts) guards the residual sanitize-collapse case the spec notes.
    let seed = 0x2bd6;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    const slug = (maxLen: number) => {
      const n = 1 + Math.floor(rnd() * maxLen);
      let s = "";
      for (let i = 0; i < n; i++) s += chars[Math.floor(rnd() * chars.length)];
      return s;
    };
    const variants: HostVariant[] = ["public", "internal"];
    const seenLabels = new Set<string>();
    const seenInputs = new Set<string>();
    let checked = 0;

    for (let i = 0; i < 100; i++) {
      const input = {
        orgSlug: slug(30),
        projectSlug: slug(40),
        envSlug: slug(20),
        variant: variants[i % 2],
      };
      const key = JSON.stringify(input);
      if (seenInputs.has(key)) continue; // keep inputs distinct
      seenInputs.add(key);

      const label = deriveHostLabel(input);
      const host = deriveHost({ ...input, baseDomain: BASE });

      expect(isValidLabel(label), `invalid label: ${label}`).toBe(true);
      expect(host.endsWith(`.tenants.${BASE}`)).toBe(true);
      expect(label).not.toContain(".");
      expect(deriveHostLabel(input)).toBe(label); // deterministic
      expect(seenLabels.has(label), `collision on label: ${label}`).toBe(false);
      seenLabels.add(label);
      checked++;
    }
    expect(checked).toBeGreaterThan(80);
  });
});

// Spec 167 §2.3 — born-with kernel stamp unit tests.
// Pure filesystem + crypto; runs under bare vitest.

import { describe, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildKernelVersionStamp,
  manifestHash,
  resolveSpecSpinePin,
  serializeKernelVersionStamp,
} from "./kernelVersionStamp";

const ADAPTER = {
  id: "adapter-id",
  name: "acme-vue-encore",
  version: "0.1.0",
  sourceSha: "cc1139fcc1139fcc1139fcc1139fcc1139fcc113",
};

describe("resolveSpecSpinePin", () => {
  test("reads the pin from the root package.json (single profile)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kv-root-"));
    try {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ name: "x", devDependencies: { "spec-spine": "0.2.0" } })
      );
      expect(await resolveSpecSpinePin(dir)).toBe("0.2.0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("falls back to a variant subdir when the root has no package.json (dual)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kv-dual-"));
    try {
      mkdirSync(join(dir, "public"), { recursive: true });
      writeFileSync(
        join(dir, "public", "package.json"),
        JSON.stringify({ name: "public", devDependencies: { "spec-spine": "0.3.1" } })
      );
      expect(await resolveSpecSpinePin(dir)).toBe("0.3.1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("throws (never silent) when no spec-spine pin exists anywhere", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kv-none-"));
    try {
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x" }));
      await expect(resolveSpecSpinePin(dir)).rejects.toThrow(/spec-spine/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("buildKernelVersionStamp", () => {
  test("records the pin, adapter identity, and pinned-toolchain mode", () => {
    const stamp = buildKernelVersionStamp({
      adapter: ADAPTER,
      manifest: { adapter: { name: "acme-vue-encore" } },
      specSpineVersion: "0.2.0",
      now: "2026-06-12T00:00:00.000Z",
    });
    expect(stamp.toolchain_mode).toBe("pinned-toolchain");
    expect(stamp.kernel.spec_spine_version).toBe("0.2.0");
    expect(stamp.kernel.source_commit).toBe(ADAPTER.sourceSha);
    expect(stamp.adapter.id).toBe("acme-vue-encore");
    expect(stamp.adapter.manifest_hash).toMatch(/^[0-9a-f]{64}$/);
    // The YAML form carries the kebab-case toolchain_mode the Rust enum reads.
    expect(serializeKernelVersionStamp(stamp)).toContain("toolchain_mode: pinned-toolchain");
  });
});

describe("manifestHash", () => {
  test("is stable across key order (canonical)", () => {
    const a = manifestHash({ b: 1, a: { y: 2, x: 1 } });
    const b = manifestHash({ a: { x: 1, y: 2 }, b: 1 });
    expect(a).toBe(b);
  });
  test("changes when a value changes", () => {
    expect(manifestHash({ v: "1.0.0" })).not.toBe(manifestHash({ v: "1.1.0" }));
  });
});

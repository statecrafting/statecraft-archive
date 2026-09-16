import { defineConfig } from "vitest/config";

// Spec 187 — e2e run model (FR-T1/FR-T5). These specs drive a *built* OPC
// binary via standalone WebdriverIO (webdriverio.remote()) + tauri-driver under
// xvfb. Standalone (not the wdio testrunner) is deliberate: each fixture
// launches its own OPC instance with its own mock-statecraft mode and env, so
// AC-7 (unreachable) and AC-8 (healthy) don't fight over a single shared
// session.
//
// Run ONLY in the nightly (`npm run test:e2e`): never locally on macOS
// (tauri-driver has no WKWebView backend) and never in ci-gate (FR-T5 forbids a
// per-PR gate). The pure-Node harness primitives use vitest.config.ts instead.
export default defineConfig({
  test: {
    environment: "node",
    include: ["fixtures/**/*.e2e.ts"],
    // One OPC binary instance at a time keeps process-tree + boot-gate
    // assertions deterministic (FR-T3 / FR-T6 — no flake amnesty).
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});

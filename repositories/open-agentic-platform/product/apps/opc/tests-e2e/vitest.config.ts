import { defineConfig } from "vitest/config";

// Spec 187 — harness primitive unit/integration tests (FR-T2/T3/T4).
//
// These run on a plain Node environment (no jsdom) and cover the
// pure-Node harness primitives: process-tree introspection, the
// mock-statecraft duplex server, and the time-bounded wait helper.
//
// The built-binary WebView driver (FR-T1) and the per-AC fixtures that
// drive a real OPC binary do NOT run here — they run under WebdriverIO
// (`npm run test:e2e`) in the Linux nightly, because tauri-driver has no
// macOS WebView backend. Keeping the two runners separate is what lets
// the primitives stay fast and locally verifiable while the WebView path
// stays CI-bound (FR-T5).
export default defineConfig({
  test: {
    environment: "node",
    include: ["harness/**/*.test.ts"],
    // The WebdriverIO e2e specs live under fixtures/**; vitest must not
    // try to collect them (they import the wdio `browser` global).
    exclude: ["**/node_modules/**", "fixtures/**", "**/*.e2e.ts"],
  },
});

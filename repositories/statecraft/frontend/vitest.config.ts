import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Component tests run in a DOM environment (spec 007 §3). The repo-root vitest
// config runs the Node/Encore suite and excludes frontend/**, so these two
// configs never overlap.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});

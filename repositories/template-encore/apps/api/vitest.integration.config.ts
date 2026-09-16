import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Integration tests (files named *.itest.ts) run under `encore test`
// (npm run test:integration), which provisions the Encore runtime plus an
// ephemeral Postgres. They are excluded from the fast `npm test` (plain vitest,
// no Docker) by the .itest.ts naming: the default vitest config only includes
// test files ending in .test.ts. The ~encore alias mirrors tsconfig's
// "~encore/*" path mapping so handlers importing ~encore/auth resolve here too.
export default defineConfig({
  resolve: {
    alias: {
      "~encore": fileURLToPath(new URL("./encore.gen", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.itest.ts"],
    exclude: ["node_modules", "encore.gen", "web/build"],
    passWithNoTests: true,
  },
});

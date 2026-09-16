import { defineConfig } from 'vitest/config'

// Root test config for the create-time generator toolchain. Runs the moved
// acme-vue-encore generator unit + integration tests and the cross-repo
// lockstep check. Tests resolve their own fixtures relative to each test file,
// so no custom `root` is needed.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['adapters/acme-vue-encore/scripts/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/build/**'],
  },
})

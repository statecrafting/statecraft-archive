import { defineConfig } from 'vitest/config'
import * as path from 'node:path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts'],
    root: path.resolve(__dirname),
  },
})

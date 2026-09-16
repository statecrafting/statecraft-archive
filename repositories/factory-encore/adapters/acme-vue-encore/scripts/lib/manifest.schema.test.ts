import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, it, expect } from 'vitest'
import { manifestSchema } from './manifest.schema'
import { REAL_MODULES_DIR, ALL_MODULE_NAMES } from './__fixtures__/test-helpers'

describe('manifestSchema', () => {
  it('parses valid minimal manifest', () => {
    const result = manifestSchema.parse({ name: 'test', description: 'A test module' })
    expect(result.name).toBe('test')
    expect(result.description).toBe('A test module')
    expect(result.version).toBe('1.0.0')
    expect(result.status).toBe('stable')
  })

  it('parses full manifest with all fields', () => {
    const full = {
      name: 'full-mod',
      version: '2.0.0',
      description: 'Full module',
      status: 'stable' as const,
      requires: ['dep-a'],
      requiresOneOf: [['dep-b', 'dep-c']],
      optionalPeers: ['peer-a'],
      conflicts: ['conflict-a'],
      files: { 'src/a.ts': 'dest/a.ts' },
      authExports: ["export { Foo } from './foo.js'"],
      services: ['user-management'],
      secrets: [{ name: 'JWT_PRIVATE_KEY' }],
      packageDeps: { 'apps/api': { pg: '^8.0.0' } },
      envVars: { DB_URL: { required: true, description: 'Database URL', sensitive: true } },
      workspaceChanges: { add: ['libs/*'] },
    }
    const result = manifestSchema.parse(full)
    expect(result.name).toBe('full-mod')
    expect(result.requires).toEqual(['dep-a'])
    expect(result.services).toEqual(['user-management'])
    expect(result.secrets[0].name).toBe('JWT_PRIVATE_KEY')
    expect(result.envVars.DB_URL.sensitive).toBe(true)
  })

  it('rejects manifest missing name', () => {
    expect(() => manifestSchema.parse({ description: 'No name' })).toThrow()
  })

  it('rejects manifest missing description', () => {
    expect(() => manifestSchema.parse({ name: 'no-desc' })).toThrow()
  })

  it('rejects empty name string', () => {
    expect(() => manifestSchema.parse({ name: '', description: 'empty name' })).toThrow()
  })

  it('defaults version to "1.0.0"', () => {
    const result = manifestSchema.parse({ name: 'test', description: 'test' })
    expect(result.version).toBe('1.0.0')
  })

  it('defaults status to "stable"', () => {
    const result = manifestSchema.parse({ name: 'test', description: 'test' })
    expect(result.status).toBe('stable')
  })

  it('defaults arrays and objects to empty', () => {
    const result = manifestSchema.parse({ name: 'test', description: 'test' })
    expect(result.requires).toEqual([])
    expect(result.requiresOneOf).toEqual([])
    expect(result.optionalPeers).toEqual([])
    expect(result.conflicts).toEqual([])
    expect(result.files).toEqual({})
    expect(result.authExports).toEqual([])
    expect(result.services).toEqual([])
    expect(result.secrets).toEqual([])
    expect(result.corsEntries).toEqual([])
    expect(result.middlewares).toEqual([])
    expect(result.migrations).toEqual([])
    expect(result.packageDeps).toEqual({})
    expect(result.envVars).toEqual({})
  })

  it('validates corsEntries field enum', () => {
    expect(() =>
      manifestSchema.parse({
        name: 't',
        description: 't',
        corsEntries: [{ field: 'bogus', values: [] }],
      }),
    ).toThrow()

    const result = manifestSchema.parse({
      name: 't',
      description: 't',
      corsEntries: [{ field: 'allow_headers', values: ['X-Foo'] }],
    })
    expect(result.corsEntries).toHaveLength(1)
  })

  it('validates envVars structure', () => {
    const result = manifestSchema.parse({
      name: 'test',
      description: 'test',
      envVars: {
        MY_VAR: { required: true, description: 'A variable', value: 'default' },
      },
    })
    expect(result.envVars.MY_VAR.required).toBe(true)
    expect(result.envVars.MY_VAR.value).toBe('default')
  })

  describe('real module manifests', () => {
    it.each(ALL_MODULE_NAMES)('parses %s manifest', (moduleName) => {
      const manifestPath = path.join(REAL_MODULES_DIR, moduleName, 'manifest.json')
      const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
      const result = manifestSchema.parse(raw)
      expect(result.name).toBe(moduleName)
      expect(result.status).toBe('stable')
    })
  })
})

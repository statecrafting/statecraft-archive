import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mergeEnvVars, commentOutEnvVars } from './env-merger'
import { createTempProjectDir, cleanTempDir } from './__fixtures__/test-helpers'
import type { ModuleManifest } from './manifest.schema'

function makeManifest(overrides: Partial<ModuleManifest> = {}): ModuleManifest {
  return {
    name: 'test-mod',
    version: '1.0.0',
    description: 'Test module',
    status: 'stable',
    requires: [],
    requiresOneOf: [],
    optionalPeers: [],
    conflicts: [],
    files: {},
    authExports: [],
    services: [],
    secrets: [],
    corsEntries: [],
    middlewares: [],
    migrations: [],
    packageDeps: {},
    infraResources: {},
    envVars: {},
    ...overrides,
  }
}

describe('env-merger', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = createTempProjectDir()
  })

  afterEach(() => {
    cleanTempDir(tmpDir)
  })

  describe('mergeEnvVars', () => {
    it('creates .env.example when it does not exist and adds vars', () => {
      fs.unlinkSync(path.join(tmpDir, '.env.example'))
      const manifest = makeManifest({
        envVars: {
          MY_VAR: { required: true, description: 'A variable', value: 'default' },
        },
      })
      const { added, skipped } = mergeEnvVars(tmpDir, manifest)
      expect(added).toEqual(['MY_VAR'])
      expect(skipped).toEqual([])
      const content = fs.readFileSync(path.join(tmpDir, '.env.example'), 'utf-8')
      expect(content).toContain('MY_VAR=default')
    })

    it('appends new vars to existing .env.example', () => {
      const manifest = makeManifest({
        envVars: {
          NEW_VAR: { required: false, description: 'New var' },
        },
      })
      const { added } = mergeEnvVars(tmpDir, manifest)
      expect(added).toEqual(['NEW_VAR'])
      const content = fs.readFileSync(path.join(tmpDir, '.env.example'), 'utf-8')
      expect(content).toContain('NODE_ENV=development')
      expect(content).toContain('NEW_VAR=')
    })

    it('skips vars that already exist', () => {
      fs.writeFileSync(path.join(tmpDir, '.env.example'), 'EXISTING=value\n')
      const manifest = makeManifest({
        envVars: {
          EXISTING: { required: true, description: 'Already here' },
          NEW_ONE: { required: false, description: 'New' },
        },
      })
      const { added, skipped } = mergeEnvVars(tmpDir, manifest)
      expect(skipped).toEqual(['EXISTING'])
      expect(added).toEqual(['NEW_ONE'])
    })

    it('adds section header with module name', () => {
      const manifest = makeManifest({
        name: 'my-module',
        envVars: {
          FOO: { required: false, description: 'Foo var' },
        },
      })
      mergeEnvVars(tmpDir, manifest)
      const content = fs.readFileSync(path.join(tmpDir, '.env.example'), 'utf-8')
      expect(content).toContain('# --- my-module ---')
    })

    it('adds WARNING comment for sensitive vars', () => {
      const manifest = makeManifest({
        envVars: {
          SECRET: { required: true, description: 'A secret', sensitive: true, value: '' },
        },
      })
      mergeEnvVars(tmpDir, manifest)
      const content = fs.readFileSync(path.join(tmpDir, '.env.example'), 'utf-8')
      expect(content).toContain('WARNING')
      expect(content).toContain('do not commit')
    })

    it('uses empty string when no default value', () => {
      const manifest = makeManifest({
        envVars: {
          NO_DEFAULT: { required: true, description: 'No default value' },
        },
      })
      mergeEnvVars(tmpDir, manifest)
      const content = fs.readFileSync(path.join(tmpDir, '.env.example'), 'utf-8')
      expect(content).toContain('NO_DEFAULT=')
    })

    it('returns empty arrays when manifest has no envVars', () => {
      const manifest = makeManifest()
      const { added, skipped } = mergeEnvVars(tmpDir, manifest)
      expect(added).toEqual([])
      expect(skipped).toEqual([])
    })

    it('adds description comment before each var', () => {
      const manifest = makeManifest({
        envVars: {
          MY_VAR: { required: false, description: 'My description' },
        },
      })
      mergeEnvVars(tmpDir, manifest)
      const content = fs.readFileSync(path.join(tmpDir, '.env.example'), 'utf-8')
      expect(content).toContain('# My description')
    })
  })

  describe('commentOutEnvVars', () => {
    it('comments out matching env var lines', () => {
      fs.writeFileSync(path.join(tmpDir, '.env.example'), 'FOO=bar\nBAZ=qux\n')
      const manifest = makeManifest({
        name: 'test-mod',
        envVars: { FOO: { required: false, description: 'Foo' } },
      })
      commentOutEnvVars(tmpDir, manifest)
      const content = fs.readFileSync(path.join(tmpDir, '.env.example'), 'utf-8')
      expect(content).toContain('# FOO=bar # (removed with test-mod)')
      expect(content).toContain('BAZ=qux')
    })

    it('removes section header for the module', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.env.example'),
        '# --- test-mod ---\nFOO=bar\n',
      )
      const manifest = makeManifest({
        envVars: { FOO: { required: false, description: 'Foo' } },
      })
      commentOutEnvVars(tmpDir, manifest)
      const content = fs.readFileSync(path.join(tmpDir, '.env.example'), 'utf-8')
      expect(content).not.toContain('# --- test-mod ---')
    })

    it('preserves unrelated env vars', () => {
      fs.writeFileSync(path.join(tmpDir, '.env.example'), 'KEEP=me\nREMOVE=this\n')
      const manifest = makeManifest({
        envVars: { REMOVE: { required: false, description: 'Remove' } },
      })
      commentOutEnvVars(tmpDir, manifest)
      const content = fs.readFileSync(path.join(tmpDir, '.env.example'), 'utf-8')
      expect(content).toContain('KEEP=me')
    })

    it('handles missing .env.example gracefully', () => {
      fs.unlinkSync(path.join(tmpDir, '.env.example'))
      const manifest = makeManifest({
        envVars: { FOO: { required: false, description: 'Foo' } },
      })
      expect(() => commentOutEnvVars(tmpDir, manifest)).not.toThrow()
    })

    it('does not comment already-commented lines', () => {
      fs.writeFileSync(path.join(tmpDir, '.env.example'), '# FOO=bar\n')
      const manifest = makeManifest({
        envVars: { FOO: { required: false, description: 'Foo' } },
      })
      commentOutEnvVars(tmpDir, manifest)
      const content = fs.readFileSync(path.join(tmpDir, '.env.example'), 'utf-8')
      // The already-commented line should stay as-is (not double-commented)
      expect(content).toBe('# FOO=bar\n')
    })
  })
})

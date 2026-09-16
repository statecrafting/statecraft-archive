import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  loadTemplateJson,
  saveTemplateJson,
  isModuleInstalled,
  getInstalledModules,
  getAllModules,
  addModuleToState,
  removeModuleFromState,
  getFileOwner,
} from './template-json'
import { buildEmptyState, buildStateWithModules, createTempProjectDir, cleanTempDir } from './__fixtures__/test-helpers'

describe('template-json', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = createTempProjectDir()
  })

  afterEach(() => {
    cleanTempDir(tmpDir)
  })

  describe('loadTemplateJson', () => {
    it('returns default state when template.json does not exist', () => {
      fs.unlinkSync(path.join(tmpDir, 'template.json'))
      const state = loadTemplateJson(tmpDir)
      expect(state.templateName).toBe('template-encore')
      expect(state.baseVersion).toBe('3.0.0')
      expect(state.modules).toEqual({})
      expect(state.fileOwnership).toEqual({})
    })

    it('parses valid template.json from disk', () => {
      const data = {
        templateName: 'test',
        baseVersion: '2.0.0',
        modules: { foo: { version: '1.0.0' } },
        fileOwnership: { 'src/foo.ts': 'foo' },
      }
      fs.writeFileSync(path.join(tmpDir, 'template.json'), JSON.stringify(data))
      const state = loadTemplateJson(tmpDir)
      expect(state.templateName).toBe('test')
      expect(state.modules.foo.version).toBe('1.0.0')
      expect(state.fileOwnership['src/foo.ts']).toBe('foo')
    })

    it('applies Zod defaults for missing fields', () => {
      fs.writeFileSync(path.join(tmpDir, 'template.json'), '{}')
      const state = loadTemplateJson(tmpDir)
      expect(state.templateName).toBe('template-encore')
      expect(state.baseVersion).toBe('3.0.0')
      expect(state.modules).toEqual({})
      expect(state.fileOwnership).toEqual({})
    })

    it('throws on malformed JSON', () => {
      fs.writeFileSync(path.join(tmpDir, 'template.json'), '{bad json')
      expect(() => loadTemplateJson(tmpDir)).toThrow()
    })
  })

  describe('saveTemplateJson', () => {
    it('writes JSON with 2-space indent and trailing newline', () => {
      const state = buildEmptyState()
      saveTemplateJson(tmpDir, state)
      const content = fs.readFileSync(path.join(tmpDir, 'template.json'), 'utf-8')
      expect(content).toContain('  "templateName"')
      expect(content.endsWith('\n')).toBe(true)
    })

    it('round-trips correctly', () => {
      const state = buildStateWithModules({ foo: { files: { 'a.ts': 'src/a.ts' } } })
      saveTemplateJson(tmpDir, state)
      const loaded = loadTemplateJson(tmpDir)
      expect(loaded.modules.foo).toBeDefined()
      expect(loaded.fileOwnership['src/a.ts']).toBe('foo')
    })
  })

  describe('isModuleInstalled', () => {
    it('returns true when module exists in state', () => {
      const state = buildStateWithModules({ foo: {} })
      expect(isModuleInstalled(state, 'foo')).toBe(true)
    })

    it('returns false when module is absent', () => {
      const state = buildEmptyState()
      expect(isModuleInstalled(state, 'foo')).toBe(false)
    })

    it('returns true for alwaysOn modules', () => {
      const state = buildStateWithModules({ foo: { alwaysOn: true } })
      expect(isModuleInstalled(state, 'foo')).toBe(true)
    })
  })

  describe('getInstalledModules', () => {
    it('excludes alwaysOn entries', () => {
      const state = buildStateWithModules({
        foo: { alwaysOn: true },
        bar: {},
      })
      expect(getInstalledModules(state)).toEqual(['bar'])
    })

    it('returns empty array for empty state', () => {
      expect(getInstalledModules(buildEmptyState())).toEqual([])
    })
  })

  describe('getAllModules', () => {
    it('includes alwaysOn modules', () => {
      const state = buildStateWithModules({
        foo: { alwaysOn: true },
        bar: {},
      })
      expect(getAllModules(state)).toEqual(['foo', 'bar'])
    })

    it('returns empty array for empty state', () => {
      expect(getAllModules(buildEmptyState())).toEqual([])
    })
  })

  describe('addModuleToState', () => {
    it('adds module with version and installedAt', () => {
      const state = buildEmptyState()
      const updated = addModuleToState(state, 'foo', '2.0.0', {})
      expect(updated.modules.foo.version).toBe('2.0.0')
      expect(updated.modules.foo.installedAt).toMatch(/\d{4}-\d{2}-\d{2}/)
    })

    it('maps files to fileOwnership', () => {
      const state = buildEmptyState()
      const updated = addModuleToState(state, 'foo', '1.0.0', {
        'src/a.ts': 'apps/api/src/a.ts',
        'src/b.ts': 'apps/api/src/b.ts',
      })
      expect(updated.fileOwnership['apps/api/src/a.ts']).toBe('foo')
      expect(updated.fileOwnership['apps/api/src/b.ts']).toBe('foo')
    })

    it('preserves existing modules', () => {
      const state = buildStateWithModules({ existing: {} })
      const updated = addModuleToState(state, 'new-mod', '1.0.0', {})
      expect(updated.modules.existing).toBeDefined()
      expect(updated.modules['new-mod']).toBeDefined()
    })

    it('supports alwaysOn flag', () => {
      const state = buildEmptyState()
      const updated = addModuleToState(state, 'foo', '1.0.0', {}, true)
      expect(updated.modules.foo.alwaysOn).toBe(true)
    })

    it('does not set alwaysOn when not specified', () => {
      const state = buildEmptyState()
      const updated = addModuleToState(state, 'foo', '1.0.0', {})
      expect(updated.modules.foo.alwaysOn).toBeUndefined()
    })
  })

  describe('removeModuleFromState', () => {
    it('removes module from modules record', () => {
      const state = buildStateWithModules({ foo: {}, bar: {} })
      const updated = removeModuleFromState(state, 'foo')
      expect(updated.modules.foo).toBeUndefined()
      expect(updated.modules.bar).toBeDefined()
    })

    it('removes all fileOwnership entries owned by that module', () => {
      const state = buildStateWithModules({
        foo: { files: { 'a.ts': 'src/a.ts', 'b.ts': 'src/b.ts' } },
        bar: { files: { 'c.ts': 'src/c.ts' } },
      })
      const updated = removeModuleFromState(state, 'foo')
      expect(updated.fileOwnership['src/a.ts']).toBeUndefined()
      expect(updated.fileOwnership['src/b.ts']).toBeUndefined()
      expect(updated.fileOwnership['src/c.ts']).toBe('bar')
    })

    it('handles removing module with no owned files', () => {
      const state = buildStateWithModules({ foo: {} })
      const updated = removeModuleFromState(state, 'foo')
      expect(updated.modules.foo).toBeUndefined()
    })
  })

  describe('getFileOwner', () => {
    it('returns module name for tracked file', () => {
      const state = buildStateWithModules({ foo: { files: { 'a.ts': 'src/a.ts' } } })
      expect(getFileOwner(state, 'src/a.ts')).toBe('foo')
    })

    it('returns null for untracked file', () => {
      const state = buildEmptyState()
      expect(getFileOwner(state, 'src/unknown.ts')).toBeNull()
    })
  })
})

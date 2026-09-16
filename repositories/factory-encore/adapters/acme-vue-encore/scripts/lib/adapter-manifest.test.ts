import { describe, it, expect } from 'vitest'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as fs from 'node:fs'
import { parse as parseYaml } from 'yaml'
import { loadProfiles, profileModules } from './adapter-manifest'

// scripts/lib/.. -> scripts/.. -> the adapter root (where manifest.yaml lives).
const ADAPTER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

describe('adapter-manifest profile modules (STRUCT-1 single authority)', () => {
  it('reads scaffold.profiles from the real manifest', () => {
    const names = loadProfiles(ADAPTER_ROOT).map((p) => p.name).sort()
    expect(names).toEqual(['dual', 'internal', 'minimal', 'public'])
  })

  it('internal ships user-management by default', () => {
    expect(profileModules(ADAPTER_ROOT, 'internal')).toEqual(['user-management'])
  })

  it('minimal/public/dual ship no modules by default', () => {
    expect(profileModules(ADAPTER_ROOT, 'minimal')).toEqual([])
    expect(profileModules(ADAPTER_ROOT, 'public')).toEqual([])
    expect(profileModules(ADAPTER_ROOT, 'dual')).toEqual([])
  })

  it('throws on a profile not declared in the manifest', () => {
    expect(() => profileModules(ADAPTER_ROOT, 'nope')).toThrow(/not declared/)
  })
})

describe('manifest STRUCT-1/STRUCT-3 invariants', () => {
  const raw = parseYaml(fs.readFileSync(path.join(ADAPTER_ROOT, 'manifest.yaml'), 'utf-8'))

  it('has no variant-keyed scaffold.modules (DSOT-1 removed; profiles[].modules is authority)', () => {
    expect(raw.scaffold.modules).toBeUndefined()
  })

  it('args_schema.profile.enum excludes "dual" (a topology, not a --profile; STRUCT-3)', () => {
    expect(raw.scaffold.args_schema.properties.profile.enum).toEqual(['minimal', 'public', 'internal'])
  })
})

import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { generateWebModulesTs } from './modules-ts-generator'
import {
  buildEmptyState,
  buildStateWithModules,
  createTempProjectDir,
  cleanTempDir,
  copyModulesToTempDir,
} from './__fixtures__/test-helpers'

describe('generateWebModulesTs', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = createTempProjectDir()
  })

  afterEach(() => {
    cleanTempDir(tmpDir)
  })

  it('returns null when frontend-core not installed', () => {
    const result = generateWebModulesTs(tmpDir, buildEmptyState())
    expect(result).toBeNull()
  })

  it('returns null when only other modules installed', () => {
    copyModulesToTempDir(tmpDir, ['security-core'])
    const state = buildStateWithModules({ 'security-core': {} })
    const result = generateWebModulesTs(tmpDir, state)
    expect(result).toBeNull()
  })

  it('generates output when frontend-core is installed', () => {
    // Create a minimal frontend-core module
    const fcDir = path.join(tmpDir, 'modules', 'frontend-core')
    fs.mkdirSync(fcDir, { recursive: true })
    fs.writeFileSync(
      path.join(fcDir, 'manifest.json'),
      JSON.stringify({ name: 'frontend-core', description: 'Frontend core', files: {} }),
    )

    const state = buildStateWithModules({ 'frontend-core': {} })
    const result = generateWebModulesTs(tmpDir, state)
    expect(result).not.toBeNull()
    expect(result).toContain('DO NOT EDIT MANUALLY')
    expect(result).toContain('registerAllWebModules')
    expect(result).toContain("registerNavItem")
    expect(result).toContain("'Home'")
    expect(result).toContain("'About'")
  })
})

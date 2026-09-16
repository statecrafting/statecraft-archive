/**
 * Tests for the Encore dual-app generator (spec 004).
 *
 * wireInternalSpa is tested against a minimal fixture (fast); the full
 * setupDualApp is exercised against the synthetic lean baseline
 * (makeBaselineFixture) to assert the two independent apps, their per-variant
 * AUTH_DRIVER, the staff-SPA wiring, and that generator artifacts never leak
 * into either produced app.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { DUAL_VARIANTS, wireInternalSpa, setupDualApp } from './setup-dual-app'
import { makeBaselineFixture, cleanTempDir } from './lib/__fixtures__/test-helpers'

// --- wireInternalSpa (fixture) ---------------------------------------------

describe('wireInternalSpa', () => {
  let root: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'dual-wire-'))
    fs.mkdirSync(path.join(root, 'apps', 'web-internal'), { recursive: true })
    fs.writeFileSync(
      path.join(root, 'apps', 'web-internal', 'vite.config.ts'),
      [
        "import { defineConfig } from 'vite'",
        "import { fileURLToPath, URL } from 'node:url'",
        'export default defineConfig(() => {',
        '  return {',
        '    resolve: { alias: {} },',
        '    server: {',
        '      port: 5174,',
        '    },',
        '  }',
        '})',
        '',
      ].join('\n'),
    )
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify(
        { name: 'dual-internal', scripts: { 'build:apps': 'npm run build --workspace=apps/web --workspace=apps/web-internal' } },
        null,
        2,
      ) + '\n',
    )
  })

  afterEach(() => {
    cleanTempDir(root)
  })

  it('adds build.outDir = ../api/web/build to the staff SPA vite config', () => {
    wireInternalSpa(root)
    const vite = fs.readFileSync(path.join(root, 'apps', 'web-internal', 'vite.config.ts'), 'utf-8')
    expect(vite).toContain('outDir')
    expect(vite).toContain("new URL('../api/web/build', import.meta.url)")
    // build block sits before the server block
    expect(vite.indexOf('build: {')).toBeLessThan(vite.indexOf('server: {'))
  })

  it('repoints build:apps to build only apps/web-internal', () => {
    wireInternalSpa(root)
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'))
    expect(pkg.scripts['build:apps']).toBe('npm run build --workspace=apps/web-internal')
    expect(pkg.scripts['build:apps']).not.toContain('apps/web ')
  })

  it('is idempotent (re-running does not duplicate the build block)', () => {
    wireInternalSpa(root)
    wireInternalSpa(root)
    const vite = fs.readFileSync(path.join(root, 'apps', 'web-internal', 'vite.config.ts'), 'utf-8')
    expect((vite.match(/build: \{/g) ?? []).length).toBe(1)
  })
})

// --- setupDualApp against the lean baseline --------------------------------

describe('setupDualApp: two independent Encore apps', () => {
  let source: string
  let dest: string
  let roots: Record<'public' | 'internal', string>

  beforeAll(() => {
    source = makeBaselineFixture()
    dest = fs.mkdtempSync(path.join(os.tmpdir(), 'dual-setup-'))
    roots = setupDualApp({ dest, source })
  })

  afterAll(() => {
    cleanTempDir(source)
    cleanTempDir(dest)
  })

  it('produces a standalone Encore app at <dest>/public and <dest>/internal', () => {
    for (const v of DUAL_VARIANTS) {
      expect(fs.existsSync(path.join(roots[v.dir], 'apps', 'api'))).toBe(true)
      expect(fs.existsSync(path.join(roots[v.dir], 'apps', 'api', 'package.json'))).toBe(true)
      // no Express src tree
      expect(fs.existsSync(path.join(roots[v.dir], 'apps', 'api', 'src'))).toBe(false)
    }
  })

  it('sets AUTH_DRIVER=rauthy for both the public and internal variants', () => {
    const pubEnv = fs.readFileSync(path.join(roots.public, 'apps', 'api', '.env.example'), 'utf-8')
    const intEnv = fs.readFileSync(path.join(roots.internal, 'apps', 'api', '.env.example'), 'utf-8')
    expect(pubEnv).toMatch(/^AUTH_DRIVER=rauthy$/m)
    expect(intEnv).toMatch(/^AUTH_DRIVER=rauthy$/m)
  })

  it('wires the internal app to serve the staff SPA (apps/web-internal)', () => {
    const vite = fs.readFileSync(
      path.join(roots.internal, 'apps', 'web-internal', 'vite.config.ts'),
      'utf-8',
    )
    expect(vite).toContain('outDir')
    expect(vite).toContain("new URL('../api/web/build', import.meta.url)")
    const pkg = JSON.parse(fs.readFileSync(path.join(roots.internal, 'package.json'), 'utf-8'))
    expect(pkg.scripts['build:apps']).toBe('npm run build --workspace=apps/web-internal')
  })

  it('leaves the public app without the internal staff-SPA wiring', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(roots.public, 'package.json'), 'utf-8'))
    expect(pkg.scripts['build:apps']).not.toBe('npm run build --workspace=apps/web-internal')
    const vite = fs.readFileSync(path.join(roots.public, 'apps', 'web-internal', 'vite.config.ts'), 'utf-8')
    expect(vite).not.toContain('outDir')
  })

  it('carries the app-invariant specs but no generator artifacts in either variant', () => {
    for (const v of DUAL_VARIANTS) {
      expect(fs.existsSync(path.join(roots[v.dir], 'specs', '001-encore-app-architecture'))).toBe(true)
      expect(fs.existsSync(path.join(roots[v.dir], 'specs', '002-encore-generator-core'))).toBe(false)
      expect(fs.existsSync(path.join(roots[v.dir], 'modules'))).toBe(false)
      expect(fs.existsSync(path.join(roots[v.dir], 'scripts'))).toBe(false)
    }
  })
})

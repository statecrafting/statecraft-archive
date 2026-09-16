/**
 * Tests for the Encore single-app generator (spec 002).
 *
 * The setup-app CLI is split into pure, exported functions (resolveSource,
 * copyBaseline, setAuthDriver, composeWithModules) so the "lean baseline +
 * compose" machinery is testable without spawning a subprocess. The clone is
 * exercised against a synthetic lean baseline (makeBaselineFixture) that
 * contains one entry of every born-with classification, so the carry-forward
 * policy is verified deterministically (no dependency on the real template
 * tree); the driver selection is exercised against each profile.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PROFILES, copyBaseline, setAuthDriver, resolveSource } from './setup-app'
import { makeBaselineFixture, cleanTempDir } from './lib/__fixtures__/test-helpers'

// --- copyBaseline: born-with carry-forward policy --------------------------

describe('copyBaseline: born-with carry-forward', () => {
  let source: string
  let dest: string

  beforeAll(() => {
    source = makeBaselineFixture()
    dest = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-copy-'))
    copyBaseline(source, dest)
  })

  afterAll(() => {
    cleanTempDir(source)
    cleanTempDir(dest)
  })

  it('carries the app: apps/ and packages/', () => {
    expect(fs.existsSync(path.join(dest, 'apps', 'api'))).toBe(true)
    expect(fs.existsSync(path.join(dest, 'apps', 'web'))).toBe(true)
    expect(fs.existsSync(path.join(dest, 'apps', 'web-internal'))).toBe(true)
    expect(fs.existsSync(path.join(dest, 'packages', 'shared'))).toBe(true)
  })

  it('carries the born-with kernel (standards, spec-spine.toml, .claude, CODEMAP, AGENTS.md)', () => {
    expect(fs.existsSync(path.join(dest, 'standards', 'spec', 'constitution.md'))).toBe(true)
    expect(fs.existsSync(path.join(dest, 'spec-spine.toml'))).toBe(true)
    expect(fs.existsSync(path.join(dest, '.claude', 'skills', 'setup', 'SKILL.md'))).toBe(true)
    expect(fs.existsSync(path.join(dest, 'CODEMAP.md'))).toBe(true)
    expect(fs.existsSync(path.join(dest, 'AGENTS.md'))).toBe(true)
  })

  it('carries the baseline app specs (000-bootstrap, 001, 002) but drops every factory-encore meta-spec (000-008)', () => {
    // Baseline app specs are carried; their slugs differ from the meta-spec set.
    expect(fs.existsSync(path.join(dest, 'specs', '000-bootstrap'))).toBe(true)
    expect(fs.existsSync(path.join(dest, 'specs', '001-encore-app-architecture'))).toBe(true)
    expect(fs.existsSync(path.join(dest, 'specs', '002-security-data-invariants'))).toBe(true)
    // Every factory-encore generator meta-spec is dropped, including the kernel
    // (000), lockstep (006), and e2e-harness (007) specs added to the set after
    // it was first written.
    expect(fs.existsSync(path.join(dest, 'specs', '000-factory-kernel'))).toBe(false)
    expect(fs.existsSync(path.join(dest, 'specs', '002-encore-generator-core'))).toBe(false)
    expect(fs.existsSync(path.join(dest, 'specs', '005-architecture-doc-governance'))).toBe(false)
    expect(fs.existsSync(path.join(dest, 'specs', '006-factory-schema-lockstep'))).toBe(false)
    expect(fs.existsSync(path.join(dest, 'specs', '007-generator-e2e-harness'))).toBe(false)
    expect(fs.existsSync(path.join(dest, 'specs', '008-data-redis-promotion-dual-composition'))).toBe(false)
    // The template-encore docs-website spec is template-dev-only: it establishes
    // the stripped website/, so carrying it would fail the produced app's own
    // `spec-spine index check` with I-004 on the missing website/ unit.
    expect(fs.existsSync(path.join(dest, 'specs', '016-docs-website'))).toBe(false)
  })

  it('carries .github/workflows but drops the docs-website deploy workflow', () => {
    // ci-supply-chain is born-with the app (the carried specs + CI depend on it);
    // deploy-docs.yml is the stripped website's satellite and must not ship.
    expect(fs.existsSync(path.join(dest, '.github', 'workflows', 'ci-supply-chain.yml'))).toBe(true)
    expect(fs.existsSync(path.join(dest, '.github', 'workflows', 'deploy-docs.yml'))).toBe(false)
  })

  it('does not carry generator artifacts (the generator, the catalog, orchestration, .derived, website)', () => {
    // `website/` is the template's own Docusaurus docs site (template-dev only);
    // it has no runtime role in a produced app and must not ship into it.
    for (const artifact of ['scripts', 'modules', 'orchestration', '.derived', 'website']) {
      expect(fs.existsSync(path.join(dest, artifact))).toBe(false)
    }
  })

  it('carries the born-with governance substrate (Makefile, tools/lint) the produced specs + CI require', () => {
    // Makefile is established by the carried spec 000-bootstrap; tools/lint is
    // run by the carried ci-supply-chain workflow. Stripping them made every
    // produced app fail its own born-with CI (I-004 on the Makefile unit;
    // exit 127 on the missing lint script).
    expect(fs.existsSync(path.join(dest, 'Makefile'))).toBe(true)
    expect(fs.existsSync(path.join(dest, 'tools', 'lint', 'x.sh'))).toBe(true)
  })

  it('carries root config files', () => {
    expect(fs.existsSync(path.join(dest, 'package.json'))).toBe(true)
    expect(fs.existsSync(path.join(dest, 'eslint.config.mjs'))).toBe(true)
  })

  it('keeps docs/ but excludes the template-dev docs (encore-ts, migration)', () => {
    expect(fs.existsSync(path.join(dest, 'docs', 'DEVELOPMENT.md'))).toBe(true)
    expect(fs.existsSync(path.join(dest, 'docs', 'encore-ts'))).toBe(false)
    expect(fs.existsSync(path.join(dest, 'docs', 'migration'))).toBe(false)
  })

  it('keeps the tracked SPA placeholder apps/api/web/build/index.html (spa-static-serving)', () => {
    expect(fs.existsSync(path.join(dest, 'apps', 'api', 'web', 'build', 'index.html'))).toBe(true)
  })

  it('does not copy node_modules or .git anywhere in the tree', () => {
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '.git') {
            offenders.push(path.relative(dest, path.join(dir, entry.name)))
            continue
          }
          walk(path.join(dir, entry.name))
        }
      }
    }
    walk(dest)
    expect(offenders).toEqual([])
  })

  it('produces an app with no express dependency anywhere', () => {
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules') continue
          walk(full)
        } else if (entry.name === 'package.json') {
          const pkg = JSON.parse(fs.readFileSync(full, 'utf-8'))
          const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
          if ('express' in deps || 'express-session' in deps) {
            offenders.push(path.relative(dest, full).replace(/\\/g, '/'))
          }
        }
      }
    }
    walk(dest)
    expect(offenders).toEqual([])
  })
})

// --- copyBaseline against the real sibling baseline (local only) -----------

describe('copyBaseline: real template-encore baseline (when reachable)', () => {
  const source = resolveSource([])

  it.runIf(source !== null)('clones the real baseline with no express dependency anywhere', () => {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-real-'))
    try {
      copyBaseline(source as string, dest)
      expect(fs.existsSync(path.join(dest, 'apps', 'api'))).toBe(true)
      // generator artifacts must not leak into a produced app
      expect(fs.existsSync(path.join(dest, 'scripts'))).toBe(false)
      expect(fs.existsSync(path.join(dest, 'modules'))).toBe(false)
      const offenders: string[] = []
      const walk = (dir: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            if (entry.name === 'node_modules') continue
            walk(full)
          } else if (entry.name === 'package.json') {
            const pkg = JSON.parse(fs.readFileSync(full, 'utf-8'))
            const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
            if ('express' in deps || 'express-session' in deps) offenders.push(path.relative(dest, full))
          }
        }
      }
      walk(dest)
      expect(offenders).toEqual([])
    } finally {
      cleanTempDir(dest)
    }
  })
})

// --- setAuthDriver per profile ---------------------------------------------

describe('setAuthDriver: per profile', () => {
  let source: string
  let dest: string

  beforeAll(() => {
    source = makeBaselineFixture()
    dest = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-driver-'))
    copyBaseline(source, dest)
  })

  afterAll(() => {
    cleanTempDir(source)
    cleanTempDir(dest)
  })

  for (const [key, profile] of Object.entries(PROFILES)) {
    it(`sets AUTH_DRIVER=${profile.authDriver} for profile "${key}"`, () => {
      const ok = setAuthDriver(dest, profile.authDriver)
      expect(ok).toBe(true)
      const env = fs.readFileSync(path.join(dest, 'apps', 'api', '.env.example'), 'utf-8')
      expect(env).toMatch(new RegExp(`^AUTH_DRIVER=${profile.authDriver}$`, 'm'))
      const count = env.split('\n').filter((l) => /^AUTH_DRIVER=/.test(l)).length
      expect(count).toBe(1)
    })
  }
})

describe('setAuthDriver: append when absent', () => {
  let dest: string

  beforeAll(() => {
    dest = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-driver-append-'))
    fs.mkdirSync(path.join(dest, 'apps', 'api'), { recursive: true })
    fs.writeFileSync(path.join(dest, 'apps', 'api', '.env.example'), '# config\nNODE_ENV=development\n')
  })

  afterAll(() => {
    cleanTempDir(dest)
  })

  it('appends AUTH_DRIVER when the file has none', () => {
    expect(setAuthDriver(dest, 'rauthy')).toBe(true)
    const env = fs.readFileSync(path.join(dest, 'apps', 'api', '.env.example'), 'utf-8')
    expect(env).toMatch(/^AUTH_DRIVER=rauthy$/m)
    expect(env).toContain('NODE_ENV=development')
  })

  it('returns false when apps/api/.env.example is absent', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-noenv-'))
    expect(setAuthDriver(empty, 'mock')).toBe(false)
    cleanTempDir(empty)
  })
})

// --- resolveSource ----------------------------------------------------------

describe('resolveSource', () => {
  it('honours an explicit --source flag', () => {
    expect(resolveSource(['--source', '/tmp/some-baseline'])).toBe(path.resolve('/tmp/some-baseline'))
  })

  it('honours TEMPLATE_ENCORE_SOURCE when no flag is given', () => {
    const prev = process.env.TEMPLATE_ENCORE_SOURCE
    process.env.TEMPLATE_ENCORE_SOURCE = '/tmp/env-baseline'
    try {
      expect(resolveSource([])).toBe(path.resolve('/tmp/env-baseline'))
    } finally {
      if (prev === undefined) delete process.env.TEMPLATE_ENCORE_SOURCE
      else process.env.TEMPLATE_ENCORE_SOURCE = prev
    }
  })
})

// --- profile definitions ----------------------------------------------------

describe('PROFILES', () => {
  it('defines minimal/public/internal with the expected drivers', () => {
    expect(PROFILES.minimal?.authDriver).toBe('mock')
    expect(PROFILES.public?.authDriver).toBe('rauthy')
    expect(PROFILES.internal?.authDriver).toBe('rauthy')
  })
})

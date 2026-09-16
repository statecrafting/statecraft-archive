import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { TemplateJson } from '../template-json'

export const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..')
export const REAL_MODULES_DIR = path.join(PROJECT_ROOT, 'modules')

export function buildEmptyState(): TemplateJson {
  return {
    templateName: 'template-encore',
    baseVersion: '3.0.0',
    modules: {},
    fileOwnership: {},
  }
}

export function buildStateWithModules(
  modules: Record<string, { version?: string; alwaysOn?: boolean; files?: Record<string, string> }>,
): TemplateJson {
  const state = buildEmptyState()
  for (const [name, opts] of Object.entries(modules)) {
    state.modules[name] = {
      version: opts.version ?? '1.0.0',
      installedAt: '2025-01-01',
      ...(opts.alwaysOn ? { alwaysOn: true } : {}),
    }
    if (opts.files) {
      for (const [, dest] of Object.entries(opts.files)) {
        state.fileOwnership[dest] = name
      }
    }
  }
  return state
}

export function createTempProjectDir(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'module-test-'))

  // Create minimal project structure
  fs.writeFileSync(
    path.join(tmpDir, 'template.json'),
    JSON.stringify(buildEmptyState(), null, 2) + '\n',
  )
  fs.writeFileSync(path.join(tmpDir, '.env.example'), '# Environment variables\nNODE_ENV=development\n')
  fs.writeFileSync(
    path.join(tmpDir, 'package.json'),
    JSON.stringify({ name: 'test-project', workspaces: ['apps/*', 'packages/*'] }, null, 2) + '\n',
  )

  // Create workspace directories and minimal package.json files. The Encore
  // base app has no apps/api/src/** tree (services are top-level dirs); module
  // payloads now land in apps/web/** (frontend) or compose Encore service dirs,
  // so only the workspace roots are pre-seeded here.
  const dirs = [
    'apps/api',
    'apps/web/src',
  ]
  for (const dir of dirs) {
    fs.mkdirSync(path.join(tmpDir, dir), { recursive: true })
  }

  fs.writeFileSync(
    path.join(tmpDir, 'apps/api/package.json'),
    JSON.stringify({ name: '@template/api', dependencies: {} }, null, 2) + '\n',
  )

  return tmpDir
}

/**
 * Copy real module manifests and create stub source files in a temp project dir.
 */
export function copyModulesToTempDir(tmpDir: string, moduleNames: string[]): void {
  for (const name of moduleNames) {
    const srcManifestPath = path.join(REAL_MODULES_DIR, name, 'manifest.json')
    if (!fs.existsSync(srcManifestPath)) continue

    // Copy manifest
    const destModuleDir = path.join(tmpDir, 'modules', name)
    fs.mkdirSync(destModuleDir, { recursive: true })
    fs.copyFileSync(srcManifestPath, path.join(destModuleDir, 'manifest.json'))

    // Create stub source files
    const manifest = JSON.parse(fs.readFileSync(srcManifestPath, 'utf-8'))
    const files: Record<string, string> = manifest.files ?? {}
    for (const src of Object.keys(files)) {
      const stubPath = path.join(destModuleDir, 'files', src)
      fs.mkdirSync(path.dirname(stubPath), { recursive: true })
      fs.writeFileSync(stubPath, '// stub\n')
    }
  }
}

export function cleanTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true })
}

export function readRealManifest(moduleName: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(REAL_MODULES_DIR, moduleName, 'manifest.json'), 'utf-8'),
  ) as Record<string, unknown>
}

// The auth-* / service-auth modules were retired in spec 003 (auth-driver
// selection is configuration over the in-app drivers, not file-copy modules).
// These four are the surviving cross-cutting/infra modules; their own Encore
// reconciliation is staged by the taxonomy (spec 002), not P3.
export const ALL_MODULE_NAMES = [
  'api-gateway',
  'data-postgres',
  'data-redis',
  'security-core',
]

/**
 * Recursively copy a REAL module from the repo's modules/ catalog into a temp
 * project dir (manifest + files/** + web snippet), so service-composition can
 * be exercised against the actual payload (not the stubbed files that
 * copyModulesToTempDir creates). Returns the copied module directory.
 */
export function copyRealModule(tmpDir: string, moduleName: string): string {
  const src = path.join(REAL_MODULES_DIR, moduleName)
  const dest = path.join(tmpDir, 'modules', moduleName)
  fs.cpSync(src, dest, { recursive: true })
  return dest
}

/**
 * Write a v2 (Encore) service module under `<dir>/widget/` for composer tests.
 *
 * Layout produced:
 *   <dir>/widget/manifest.json
 *   <dir>/widget/files/widget/encore.service.ts
 *   <dir>/widget/files/widget/widget.ts
 *   <dir>/widget/files/db/1_widget.up.sql
 *
 * The manifest declares one service, one migration, one secret, and one CORS
 * entry — exactly the surface composeModule / decomposeModule operate on.
 * Returns the module directory (`<dir>/widget`).
 */
export function makeFixtureServiceModule(dir: string): string {
  const moduleName = 'widget'
  const moduleDir = path.join(dir, moduleName)
  const filesDir = path.join(moduleDir, 'files')

  const manifest = {
    name: moduleName,
    version: '1.0.0',
    description: 'Fixture Encore service module for composer tests',
    status: 'stable',
    services: ['widget'],
    migrations: [{ source: 'db/1_widget.up.sql', description: 'create widget table' }],
    secrets: [{ name: 'WIDGET_API_KEY', description: 'widget upstream API key', required: true }],
    corsEntries: [{ field: 'allow_headers', values: ['X-Widget'] }],
  }

  fs.mkdirSync(path.join(filesDir, 'widget'), { recursive: true })
  fs.mkdirSync(path.join(filesDir, 'db'), { recursive: true })

  fs.writeFileSync(path.join(moduleDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  fs.writeFileSync(
    path.join(filesDir, 'widget', 'encore.service.ts'),
    "import { Service } from 'encore.dev/service'\nexport default new Service('widget')\n",
  )
  fs.writeFileSync(
    path.join(filesDir, 'widget', 'widget.ts'),
    "import { api } from 'encore.dev/api'\nexport const ping = api({ expose: true, method: 'GET', path: '/widget' }, async () => ({ ok: true }))\n",
  )
  fs.writeFileSync(
    path.join(filesDir, 'db', '1_widget.up.sql'),
    'CREATE TABLE widget ( id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL );\n',
  )

  return moduleDir
}

/**
 * Write a minimal Encore `apps/api` directory under `<dir>/apps/api` for
 * composer integration tests. Seeds db/migrations with `1_*.up.sql` and
 * `2_*.up.sql` so renumbering must pick the next free prefix (3), an
 * infra.config.json with one existing secret, and an encore.app with a
 * global_cors block. Returns the apps/api directory path.
 */
export function makeFixtureApiDir(dir: string): string {
  const apiDir = path.join(dir, 'apps', 'api')
  const migrationsDir = path.join(apiDir, 'db', 'migrations')
  fs.mkdirSync(migrationsDir, { recursive: true })

  fs.writeFileSync(path.join(migrationsDir, '1_init.up.sql'), 'CREATE TABLE init ( id BIGSERIAL PRIMARY KEY );\n')
  fs.writeFileSync(path.join(migrationsDir, '2_users.up.sql'), 'CREATE TABLE users ( id BIGSERIAL PRIMARY KEY );\n')

  const infra = {
    $schema: 'https://encore.dev/schemas/infra.schema.json',
    secrets: {
      JWT_PRIVATE_KEY: { $env: 'JWT_PRIVATE_KEY' },
    },
    sql_servers: [],
  }
  fs.writeFileSync(path.join(apiDir, 'infra.config.json'), JSON.stringify(infra, null, 2) + '\n')

  const encoreApp = {
    id: '',
    lang: 'typescript',
    global_cors: {
      allow_headers: ['Authorization', 'Content-Type'],
      allow_origins_with_credentials: ['http://localhost:5173'],
    },
  }
  fs.writeFileSync(path.join(apiDir, 'encore.app'), JSON.stringify(encoreApp, null, 2) + '\n')

  return apiDir
}

function writeFile(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
}

/**
 * Build a synthetic "lean baseline" source tree that exercises every born-with
 * classification, so the generator's clone (copyBaseline) can be unit-tested
 * deterministically without depending on the real (large) template-encore tree.
 *
 * It contains, by carry decision:
 *   kernel (carried):  standards/, spec-spine.toml, .claude/, CODEMAP.md,
 *                      AGENTS.md, Makefile, tools/ (governance substrate the
 *                      carried specs + CI require)
 *   app (carried):     apps/, packages/, root config, docs/ (minus dev docs),
 *                      .github/workflows/ci-supply-chain.yml,
 *                      specs/000-bootstrap + specs/001-encore-app-architecture +
 *                      specs/002-security-data-invariants (baseline app specs)
 *   generator-artifact (skipped): scripts/, modules/, orchestration/,
 *                      .derived/, website/ (the template's own Docusaurus docs),
 *                      the factory-encore meta-specs (000-factory-kernel,
 *                      002-encore-generator-core, 005-architecture-doc-governance,
 *                      006-factory-schema-lockstep, 007-generator-e2e-harness),
 *                      specs/016-docs-website (template-dev spec governing the
 *                      stripped website/), .github/workflows/deploy-docs.yml,
 *                      node_modules/, .git/, docs/encore-ts
 *
 * Returns the baseline root path.
 */
export function makeBaselineFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baseline-'))

  // --- app: Encore backend (core services already present in the baseline) ---
  writeFile(root, 'apps/api/.env.example', '# config\nNODE_ENV=development\n')
  writeFile(
    root,
    'apps/api/package.json',
    JSON.stringify({ name: '@app/api', dependencies: {}, devDependencies: {} }, null, 2) + '\n',
  )
  writeFile(root, 'apps/api/web/build/index.html', '<!doctype html><title>placeholder</title>\n')
  writeFile(root, 'apps/api/auth/encore.service.ts', "export default 'auth'\n")
  writeFile(root, 'apps/api/db/db.ts', "export const db = 'app'\n")
  writeFile(root, 'apps/api/gateway/proxy.ts', "export const proxy = true\n")
  writeFile(root, 'apps/api/health/api.ts', "export const health = true\n")
  writeFile(root, 'apps/api/lib/jwt.ts', "export const jwt = true\n")
  writeFile(root, 'apps/api/web/static.ts', "export const web = true\n")

  // --- app: SPAs + shared package + root config ---
  writeFile(root, 'apps/web/package.json', JSON.stringify({ name: '@app/web' }, null, 2) + '\n')
  writeFile(root, 'apps/web/vite.config.ts', 'export default {}\n')
  writeFile(root, 'apps/web-internal/package.json', JSON.stringify({ name: '@app/web-internal' }, null, 2) + '\n')
  writeFile(
    root,
    'apps/web-internal/vite.config.ts',
    "import { fileURLToPath } from 'node:url'\nexport default {\n  plugins: [],\n  server: {\n    port: 5174,\n  },\n}\n",
  )
  writeFile(root, 'packages/shared/package.json', JSON.stringify({ name: '@app/shared' }, null, 2) + '\n')
  writeFile(
    root,
    'package.json',
    JSON.stringify(
      { name: 'app', workspaces: ['apps/web', 'apps/web-internal', 'packages/*'], scripts: { 'build:apps': 'npm run build --workspaces' } },
      null,
      2,
    ) + '\n',
  )
  writeFile(root, 'eslint.config.mjs', 'export default []\n')

  // --- app: CI workflows (carried), except the docs-website deploy workflow ---
  // ci-supply-chain is born-with the app; deploy-docs.yml is the stripped
  // website's satellite (spec 016-docs-website) and must not ship.
  writeFile(root, '.github/workflows/ci-supply-chain.yml', 'name: ci\non: [push]\n')
  writeFile(root, '.github/workflows/deploy-docs.yml', 'name: Deploy docs\non: [push]\n')

  // --- app: docs (kept), template-dev docs (skipped) ---
  writeFile(root, 'docs/DEVELOPMENT.md', '# Development\n')
  writeFile(root, 'docs/encore-ts/ref.md', '# template-dev only\n')
  writeFile(root, 'docs/migration/plan.md', '# template-dev only\n')

  // --- born-with kernel (carried) ---
  writeFile(root, 'standards/spec/constitution.md', '# Constitution\n')
  writeFile(root, 'spec-spine.toml', '[domains]\nallowed = ["app"]\n')
  writeFile(root, '.claude/skills/setup/SKILL.md', '# Setup skill\n')
  writeFile(root, 'CODEMAP.md', '# CODEMAP\n')
  writeFile(root, 'AGENTS.md', '# Agent guide (vendor-neutral kernel)\n')

  // --- app specs + baseline bootstrap (carried), generator meta-specs
  //     (skipped). The baseline's own slugs (000-bootstrap,
  //     001-encore-app-architecture) differ from factory-encore's meta-spec
  //     slugs, so the drop set never removes a carried app spec. The meta set
  //     covers the full 000-007 corpus; 000/006/007 are seeded here to guard
  //     that they drop. ---
  writeFile(root, 'specs/000-bootstrap/spec.md', '# 000 baseline bootstrap\n')
  writeFile(root, 'specs/001-encore-app-architecture/spec.md', '# 001 app architecture\n')
  writeFile(root, 'specs/002-security-data-invariants/spec.md', '# 002 security/data\n')
  writeFile(root, 'specs/000-factory-kernel/spec.md', '# 000 generator meta (kernel)\n')
  writeFile(root, 'specs/002-encore-generator-core/spec.md', '# 002 generator meta\n')
  writeFile(root, 'specs/005-architecture-doc-governance/spec.md', '# 005 generator meta\n')
  writeFile(root, 'specs/006-factory-schema-lockstep/spec.md', '# 006 generator meta\n')
  writeFile(root, 'specs/007-generator-e2e-harness/spec.md', '# 007 generator meta\n')
  // Template-encore's own template-dev-only spec (governs the stripped docs
  // website). Seeded here to guard that TEMPLATE_DEV_SPEC_IDS drops it: carrying
  // it would fail the produced app's own `spec-spine index check` (I-004 on the
  // missing website/ unit it establishes).
  writeFile(root, 'specs/016-docs-website/spec.md', '# 016 docs website (template-dev)\n')

  // --- generator artifacts (skipped) ---
  writeFile(root, 'scripts/setup-app.ts', "console.log('generator')\n")
  writeFile(root, 'modules/security-core/manifest.json', '{ "name": "security-core" }\n')
  writeFile(root, 'orchestration/template-orchestrator.md', '# orchestrator\n')
  writeFile(root, '.derived/codebase-index/x.json', '{}\n')
  // website/ is the template's own Docusaurus docs site (template-dev only);
  // it must not ship into a produced app.
  writeFile(root, 'website/docusaurus.config.ts', "export default { title: 'acme-vue-encore' }\n")

  // --- born-with governance substrate (carried): the produced app's own
  // carried specs (000-bootstrap establishes Makefile) and CI
  // (ci-supply-chain runs tools/lint) depend on these ---
  writeFile(root, 'tools/lint/x.sh', '#!/bin/sh\n')
  writeFile(root, 'Makefile', 'all:\n')

  // --- skipped anywhere ---
  writeFile(root, 'node_modules/pkg/index.js', "module.exports = {}\n")
  writeFile(root, '.git/config', '[core]\n')

  return root
}

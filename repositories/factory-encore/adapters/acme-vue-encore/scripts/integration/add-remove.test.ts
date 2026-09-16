/**
 * Integration tests for add-module / remove-module workflows.
 *
 * These tests use real temp directories with real module manifests
 * and exercise the lib functions that power the CLI scripts.
 *
 * The auth-* / service-auth modules and the @template/auth barrel generator
 * were retired in spec 003 (auth-driver selection is configuration over the
 * in-app drivers, not file-copy modules). The four surviving cross-cutting
 * modules (security-core, api-gateway, data-postgres, data-redis) were
 * converted to thin declarative overlays in spec 001 (no apps/api/src/**
 * payloads; their backend function is in the base app's lib/db/gateway), so
 * security-core/data-* own no files and api-gateway contributes only its
 * frontend connectivity view. Service composition is exercised via the
 * `widget` fixture and the real `user-management` Encore service module.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { manifestSchema } from '../lib/manifest.schema'
import {
  loadTemplateJson,
  saveTemplateJson,
  isModuleInstalled,
  addModuleToState,
  removeModuleFromState,
  getFileOwner,
  getAllModules,
} from '../lib/template-json'
import { mergeEnvVars, commentOutEnvVars } from '../lib/env-merger'
import { composeModule, decomposeModule } from '../lib/encore-composer'
import {
  createTempProjectDir,
  cleanTempDir,
  copyModulesToTempDir,
  copyRealModule,
  makeFixtureServiceModule,
  makeFixtureApiDir,
  ALL_MODULE_NAMES,
} from '../lib/__fixtures__/test-helpers'

/**
 * Simulate the add-module workflow (same steps as add-module.ts without npm install or user prompts).
 */
function simulateAddModule(projectRoot: string, moduleName: string) {
  const manifestPath = path.join(projectRoot, 'modules', moduleName, 'manifest.json')
  const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
  const manifest = manifestSchema.parse(raw)

  let state = loadTemplateJson(projectRoot)

  // Validate status
  if (manifest.status !== 'stable') {
    throw new Error(`Module "${moduleName}" has status "${manifest.status}"`)
  }

  // Auto-remove conflicts
  const installedConflicts = manifest.conflicts.filter((c) => isModuleInstalled(state, c))
  for (const conflict of installedConflicts) {
    // Delete owned files
    const filesToDelete = Object.entries(state.fileOwnership)
      .filter(([, owner]) => owner === conflict)
      .map(([filePath]) => filePath)
    for (const fp of filesToDelete) {
      const full = path.resolve(projectRoot, fp)
      if (fs.existsSync(full)) fs.unlinkSync(full)
    }
    state = removeModuleFromState(state, conflict)

    // Comment out env vars for conflict
    try {
      const conflictManifestPath = path.join(projectRoot, 'modules', conflict, 'manifest.json')
      if (fs.existsSync(conflictManifestPath)) {
        const cRaw = JSON.parse(fs.readFileSync(conflictManifestPath, 'utf-8'))
        const cManifest = manifestSchema.parse(cRaw)
        if (Object.keys(cManifest.envVars).length > 0) {
          commentOutEnvVars(projectRoot, cManifest)
        }
      }
    } catch { /* ignore */ }
  }

  // Check requires
  for (const req of manifest.requires) {
    if (!isModuleInstalled(state, req)) {
      throw new Error(`Dependency not met: "${req}" must be installed before "${moduleName}"`)
    }
  }

  // Check requiresOneOf
  for (const group of manifest.requiresOneOf) {
    const satisfied = group.some((m) => isModuleInstalled(state, m))
    if (!satisfied) {
      throw new Error(
        `Dependency not met: at least one of [${group.join(', ')}] must be installed before "${moduleName}"`,
      )
    }
  }

  // Check file conflicts
  for (const [, dest] of Object.entries(manifest.files)) {
    const owner = getFileOwner(state, dest)
    if (owner && owner !== moduleName && !manifest.requires.includes(owner)) {
      throw new Error(`File conflict: "${dest}" is owned by "${owner}"`)
    }
  }

  // Copy files
  for (const [src, dest] of Object.entries(manifest.files)) {
    const srcPath = path.join(projectRoot, 'modules', moduleName, 'files', src)
    const destPath = path.resolve(projectRoot, dest)
    fs.mkdirSync(path.dirname(destPath), { recursive: true })
    fs.copyFileSync(srcPath, destPath)
  }

  // Update state
  state = addModuleToState(state, moduleName, manifest.version, manifest.files)
  saveTemplateJson(projectRoot, state)

  // Compose Encore services (copy service dirs, merge migrations/secrets/cors)
  if (
    manifest.services.length > 0 ||
    manifest.migrations.length > 0 ||
    manifest.secrets.length > 0 ||
    manifest.corsEntries.length > 0
  ) {
    const { migrationsAdded } = composeModule({
      moduleDir: path.join(projectRoot, 'modules', moduleName),
      manifest,
      apiDir: path.join(projectRoot, 'apps', 'api'),
    })
    // Record exact renumbered filenames so removal deletes precisely these.
    state.modules[moduleName].composedMigrations = migrationsAdded
    saveTemplateJson(projectRoot, state)
  }

  // Merge env vars
  if (Object.keys(manifest.envVars).length > 0) {
    mergeEnvVars(projectRoot, manifest)
  }

  return state
}

/**
 * Simulate the remove-module workflow.
 */
function simulateRemoveModule(projectRoot: string, moduleName: string) {
  let state = loadTemplateJson(projectRoot)

  if (!isModuleInstalled(state, moduleName)) {
    throw new Error(`Module "${moduleName}" is not installed`)
  }

  if (state.modules[moduleName].alwaysOn) {
    throw new Error(`Module "${moduleName}" is always-on and cannot be removed`)
  }

  // Check reverse dependencies
  const allInstalled = getAllModules(state)
  for (const otherName of allInstalled) {
    if (otherName === moduleName) continue
    const otherManifestPath = path.join(projectRoot, 'modules', otherName, 'manifest.json')
    if (!fs.existsSync(otherManifestPath)) continue
    const otherManifest = manifestSchema.parse(
      JSON.parse(fs.readFileSync(otherManifestPath, 'utf-8')),
    )

    if (otherManifest.requires.includes(moduleName)) {
      throw new Error(`Cannot remove "${moduleName}": module "${otherName}" requires it`)
    }

    for (const group of otherManifest.requiresOneOf) {
      if (group.includes(moduleName)) {
        const otherSatisfiers = group.filter(
          (m) => m !== moduleName && isModuleInstalled(state, m),
        )
        if (otherSatisfiers.length === 0) {
          throw new Error(
            `Cannot remove "${moduleName}": "${otherName}" requires one of [${group.join(', ')}]`,
          )
        }
      }
    }
  }

  // Delete owned files
  const ownedFiles = Object.entries(state.fileOwnership)
    .filter(([, owner]) => owner === moduleName)
    .map(([fp]) => fp)
  for (const fp of ownedFiles) {
    const full = path.resolve(projectRoot, fp)
    if (fs.existsSync(full)) fs.unlinkSync(full)
  }

  // Capture the exact composed migration filenames BEFORE the module leaves state.
  const composedMigrations = state.modules[moduleName].composedMigrations ?? []

  // Update state
  state = removeModuleFromState(state, moduleName)
  saveTemplateJson(projectRoot, state)

  // Comment out env vars + decompose Encore services
  const manifestPath = path.join(projectRoot, 'modules', moduleName, 'manifest.json')
  if (fs.existsSync(manifestPath)) {
    const manifest = manifestSchema.parse(JSON.parse(fs.readFileSync(manifestPath, 'utf-8')))
    if (Object.keys(manifest.envVars).length > 0) {
      commentOutEnvVars(projectRoot, manifest)
    }
    if (
      manifest.services.length > 0 ||
      manifest.migrations.length > 0 ||
      manifest.secrets.length > 0 ||
      manifest.corsEntries.length > 0
    ) {
      decomposeModule({
        moduleDir: path.join(projectRoot, 'modules', moduleName),
        manifest,
        apiDir: path.join(projectRoot, 'apps', 'api'),
        composedMigrations,
      })
    }
  }

  return state
}

describe('add-module workflow', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = createTempProjectDir()
    copyModulesToTempDir(tmpDir, ALL_MODULE_NAMES)
  })

  afterEach(() => {
    cleanTempDir(tmpDir)
  })

  it('installs security-core (declarative overlay): records state + merges env, owns no files', () => {
    const state = simulateAddModule(tmpDir, 'security-core')
    expect(isModuleInstalled(state, 'security-core')).toBe(true)

    // Converted to a declarative overlay (spec 001): no apps/api/src/** payload.
    const manifest = manifestSchema.parse(
      JSON.parse(fs.readFileSync(path.join(tmpDir, 'modules/security-core/manifest.json'), 'utf-8')),
    )
    expect(Object.keys(manifest.files)).toHaveLength(0)
    // No files => no ownership entries for this module.
    expect(Object.values(state.fileOwnership)).not.toContain('security-core')
    // Its CORS_ORIGIN knob is merged into .env.example.
    expect(fs.readFileSync(path.join(tmpDir, '.env.example'), 'utf-8')).toContain('CORS_ORIGIN')
  })

  it('installs api-gateway once its dependency (security-core) is present, copying its frontend view', () => {
    simulateAddModule(tmpDir, 'security-core')
    const state = simulateAddModule(tmpDir, 'api-gateway')
    expect(isModuleInstalled(state, 'api-gateway')).toBe(true)
    expect(isModuleInstalled(state, 'security-core')).toBe(true)
    // api-gateway's only payload is the frontend /connectivity test view.
    const view = 'apps/web/src/views/ConnectivityTestView.vue'
    expect(fs.existsSync(path.resolve(tmpDir, view))).toBe(true)
    expect(getFileOwner(state, view)).toBe('api-gateway')
  })

  it('rejects api-gateway when its dependency (security-core) is absent', () => {
    expect(() => simulateAddModule(tmpDir, 'api-gateway')).toThrow(
      /Dependency not met.*security-core/,
    )
  })
})

// ─── Encore service-module composition via the rewritten add/remove logic ───

describe('Encore service-module composition (fixture)', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = createTempProjectDir()
    makeFixtureApiDir(tmpDir) // seeds apps/api with migrations/secrets/cors
    makeFixtureServiceModule(path.join(tmpDir, 'modules')) // writes modules/widget
  })

  afterEach(() => {
    cleanTempDir(tmpDir)
  })

  it('installs the fixture service module: tracks state and composes apps/api', () => {
    const state = simulateAddModule(tmpDir, 'widget')
    expect(isModuleInstalled(state, 'widget')).toBe(true)

    // service dir composed
    expect(fs.existsSync(path.join(tmpDir, 'apps', 'api', 'widget', 'encore.service.ts'))).toBe(true)
    // migration renumbered onto next free prefix (3, since fixture api has 1_/2_)
    expect(fs.existsSync(path.join(tmpDir, 'apps', 'api', 'db', 'migrations', '3_widget.up.sql'))).toBe(true)
    // secret binding added (never a value)
    const infra = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'apps', 'api', 'infra.config.json'), 'utf-8'),
    )
    expect(infra.secrets.WIDGET_API_KEY).toEqual({ $env: 'WIDGET_API_KEY' })
    // cors entry merged
    const app = JSON.parse(fs.readFileSync(path.join(tmpDir, 'apps', 'api', 'encore.app'), 'utf-8'))
    expect(app.global_cors.allow_headers).toContain('X-Widget')
  })

  it('removing the fixture service module decomposes apps/api fully', () => {
    simulateAddModule(tmpDir, 'widget')
    const state = simulateRemoveModule(tmpDir, 'widget')

    expect(isModuleInstalled(state, 'widget')).toBe(false)
    expect(fs.existsSync(path.join(tmpDir, 'apps', 'api', 'widget'))).toBe(false)
    expect(fs.existsSync(path.join(tmpDir, 'apps', 'api', 'db', 'migrations', '3_widget.up.sql'))).toBe(false)
    const infra = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'apps', 'api', 'infra.config.json'), 'utf-8'),
    )
    expect(infra.secrets.WIDGET_API_KEY).toBeUndefined()
    expect(infra.secrets.JWT_PRIVATE_KEY).toEqual({ $env: 'JWT_PRIVATE_KEY' })
    const app = JSON.parse(fs.readFileSync(path.join(tmpDir, 'apps', 'api', 'encore.app'), 'utf-8'))
    expect(app.global_cors.allow_headers).not.toContain('X-Widget')
  })
})

// ─── Real user-management Encore service module (spec 003) ──────────────────
//
// The reference feature module: composing it copies a real Encore service
// directory and merges its migration onto the next free prefix. (Its SQL/graph
// validity is proven separately by `encore check` on a composed app.)

describe('user-management module — Encore service composition', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = createTempProjectDir()
    makeFixtureApiDir(tmpDir) // seeds db/migrations with 1_/2_
    copyRealModule(tmpDir, 'user-management')
  })

  afterEach(() => {
    cleanTempDir(tmpDir)
  })

  it('composes the user-management service directory + its migration', () => {
    const state = simulateAddModule(tmpDir, 'user-management')
    expect(isModuleInstalled(state, 'user-management')).toBe(true)

    const apiDir = path.join(tmpDir, 'apps', 'api')
    // The Encore service directory is copied verbatim.
    expect(fs.existsSync(path.join(apiDir, 'user-management', 'encore.service.ts'))).toBe(true)
    expect(fs.existsSync(path.join(apiDir, 'user-management', 'users.ts'))).toBe(true)
    expect(fs.existsSync(path.join(apiDir, 'user-management', 'roles.ts'))).toBe(true)
    expect(fs.existsSync(path.join(apiDir, 'user-management', 'model.ts'))).toBe(true)
    // The migration is renumbered onto the next free prefix (3, after 1_/2_).
    expect(fs.existsSync(path.join(apiDir, 'db', 'migrations', '3_user_management.up.sql'))).toBe(true)
    expect(state.modules['user-management'].composedMigrations).toEqual(['3_user_management.up.sql'])
    // The module ships no Express backend tree: the retired src/controllers +
    // src/services payloads are not produced (these dirs are not seeded by the
    // fixture, unlike the generic src/{config,middleware,utils,routes}).
    expect(fs.existsSync(path.join(apiDir, 'src', 'controllers'))).toBe(false)
    expect(fs.existsSync(path.join(apiDir, 'src', 'services', 'user-management.service.ts'))).toBe(false)
  })

  it('fully decomposes on removal (service dir + migration gone, base intact)', () => {
    simulateAddModule(tmpDir, 'user-management')
    const state = simulateRemoveModule(tmpDir, 'user-management')

    const apiDir = path.join(tmpDir, 'apps', 'api')
    expect(isModuleInstalled(state, 'user-management')).toBe(false)
    expect(fs.existsSync(path.join(apiDir, 'user-management'))).toBe(false)
    expect(fs.existsSync(path.join(apiDir, 'db', 'migrations', '3_user_management.up.sql'))).toBe(false)
    // Base migrations untouched.
    expect(fs.existsSync(path.join(apiDir, 'db', 'migrations', '1_init.up.sql'))).toBe(true)
    expect(fs.existsSync(path.join(apiDir, 'db', 'migrations', '2_users.up.sql'))).toBe(true)
  })
})

// ─── Real cron scheduler Encore service module (spec 009) ───────────────────
//
// The in-app self-hosted scheduler: composing it copies the scheduler service
// directory and merges its task_schedules migration onto the next free prefix.
// The store extends the base app's single SQLDatabase("app") (INV-11), so it
// declares no per-service database. (Runtime firing is proven separately by
// `encore check` + the build lane on a composed app.)

describe('cron module: Encore service composition', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = createTempProjectDir()
    makeFixtureApiDir(tmpDir) // seeds db/migrations with 1_/2_
    // cron requires data-postgres (a declarative marker, no payload); install it
    // first so the dependency check is satisfied (AC-6 requires: [data-postgres]).
    copyRealModule(tmpDir, 'data-postgres')
    copyRealModule(tmpDir, 'cron')
    simulateAddModule(tmpDir, 'data-postgres')
  })

  afterEach(() => {
    cleanTempDir(tmpDir)
  })

  it('composes the scheduler service directory + its migration (AC-1)', () => {
    const state = simulateAddModule(tmpDir, 'cron')
    expect(isModuleInstalled(state, 'cron')).toBe(true)

    const apiDir = path.join(tmpDir, 'apps', 'api')
    // The Encore service directory is copied verbatim.
    expect(fs.existsSync(path.join(apiDir, 'scheduler', 'encore.service.ts'))).toBe(true)
    expect(fs.existsSync(path.join(apiDir, 'scheduler', 'store.ts'))).toBe(true)
    expect(fs.existsSync(path.join(apiDir, 'scheduler', 'api.ts'))).toBe(true)
    expect(fs.existsSync(path.join(apiDir, 'scheduler', 'worker.ts'))).toBe(true)
    expect(fs.existsSync(path.join(apiDir, 'scheduler', 'lock.ts'))).toBe(true)
    // The migration is renumbered onto the next free prefix (3, after 1_/2_).
    expect(
      fs.existsSync(path.join(apiDir, 'db', 'migrations', '3_create_task_schedules.up.sql')),
    ).toBe(true)
    expect(state.modules['cron'].composedMigrations).toEqual(['3_create_task_schedules.up.sql'])
    // INV-11 (AC-3): the store references the shared app db, not a per-service one.
    const store = fs.readFileSync(path.join(apiDir, 'scheduler', 'store.ts'), 'utf-8')
    expect(store).toContain('SQLDatabase.named("app")')
    expect(store).not.toContain('new SQLDatabase(')
  })

  it('fully decomposes on removal (service dir + migration gone, base intact) (AC-2)', () => {
    simulateAddModule(tmpDir, 'cron')
    const state = simulateRemoveModule(tmpDir, 'cron')

    const apiDir = path.join(tmpDir, 'apps', 'api')
    expect(isModuleInstalled(state, 'cron')).toBe(false)
    expect(fs.existsSync(path.join(apiDir, 'scheduler'))).toBe(false)
    expect(
      fs.existsSync(path.join(apiDir, 'db', 'migrations', '3_create_task_schedules.up.sql')),
    ).toBe(false)
    // Base migrations untouched.
    expect(fs.existsSync(path.join(apiDir, 'db', 'migrations', '1_init.up.sql'))).toBe(true)
    expect(fs.existsSync(path.join(apiDir, 'db', 'migrations', '2_users.up.sql'))).toBe(true)
  })
})

describe('remove-module workflow', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = createTempProjectDir()
    copyModulesToTempDir(tmpDir, ALL_MODULE_NAMES)
  })

  afterEach(() => {
    cleanTempDir(tmpDir)
  })

  it('removes module, deletes files, and updates state', () => {
    simulateAddModule(tmpDir, 'security-core')
    const stateBefore = loadTemplateJson(tmpDir)
    expect(isModuleInstalled(stateBefore, 'security-core')).toBe(true)

    simulateRemoveModule(tmpDir, 'security-core')
    const stateAfter = loadTemplateJson(tmpDir)
    expect(isModuleInstalled(stateAfter, 'security-core')).toBe(false)
    expect(Object.values(stateAfter.fileOwnership)).not.toContain('security-core')
  })

  it('comments out env vars in .env.example on removal', () => {
    simulateAddModule(tmpDir, 'data-redis')
    let content = fs.readFileSync(path.join(tmpDir, '.env.example'), 'utf-8')
    expect(content).toContain('REDIS_HOST')

    simulateRemoveModule(tmpDir, 'data-redis')
    content = fs.readFileSync(path.join(tmpDir, '.env.example'), 'utf-8')
    expect(content).toContain('(removed with data-redis)')
  })

  it('rejects removing a module with reverse dependencies (api-gateway requires security-core)', () => {
    simulateAddModule(tmpDir, 'security-core')
    simulateAddModule(tmpDir, 'api-gateway')

    expect(() => simulateRemoveModule(tmpDir, 'security-core')).toThrow(
      /Cannot remove.*security-core.*api-gateway.*requires it/,
    )
  })

  it('rejects removing alwaysOn module', () => {
    simulateAddModule(tmpDir, 'security-core')
    // Manually mark as alwaysOn
    const state = loadTemplateJson(tmpDir)
    state.modules['security-core'].alwaysOn = true
    saveTemplateJson(tmpDir, state)

    expect(() => simulateRemoveModule(tmpDir, 'security-core')).toThrow(/always-on/)
  })

  it('throws when removing module that is not installed', () => {
    expect(() => simulateRemoveModule(tmpDir, 'data-redis')).toThrow(/not installed/)
  })
})

describe('dependency validation', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = createTempProjectDir()
    copyModulesToTempDir(tmpDir, ALL_MODULE_NAMES)
  })

  afterEach(() => {
    cleanTempDir(tmpDir)
  })

  it('requires: rejects if direct dependency not installed (api-gateway needs security-core)', () => {
    expect(() => simulateAddModule(tmpDir, 'api-gateway')).toThrow(/Dependency not met/)
  })

  it('requires: succeeds when all dependencies satisfied', () => {
    simulateAddModule(tmpDir, 'security-core')
    const state = simulateAddModule(tmpDir, 'api-gateway')
    expect(isModuleInstalled(state, 'api-gateway')).toBe(true)
  })

  it('data modules install with no dependencies', () => {
    expect(isModuleInstalled(simulateAddModule(tmpDir, 'data-postgres'), 'data-postgres')).toBe(true)
    expect(isModuleInstalled(simulateAddModule(tmpDir, 'data-redis'), 'data-redis')).toBe(true)
  })
})

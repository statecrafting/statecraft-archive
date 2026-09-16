/**
 * Shared single-module install (STRUCT-2 composition parity).
 *
 * Both entry points compose modules through this one path so the result is
 * identical regardless of who triggers it:
 *   - `add-module.ts` (per-request / incremental composition; keeps its own
 *     dependency resolution, conflict checks, and confirmation around this)
 *   - `setup-app.ts` (profile-default + --with composition at generate time)
 *
 * Before this existed, `setup-app` composed only the backend (`composeModule`),
 * silently dropping each module's web files, template.json record, env vars, and
 * workspace/dep changes, so a profile that shipped a module got a half-wired
 * app. This function performs the complete install: the steps `add-module.ts`
 * used to inline (copy files, record state, compose backend, regenerate the web
 * module loader, merge env vars, apply workspace + package-dep changes).
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { type ModuleManifest } from './manifest.schema'
import { addModuleToState, type TemplateJson } from './template-json'
import { generateWebModulesTs } from './modules-ts-generator'
import { mergeEnvVars } from './env-merger'
import { composeModule } from './encore-composer'

/** Add module-declared workspaces to the destination root package.json. */
export function applyWorkspaceChanges(
  projectRoot: string,
  changes: NonNullable<ModuleManifest['workspaceChanges']>,
): void {
  const pkgPath = path.join(projectRoot, 'package.json')
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
  const workspaces: string[] = pkg.workspaces ?? []
  if (changes.add) {
    for (const w of changes.add) if (!workspaces.includes(w)) workspaces.push(w)
  }
  pkg.workspaces = changes.remove
    ? workspaces.filter((w: string) => !changes.remove!.includes(w))
    : workspaces
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8')
}

/** Add module-declared dependencies into each target workspace's package.json. */
export function addPackageDeps(
  projectRoot: string,
  deps: Record<string, Record<string, string>>,
): void {
  for (const [workspace, packages] of Object.entries(deps)) {
    const pkgPath = path.join(projectRoot, workspace, 'package.json')
    if (!fs.existsSync(pkgPath)) continue
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
    if (!pkg.dependencies) pkg.dependencies = {}
    for (const [dep, version] of Object.entries(packages)) pkg.dependencies[dep] = version
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8')
  }
}

export interface InstallModuleInput {
  /** Destination app root (where template.json, apps/, packages/ live). */
  projectRoot: string
  /** Adapter root containing the modules/ catalog (modules/<name>/...). */
  adapterRoot: string
  moduleName: string
  manifest: ModuleManifest
  /** Current template.json state; the returned state includes this module. */
  state: TemplateJson
}

export interface InstallModuleResult {
  state: TemplateJson
  filesCopied: string[]
  migrationsAdded: string[]
  secretsAdded: string[]
  envAdded: string[]
  webModulesRegenerated: boolean
}

/**
 * Install one module into the destination app. Pure of CLI concerns (no
 * prompts, no npm install): the caller owns dependency ordering, conflict
 * policy, persisting template.json, and any install/build step.
 */
export function installModule(input: InstallModuleInput): InstallModuleResult {
  const { projectRoot, adapterRoot, moduleName, manifest } = input
  const moduleFilesRoot = path.join(adapterRoot, 'modules', moduleName, 'files')

  // 1. Copy the module's declared files (web views, snippets, service sources
  //    declared as files, etc.) from the catalog into the destination.
  const filesCopied: string[] = []
  for (const [src, dest] of Object.entries(manifest.files)) {
    const srcPath = path.join(moduleFilesRoot, src)
    const destPath = path.resolve(projectRoot, dest)
    fs.mkdirSync(path.dirname(destPath), { recursive: true })
    fs.copyFileSync(srcPath, destPath)
    filesCopied.push(dest)
  }

  // 2. Record the module + its file ownership in template.json state.
  let state = addModuleToState(input.state, moduleName, manifest.version, manifest.files)

  // 3. Compose the backend (Encore services, migrations, secrets, CORS, and
  //    infra.config resource blocks such as the data-redis `redis` block).
  let migrationsAdded: string[] = []
  let secretsAdded: string[] = []
  if (
    manifest.services.length > 0 ||
    manifest.migrations.length > 0 ||
    manifest.secrets.length > 0 ||
    manifest.corsEntries.length > 0 ||
    // Generic over infraResources: composeModule must run for ANY declared
    // infra.config resource, not just `redis`. A type-specific check
    // (infraResources.redis !== undefined) would silently skip composition for a
    // future resource type (object storage, pub/sub, metrics) added to
    // infraResourcesSchema without a matching guard update here.
    Object.values(manifest.infraResources).some((r) => r !== undefined)
  ) {
    const moduleDir = path.join(adapterRoot, 'modules', moduleName)
    const apiDir = path.join(projectRoot, 'apps', 'api')
    const composed = composeModule({ moduleDir, manifest, apiDir })
    migrationsAdded = composed.migrationsAdded
    secretsAdded = composed.secretsAdded
    const entry = state.modules[moduleName]
    if (entry) entry.composedMigrations = migrationsAdded
  }

  // 4. Regenerate the web module loader (no-op unless a frontend-core module is
  //    present and modules contribute webSnippetFile blocks).
  let webModulesRegenerated = false
  const webModulesContent = generateWebModulesTs(projectRoot, state)
  if (webModulesContent) {
    fs.writeFileSync(path.join(projectRoot, 'apps/web/src/modules.ts'), webModulesContent, 'utf-8')
    webModulesRegenerated = true
  }

  // 5. Merge env vars into apps/api/.env.example.
  let envAdded: string[] = []
  if (Object.keys(manifest.envVars).length > 0) {
    envAdded = mergeEnvVars(projectRoot, manifest).added
  }

  // 6. Workspace + package-dependency changes.
  if (manifest.workspaceChanges) applyWorkspaceChanges(projectRoot, manifest.workspaceChanges)
  if (Object.keys(manifest.packageDeps).length > 0) addPackageDeps(projectRoot, manifest.packageDeps)

  return { state, filesCopied, migrationsAdded, secretsAdded, envAdded, webModulesRegenerated }
}

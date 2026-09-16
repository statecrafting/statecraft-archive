import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import * as readline from 'node:readline'
import { manifestSchema, type ModuleManifest } from './lib/manifest.schema'
import {
  loadTemplateJson,
  saveTemplateJson,
  isModuleInstalled,
  removeModuleFromState,
  getAllModules,
} from './lib/template-json'
import { generateWebModulesTs } from './lib/modules-ts-generator'
import { commentOutEnvVars } from './lib/env-merger'
import { decomposeModule } from './lib/encore-composer'

// Allow --root <path> or ROOT env var to override the destination project root (same as add-module.ts).
// MODULES_ROOT always points to the script's own repo so manifests are found even when targeting
// a different project via --root.
const _scriptDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const _rootArgIdx = process.argv.indexOf('--root')
const _rootOverride = _rootArgIdx !== -1 ? process.argv[_rootArgIdx + 1] : process.env.ROOT
const PROJECT_ROOT = _rootOverride ? path.resolve(_rootOverride) : _scriptDir
const MODULES_ROOT = _scriptDir

function loadModuleManifest(moduleName: string): ModuleManifest | null {
  const manifestPath = path.join(MODULES_ROOT, 'modules', moduleName, 'manifest.json')
  if (!fs.existsSync(manifestPath)) return null
  const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
  return manifestSchema.parse(raw)
}

function removePackageDeps(deps: Record<string, Record<string, string>>): void {
  for (const [workspace, packages] of Object.entries(deps)) {
    const pkgPath = path.join(PROJECT_ROOT, workspace, 'package.json')
    if (!fs.existsSync(pkgPath)) continue
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
    for (const dep of Object.keys(packages)) {
      if (pkg.dependencies?.[dep]) delete pkg.dependencies[dep]
      if (pkg.devDependencies?.[dep]) delete pkg.devDependencies[dep]
    }
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8')
  }
}

function reverseWorkspaces(changes: NonNullable<ModuleManifest['workspaceChanges']>): void {
  const pkgPath = path.join(PROJECT_ROOT, 'package.json')
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
  const workspaces: string[] = pkg.workspaces ?? []

  if (changes.add) {
    pkg.workspaces = workspaces.filter((w: string) => !changes.add!.includes(w))
  }
  if (changes.remove) {
    for (const w of changes.remove) {
      if (!workspaces.includes(w)) pkg.workspaces.push(w)
    }
  }
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8')
}

function cleanEmptyDirs(filePath: string): void {
  let dir = path.dirname(filePath)
  while (dir !== PROJECT_ROOT && dir.startsWith(PROJECT_ROOT)) {
    try {
      const entries = fs.readdirSync(dir)
      if (entries.length === 0) {
        fs.rmdirSync(dir)
      } else {
        break
      }
    } catch {
      break
    }
    dir = path.dirname(dir)
  }
}

function confirm(message: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(`${message} (y/N) `, (answer) => {
      rl.close()
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes')
    })
  })
}

async function removeModule(moduleName: string, options: { skipConfirm: boolean; dryRun: boolean; noInstall: boolean }): Promise<void> {
  console.log(`\nRemoving module: ${moduleName}`)

  // Step 1: Load state
  let state = loadTemplateJson(PROJECT_ROOT)

  // Step 2: Check module is installed
  if (!isModuleInstalled(state, moduleName)) {
    throw new Error(`Module "${moduleName}" is not installed`)
  }

  // Step 3: Check not alwaysOn
  if (state.modules[moduleName].alwaysOn) {
    throw new Error(`Module "${moduleName}" is marked as always-on and cannot be removed`)
  }

  // Step 4: Load manifest
  const manifest = loadModuleManifest(moduleName)

  // Step 5: Check reverse dependencies
  const allInstalled = getAllModules(state)
  for (const otherName of allInstalled) {
    if (otherName === moduleName) continue
    const otherManifest = loadModuleManifest(otherName)
    if (!otherManifest) continue

    // Check requires
    if (otherManifest.requires.includes(moduleName)) {
      throw new Error(
        `Cannot remove "${moduleName}": module "${otherName}" requires it`,
      )
    }

    // Check requiresOneOf
    for (const group of otherManifest.requiresOneOf) {
      if (group.includes(moduleName)) {
        const otherSatisfiers = group.filter(
          (m) => m !== moduleName && isModuleInstalled(state, m),
        )
        if (otherSatisfiers.length === 0) {
          throw new Error(
            `Cannot remove "${moduleName}": module "${otherName}" requires one of [${group.join(', ')}] and no alternative is installed`,
          )
        }
      }
    }
  }

  // Step 6: Collect owned files
  const ownedFiles = Object.entries(state.fileOwnership)
    .filter(([, owner]) => owner === moduleName)
    .map(([filePath]) => filePath)

  // Step 7: Confirmation
  console.log(`\nFiles to remove: ${ownedFiles.length}`)
  for (const f of ownedFiles) {
    console.log(`  ${f}`)
  }

  if (options.dryRun) {
    console.log('\n[dry-run] No changes made.')
    return
  }

  if (!options.skipConfirm) {
    const ok = await confirm('\nProceed with removal?')
    if (!ok) {
      console.log('Aborted.')
      return
    }
  }

  // Step 8: Delete owned files
  for (const filePath of ownedFiles) {
    const fullPath = path.resolve(PROJECT_ROOT, filePath)
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath)
      console.log(`  Deleted: ${filePath}`)
    }
  }

  // Step 9: Clean empty directories
  for (const filePath of ownedFiles) {
    cleanEmptyDirs(path.resolve(PROJECT_ROOT, filePath))
  }

  // Step 9b: Decompose Encore services (delete service dirs, remove migrations/secrets/cors)
  if (
    manifest &&
    (manifest.services.length > 0 ||
      manifest.migrations.length > 0 ||
      manifest.secrets.length > 0 ||
      manifest.corsEntries.length > 0)
  ) {
    const moduleDir = path.join(MODULES_ROOT, 'modules', moduleName)
    const apiDir = path.join(PROJECT_ROOT, 'apps', 'api')
    // Read the exact filenames this module composed BEFORE it leaves state, so
    // decompose deletes precisely those migrations (never a sibling's file).
    const composedMigrations = state.modules[moduleName].composedMigrations ?? []
    decomposeModule({ moduleDir, manifest, apiDir, composedMigrations })
    if (manifest.services.length > 0) console.log(`  Removed services: ${manifest.services.join(', ')}`)
    if (manifest.migrations.length > 0) console.log('  Removed migrations')
    if (manifest.secrets.length > 0) console.log('  Removed secret bindings')
    if (manifest.corsEntries.length > 0) console.log('  Removed CORS entries from encore.app')
  }

  // Step 10: Update template.json
  state = removeModuleFromState(state, moduleName)
  saveTemplateJson(PROJECT_ROOT, state)
  console.log('  Updated template.json')

  // Step 13: Regenerate web modules.ts
  const webModulesContent = generateWebModulesTs(PROJECT_ROOT, state)
  const webModulesPath = path.join(PROJECT_ROOT, 'apps/web/src/modules.ts')
  if (webModulesContent) {
    fs.writeFileSync(webModulesPath, webModulesContent, 'utf-8')
    console.log('  Regenerated apps/web/src/modules.ts')
  } else if (fs.existsSync(webModulesPath)) {
    fs.unlinkSync(webModulesPath)
    console.log('  Removed apps/web/src/modules.ts (no frontend-core)')
  }

  // Step 14: Comment out env vars
  if (manifest && Object.keys(manifest.envVars).length > 0) {
    commentOutEnvVars(PROJECT_ROOT, manifest)
    console.log('  Commented out env vars in .env.example')
  }

  // Step 15: Reverse workspace changes
  if (manifest?.workspaceChanges) {
    reverseWorkspaces(manifest.workspaceChanges)
    console.log('  Reversed workspace changes')
  }

  // Step 16: Remove package deps
  if (manifest && Object.keys(manifest.packageDeps).length > 0) {
    removePackageDeps(manifest.packageDeps)
    console.log('  Removed package dependencies')
  }

  // Step 17: npm install
  if (options.noInstall) {
    console.log('  Skipping npm install (--no-install)')
  } else {
    console.log('  Running npm install...')
    try {
      execSync('npm install', { cwd: PROJECT_ROOT, stdio: 'inherit' })
    } catch {
      console.warn('  Warning: npm install had issues. You may need to run it manually.')
    }
  }

  console.log(`\nModule "${moduleName}" removed successfully.`)
}

// CLI entry point
const args = process.argv.slice(2)
const skipConfirm = args.includes('--yes')
const dryRun = args.includes('--dry-run')
const noInstall = args.includes('--no-install') || process.env.NO_INSTALL === 'true'
// Exclude --root <value> from positional arg detection
const _rootIdx = args.indexOf('--root')
const _rootValueIdx = _rootIdx !== -1 ? _rootIdx + 1 : -1
const moduleName = args.find((a, i) => !a.startsWith('--') && i !== _rootValueIdx)

if (!moduleName) {
  console.error('Usage: npx tsx scripts/remove-module.ts <module-name> [--yes] [--dry-run] [--no-install] [--root <path>]')
  process.exit(1)
} else {
  void (async () => {
    try {
      await removeModule(moduleName, { skipConfirm, dryRun, noInstall })
    } catch (err) {
      console.error(`\nError: ${(err as Error).message}`)
      process.exit(1)
    }
  })()
}

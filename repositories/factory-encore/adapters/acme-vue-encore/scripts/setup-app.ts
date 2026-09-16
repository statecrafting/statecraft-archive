/**
 * Single-App Setup Script (Encore.ts), spec 002.
 *
 * "Lean baseline + compose": the generator clones the template-encore lean
 * baseline from an external source (it no longer assumes it lives inside the
 * app tree), carries forward only what a produced app is born with (the
 * born-with policy in ./lib/born-with), selects the auth driver for the chosen
 * profile, and composes optional domain modules from this adapter's own catalog
 * (--with <module>). The base apps/api already ships the core services
 * (lib/db/health/auth/gateway/web); a profile only picks the default
 * AUTH_DRIVER.
 *
 * The carry-forward policy lives here (the generator), not as a product-side
 * exclusion hack. A produced app is born with the governance kernel
 * (standards/, spec-spine.toml, .claude/, CODEMAP.md) and the app, and carries
 * none of the generator, the module catalog, or the generator meta-specs.
 *
 * Usage:
 *   npx tsx scripts/setup-app.ts --profile <name> --dest <path> \
 *     [--source <template-encore-checkout>] [--yes] [--dry-run] \
 *     [--no-install] [--with <module>]...
 *
 * Profiles:
 *   minimal   mock auth (local dev)
 *   public    rauthy OIDC (external-facing)
 *   internal  rauthy OIDC (staff-facing)
 *
 * Flags:
 *   --source <d> Baseline checkout to clone (else TEMPLATE_ENCORE_SOURCE / sibling)
 *   --yes        Skip confirmation prompts
 *   --dry-run    Show the plan; make no changes
 *   --no-install Skip npm install / encore gen client
 *   --with <m>   Compose an optional domain module (repeatable)
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import { manifestSchema, type ModuleManifest } from './lib/manifest.schema'
import { isCarriedForward, SKIP_ANYWHERE } from './lib/born-with'
import { profileModules } from './lib/adapter-manifest'
import { installModule } from './lib/install-module'
import { loadTemplateJson, saveTemplateJson } from './lib/template-json'

// adapters/acme-vue-encore (scripts/.. resolves to the adapter root). The
// module catalog this generator composes from lives here, alongside the
// generator, independent of the baseline source being cloned.
export const ADAPTER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const MODULES_ROOT = path.join(ADAPTER_ROOT, 'modules')

// ---------------------------------------------------------------------------
// Profile definitions (Encore: auth-driver axis only)
// ---------------------------------------------------------------------------

export interface Profile {
  name: string
  description: string
  authDriver: 'mock' | 'rauthy'
}

export const PROFILES: Record<string, Profile> = {
  minimal: {
    name: 'Minimal (Local Dev)',
    description: 'Mock auth, no external identity provider',
    authDriver: 'mock',
  },
  public: {
    name: 'Public-Facing App',
    description: 'rauthy OIDC, external-facing',
    authDriver: 'rauthy',
  },
  internal: {
    name: 'Internal / Staff App',
    description: 'rauthy OIDC, staff-facing',
    authDriver: 'rauthy',
  },
}

// Build-output dir basenames skipped anywhere in the tree.
const SKIP_OUTPUT_DIRS = new Set(['dist', 'build'])

// Baseline-relative directory paths kept even though their basename
// ('build'/'dist') would otherwise be skipped. apps/api/web/build is a
// committed SPA placeholder (the `spa-static-serving` contract): the `web` service serves it via
// api.static({ dir: "./build", notFound: "./build/index.html" }).
const KEEP_PATHS = new Set(['apps/api/web/build'])

/**
 * Resolve a template-encore baseline checkout to clone from: --source flag,
 * TEMPLATE_ENCORE_SOURCE env, or a sibling `template-encore` checkout.
 */
export function resolveSource(argv: string[]): string | null {
  const i = argv.indexOf('--source')
  const flagVal = i !== -1 ? argv[i + 1] : undefined
  if (flagVal) return path.resolve(flagVal)
  if (process.env.TEMPLATE_ENCORE_SOURCE) return path.resolve(process.env.TEMPLATE_ENCORE_SOURCE)
  const sibling = path.resolve(ADAPTER_ROOT, '..', '..', '..', 'template-encore')
  if (fs.existsSync(path.join(sibling, 'specs'))) return sibling
  return null
}

/**
 * Clone the baseline into dest, carrying forward only the born-with kernel and
 * the app (born-with policy), and skipping create-time generator artifacts.
 *   - generator artifacts and generator meta-specs are skipped (born-with.ts)
 *   - node_modules/.git skipped at any depth; dist/build output dirs skipped at
 *     any depth except the committed apps/api/web/build placeholder
 *   - docs/encore-ts and docs/migration are template-dev docs, skipped
 *   - .github/workflows/deploy-docs.yml is the stripped docs-website's deploy
 *     workflow (spec 016-docs-website satellite), skipped; other workflows stay
 */
export function copyBaseline(source: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true })

  const walk = (srcDir: string, destDir: string, relParts: string[]): void => {
    const entries = fs.readdirSync(srcDir, { withFileTypes: true })
    for (const entry of entries) {
      const name = entry.name
      const rel = [...relParts, name]
      const srcPath = path.join(srcDir, name)

      if (SKIP_ANYWHERE.has(name)) continue

      // Born-with carry-forward policy: skip generator artifacts and the
      // generator meta-specs at their classification depth.
      if (!isCarriedForward(rel)) continue

      // Skip template-dev docs (development history; keep the rest of docs/).
      if (rel.length === 2 && rel[0] === 'docs' && (name === 'encore-ts' || name === 'migration')) continue

      // Skip the template's docs-website deploy workflow. Spec 016-docs-website
      // establishes both `website/` (dropped as a generator artifact) and this
      // workflow; with the site gone and the spec dropped from carry-forward
      // (born-with.ts TEMPLATE_DEV_SPEC_IDS), the workflow is orphaned dead
      // weight in a produced app, so drop it too. Every other .github/workflow
      // (ci-supply-chain, etc.) stays born-with the app.
      if (rel.length === 3 && rel[0] === '.github' && rel[1] === 'workflows' && name === 'deploy-docs.yml') continue

      if (entry.isDirectory()) {
        const relPath = rel.join('/')
        if (SKIP_OUTPUT_DIRS.has(name) && !KEEP_PATHS.has(relPath)) continue
        const nextDest = path.join(destDir, name)
        fs.mkdirSync(nextDest, { recursive: true })
        walk(srcPath, nextDest, rel)
      } else if (entry.isFile()) {
        fs.copyFileSync(srcPath, path.join(destDir, name))
      }
      // symlinks and other types are intentionally ignored
    }
  }

  walk(source, dest, [])
}

/**
 * Set AUTH_DRIVER in <dest>/apps/api/.env.example. Replaces the existing
 * AUTH_DRIVER= line; appends one if absent. Returns true if the file was found.
 */
export function setAuthDriver(dest: string, driver: string): boolean {
  const envPath = path.join(dest, 'apps', 'api', '.env.example')
  if (!fs.existsSync(envPath)) return false

  const content = fs.readFileSync(envPath, 'utf-8')
  const lines = content.split('\n')
  let replaced = false
  const updated = lines.map((line) => {
    if (/^AUTH_DRIVER=/.test(line.trim()) || /^AUTH_DRIVER=/.test(line)) {
      replaced = true
      return `AUTH_DRIVER=${driver}`
    }
    return line
  })

  let out = updated.join('\n')
  if (!replaced) {
    out = content.trimEnd() + `\nAUTH_DRIVER=${driver}\n`
  }
  fs.writeFileSync(envPath, out, 'utf-8')
  return true
}

/** Load and parse a module manifest from this adapter's modules/ catalog. */
function loadModuleManifest(moduleName: string): ModuleManifest {
  const manifestPath = path.join(MODULES_ROOT, moduleName, 'manifest.json')
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Module "${moduleName}" not found at ${manifestPath}`)
  }
  const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
  return manifestSchema.parse(raw)
}

/**
 * Compose domain modules into the generated app through the shared, complete
 * install path (STRUCT-2 parity): web files, template.json record, backend
 * services/migrations/secrets/cors, web module loader, env vars, and
 * workspace/dep changes. `moduleNames` must already be dependency-ordered
 * (see resolveModuleOrder). template.json is written once when any module is
 * composed (this is also the only writer of template.json on the generate
 * path; the base profiles compose nothing and emit none, as before).
 */
export function composeWithModules(dest: string, moduleNames: string[]): void {
  if (moduleNames.length === 0) return
  let state = loadTemplateJson(dest)
  for (const moduleName of moduleNames) {
    const manifest = loadModuleManifest(moduleName)
    state = installModule({ projectRoot: dest, adapterRoot: ADAPTER_ROOT, moduleName, manifest, state }).state
  }
  saveTemplateJson(dest, state)
}

/**
 * Expand a requested module set to its full dependency closure and return it in
 * an install-safe order (each module's `requires` come before it), deduplicated.
 * Composing a profile's default modules (manifest scaffold.profiles[].modules)
 * and any --with modules go through this one dependency-aware path, so a profile
 * that ships a module-with-requires (e.g. api-gateway needs security-core) still
 * composes correctly.
 */
export function resolveModuleOrder(requested: string[]): string[] {
  const ordered: string[] = []
  const done = new Set<string>()
  const onStack = new Set<string>()
  const visit = (name: string): void => {
    if (done.has(name)) return
    if (onStack.has(name)) throw new Error(`Cyclic module dependency involving "${name}"`)
    onStack.add(name)
    for (const dep of loadModuleManifest(name).requires) visit(dep)
    onStack.delete(name)
    done.add(name)
    ordered.push(name)
  }
  for (const name of requested) visit(name)
  return ordered
}

/**
 * The effective module set for a run: the profile's manifest-declared default
 * modules (the STRUCT-1 single authority) unioned with any --with modules,
 * dependency-expanded and ordered.
 */
export function effectiveModules(profileKey: string, withModules: string[]): string[] {
  return resolveModuleOrder([...profileModules(ADAPTER_ROOT, profileKey), ...withModules])
}

// ---------------------------------------------------------------------------
// CLI (only runs when executed directly; the functions above are unit-tested)
// ---------------------------------------------------------------------------

function parseFlagValues(argv: string[], flag: string): string[] {
  const values: string[] = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === flag && i + 1 < argv.length) {
      const v = argv[i + 1]
      if (v !== undefined) values.push(v)
    }
  }
  return values
}

function parseSingleFlag(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag)
  if (idx === -1 || idx + 1 >= argv.length) return undefined
  return argv[idx + 1]
}

interface CliOptions {
  profile: Profile
  profileKey: string
  dest: string
  source: string
  /** The --with values, verbatim (for display). */
  withModules: string[]
  /** Effective composed set: profile defaults union --with, dependency-ordered. */
  modules: string[]
  dryRun: boolean
  autoYes: boolean
  noInstall: boolean
  noGit: boolean
}

function parseArgs(argv: string[]): CliOptions {
  const profileKey = parseSingleFlag(argv, '--profile')
  const destRaw = parseSingleFlag(argv, '--dest')

  if (!profileKey || !destRaw) {
    printUsageAndExit()
  }

  const profile = PROFILES[profileKey]
  if (!profile) {
    console.error(`Error: Unknown profile "${profileKey}".`)
    console.error(`Available profiles: ${Object.keys(PROFILES).join(', ')}`)
    process.exit(1)
  }

  const source = resolveSource(argv)
  if (!source) {
    console.error(
      'Error: no template-encore baseline source found. Pass --source <checkout> or set TEMPLATE_ENCORE_SOURCE.',
    )
    process.exit(1)
  }

  const noInstall = argv.includes('--no-install') || process.env.NO_INSTALL === 'true'
  const withModules = parseFlagValues(argv, '--with')
  return {
    profile,
    profileKey,
    dest: path.resolve(destRaw),
    source,
    withModules,
    modules: effectiveModules(profileKey, withModules),
    dryRun: argv.includes('--dry-run'),
    autoYes: argv.includes('--yes'),
    noInstall,
    // `git init` is developer convenience for manual runs. Machine-driven
    // invocations (the platform's prebuilt materialization sets NO_INSTALL)
    // must NOT receive VCS state: the consumer owns repository initialization.
    noGit: argv.includes('--no-git') || process.env.NO_GIT === 'true' || noInstall,
  }
}

function printUsageAndExit(): never {
  console.error(
    'Usage: npx tsx scripts/setup-app.ts --profile <name> --dest <path> [--source <checkout>] [--yes] [--dry-run] [--no-install] [--no-git] [--with <module>]...',
  )
  console.error('')
  console.error('Profiles:')
  for (const [key, p] of Object.entries(PROFILES)) {
    console.error(`  ${key.padEnd(10)} ${p.description}`)
  }
  process.exit(1)
}

function confirm(message: string, autoYes: boolean): Promise<boolean> {
  if (autoYes) return Promise.resolve(true)
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(`${message} (y/N) `, (answer) => {
      rl.close()
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes')
    })
  })
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2))

  console.log('Single-App Setup (Encore.ts)')
  console.log('============================')
  console.log(`  Profile:      ${opts.profile.name}`)
  console.log(`  Description:  ${opts.profile.description}`)
  console.log(`  AUTH_DRIVER:  ${opts.profile.authDriver}`)
  console.log(`  Source:       ${opts.source}`)
  console.log(`  Dest:         ${opts.dest}`)
  if (opts.modules.length > 0) {
    console.log(`  Modules:      ${opts.modules.join(', ')}`)
    if (opts.withModules.length > 0) {
      console.log(`    (--with:    ${opts.withModules.join(', ')})`)
    }
  }
  if (opts.dryRun) {
    console.log('\n  [DRY RUN, no changes will be made]')
    console.log(`\n  Plan:`)
    console.log(`    1. Clone baseline into ${opts.dest} (born-with kernel + app; generator artifacts skipped)`)
    console.log(`    2. Set AUTH_DRIVER=${opts.profile.authDriver} in apps/api/.env.example`)
    if (opts.modules.length > 0) {
      console.log(`    3. Compose modules: ${opts.modules.join(', ')}`)
    }
    return
  }

  if (fs.existsSync(opts.dest)) {
    const IGNORABLE = new Set(['.git', 'artifacts'])
    const entries = fs.readdirSync(opts.dest).filter((e) => !IGNORABLE.has(e))
    if (entries.length > 0) {
      throw new Error(`Destination directory "${opts.dest}" is not empty.`)
    }
  }

  const proceed = await confirm('\nProceed?', opts.autoYes)
  if (!proceed) {
    console.log('Aborted.')
    return
  }

  // 1. Clone the lean baseline (born-with carry-forward policy)
  console.log('\nStep 1: Clone baseline to destination (born-with carry-forward)')
  copyBaseline(opts.source, opts.dest)
  console.log('  Baseline cloned')

  // 2. Set AUTH_DRIVER
  console.log('\nStep 2: Select auth driver')
  if (setAuthDriver(opts.dest, opts.profile.authDriver)) {
    console.log(`  AUTH_DRIVER=${opts.profile.authDriver} set in apps/api/.env.example`)
  } else {
    console.log('  apps/api/.env.example not found, skipped AUTH_DRIVER selection')
  }

  // 3. Compose domain modules: the profile's manifest-declared defaults
  // (scaffold.profiles[].modules, the STRUCT-1 single authority) plus any
  // --with modules, dependency-ordered.
  if (opts.modules.length > 0) {
    console.log('\nStep 3: Compose domain modules')
    composeWithModules(opts.dest, opts.modules)
    console.log(`  Composed: ${opts.modules.join(', ')}`)
  }

  // 3b. Initialize a fresh git repo in the generated app (non-fatal,
  // developer-UX only). Machine-driven runs skip it (see `noGit` in parseArgs).
  if (!opts.dryRun && !opts.noGit) {
    try {
      execSync('git init', { cwd: opts.dest, stdio: 'pipe' })
      console.log('\n  Initialized destination as a git repository')
    } catch {
      console.warn('  Warning: git init failed (git not found?), initialize the repo manually if needed')
    }
  }

  // 4. Optional install (best-effort; never hard-fail on a missing CLI)
  if (!opts.noInstall) {
    console.log('\nStep 4: Install dependencies (best-effort)')
    try {
      execSync('npm install', { cwd: opts.dest, stdio: 'inherit' })
    } catch {
      console.warn('  npm install skipped or failed (missing CLI?), run it manually if needed')
    }
    try {
      // Run the app's own gen:client script (apps/api/package.json) so the
      // output path, env, and language match the canonical target the born-with
      // CI checks: apps/web/src/lib/encore-client.ts. (The earlier direct
      // invocation wrote to apps/web/src/client.ts, a stray file nothing reads.)
      execSync('npm --prefix apps/api run gen:client', { cwd: opts.dest, stdio: 'inherit' })
    } catch {
      console.warn('  encore gen client skipped (encore CLI not found), run it manually if needed')
    }
  } else {
    console.log('\nStep 4: Skipping npm install / encore gen client (--no-install)')
  }

  console.log('\nDone!')
  console.log(`
  Created ${opts.profile.name.toLowerCase()} app at: ${opts.dest}

  Profile:      ${opts.profileKey}
  AUTH_DRIVER:  ${opts.profile.authDriver}

  Next steps:
    cd ${opts.dest}
    1. Copy apps/api/.env.example to apps/api/.env and configure
    2. Run: encore run
`)
}

// Only run the CLI when executed as the entry module (keep import side-effect free for tests).
const isEntry = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isEntry) {
  main().catch((err) => {
    console.error('Setup failed:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
}

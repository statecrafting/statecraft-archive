/**
 * Dual-App Setup Script (Encore.ts), spec 004.
 *
 * Produces TWO independent, standalone Encore apps under the destination
 * (Option A from spec 002's "Dual-app under Encore"):
 *
 *   <dest>/public     AUTH_DRIVER=rauthy    external-facing; web service serves apps/web
 *   <dest>/internal   AUTH_DRIVER=rauthy    staff-facing;   web service serves apps/web-internal
 *
 * Each subdirectory is a complete clone of the lean baseline (the same clone +
 * driver-selection core the single-app generator uses, spec 002), so each has
 * its own Gateway + authHandler, secrets, and deploy/scale boundary, keeping the
 * external-vs-staff trust zones hard.
 *
 * Usage:
 *   npx tsx scripts/setup-dual-app.ts --dest <path> [--source <checkout>] [--yes] [--dry-run] [--no-install]
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import { copyBaseline, setAuthDriver, resolveSource } from './setup-app'

export interface DualVariant {
  /** Subdirectory under <dest>. */
  dir: 'public' | 'internal'
  authDriver: 'rauthy'
  description: string
}

export const DUAL_VARIANTS: DualVariant[] = [
  { dir: 'public', authDriver: 'rauthy', description: 'External-facing portal (rauthy OIDC)' },
  { dir: 'internal', authDriver: 'rauthy', description: 'Staff-facing portal (rauthy OIDC)' },
]

/**
 * Wire the internal variant's `web` service to serve the staff SPA
 * (apps/web-internal), resolving the static-serving deferral for dual-app:
 *
 *   1. apps/web-internal/vite.config.ts gains build.outDir = ../api/web/build
 *      (mirroring apps/web), so its bundle lands where api.static reads.
 *   2. the root build:apps script targets only apps/web-internal, so the staff
 *      bundle is the one that lands in apps/api/web/build (no double-build with
 *      apps/web).
 *
 * Idempotent: re-running is a no-op once the outDir is present.
 */
export function wireInternalSpa(internalRoot: string): void {
  // 1. Point the staff SPA's build at the Encore web/build directory.
  const vitePath = path.join(internalRoot, 'apps', 'web-internal', 'vite.config.ts')
  if (fs.existsSync(vitePath)) {
    let src = fs.readFileSync(vitePath, 'utf-8')
    if (!src.includes('outDir')) {
      const buildBlock =
        '    build: {\n' +
        '      // Build the staff SPA into the Encore app tree so the web service\n' +
        "      // (apps/api/web/static.ts) serves it at /!path. Mirrors apps/web (spec 004).\n" +
        "      outDir: fileURLToPath(new URL('../api/web/build', import.meta.url)),\n" +
        '      emptyOutDir: true,\n' +
        '    },\n'
      // Insert the build block immediately before the `server: {` block.
      src = src.replace(/^(\s*)server: \{/m, `${buildBlock}$1server: {`)
      fs.writeFileSync(vitePath, src, 'utf-8')
    }
  }

  // 2. Repoint build:apps so only the staff SPA lands in apps/api/web/build.
  const pkgPath = path.join(internalRoot, 'package.json')
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
    if (pkg.scripts) {
      pkg.scripts['build:apps'] = 'npm run build --workspace=apps/web-internal'
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8')
    }
  }
}

/**
 * Generate both variants into <dest> (clone baseline + select driver + wire the
 * staff SPA for the internal variant). Pure filesystem work (no git/install),
 * so it is unit-testable. Returns the per-variant destination roots.
 */
export function setupDualApp(opts: {
  dest: string
  source: string
}): Record<'public' | 'internal', string> {
  const roots = {} as Record<'public' | 'internal', string>
  for (const variant of DUAL_VARIANTS) {
    const variantRoot = path.join(opts.dest, variant.dir)
    copyBaseline(opts.source, variantRoot)
    setAuthDriver(variantRoot, variant.authDriver)
    if (variant.dir === 'internal') wireInternalSpa(variantRoot)
    roots[variant.dir] = variantRoot
  }
  return roots
}

// ---------------------------------------------------------------------------
// CLI (only runs when executed directly)
// ---------------------------------------------------------------------------

function parseSingleFlag(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag)
  if (idx === -1 || idx + 1 >= argv.length) return undefined
  return argv[idx + 1]
}

function printUsageAndExit(): never {
  console.error('Usage: npx tsx scripts/setup-dual-app.ts --dest <path> [--source <checkout>] [--yes] [--dry-run] [--no-install] [--no-git]')
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
  const argv = process.argv.slice(2)
  const destRaw = parseSingleFlag(argv, '--dest')
  if (!destRaw) printUsageAndExit()
  const dest = path.resolve(destRaw)
  const source = resolveSource(argv)
  if (!source) {
    console.error(
      'Error: no template-encore baseline source found. Pass --source <checkout> or set TEMPLATE_ENCORE_SOURCE.',
    )
    process.exit(1)
  }
  const autoYes = argv.includes('--yes')
  const dryRun = argv.includes('--dry-run')
  const noInstall = argv.includes('--no-install') || process.env.NO_INSTALL === 'true'
  // `git init` is developer convenience for manual runs. Machine-driven
  // invocations (the platform's prebuilt materialization sets NO_INSTALL) must
  // NOT receive VCS state: the consumer owns repository initialization.
  const noGit = argv.includes('--no-git') || process.env.NO_GIT === 'true' || noInstall

  console.log('Dual-App Setup (Encore.ts): two independent apps')
  console.log('=================================================')
  for (const v of DUAL_VARIANTS) {
    console.log(`  ${v.dir.padEnd(9)} AUTH_DRIVER=${v.authDriver.padEnd(9)} ${v.description}`)
  }
  console.log(`  Source: ${source}`)
  console.log(`  Dest:   ${dest}`)

  if (dryRun) {
    console.log('\n  [DRY RUN] Plan:')
    console.log(`    1. Clone baseline into ${dest}/public  (AUTH_DRIVER=rauthy)`)
    console.log(`    2. Clone baseline into ${dest}/internal (AUTH_DRIVER=rauthy) + serve apps/web-internal`)
    return
  }

  if (fs.existsSync(dest)) {
    const IGNORABLE = new Set(['.git', 'artifacts'])
    const entries = fs.readdirSync(dest).filter((e) => !IGNORABLE.has(e))
    if (entries.length > 0) throw new Error(`Destination directory "${dest}" is not empty.`)
  }

  if (!(await confirm('\nProceed?', autoYes))) {
    console.log('Aborted.')
    return
  }

  console.log('\nGenerating both variants...')
  const roots = setupDualApp({ dest, source })
  console.log(`  public:   ${roots.public}   (AUTH_DRIVER=rauthy)`)
  console.log(`  internal: ${roots.internal} (AUTH_DRIVER=rauthy, serves apps/web-internal)`)

  // Initialize each variant as its own git repo (independent apps), non-fatal.
  // Developer-UX only; machine-driven runs skip this (see `noGit` above).
  if (!noGit) {
    for (const v of DUAL_VARIANTS) {
      try {
        execSync('git init', { cwd: roots[v.dir], stdio: 'pipe' })
      } catch {
        console.warn(`  Warning: git init failed for ${v.dir} (git not found?), initialize manually if needed`)
      }
    }
  }

  if (!noInstall) {
    for (const v of DUAL_VARIANTS) {
      console.log(`\nInstalling dependencies for ${v.dir} (best-effort)...`)
      try {
        execSync('npm install', { cwd: roots[v.dir], stdio: 'inherit' })
      } catch {
        console.warn(`  npm install skipped/failed for ${v.dir}, run it manually if needed`)
      }
    }
  } else {
    console.log('\nSkipping npm install (--no-install)')
  }

  console.log('\nDone! Two independent Encore apps:')
  console.log(`  cd ${roots.public}   && (cd apps/api && encore run)   # external, rauthy`)
  console.log(`  cd ${roots.internal} && (cd apps/api && encore run)   # staff, rauthy`)
}

const isEntry = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isEntry) {
  main().catch((err) => {
    console.error('Dual-app setup failed:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
}

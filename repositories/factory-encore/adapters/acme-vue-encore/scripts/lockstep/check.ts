/**
 * Cross-repo lockstep check (spec 006-factory-schema-lockstep).
 *
 * Binds the acme-vue-encore generator + module catalog to the template-encore
 * baseline it clones, in three dimensions:
 *
 *   1. Frozen app-invariant pin. The generator must not drift from the app's
 *      frozen invariants (the `encore-app-architecture` and
 *      `security-data-invariants` invariants). Their spec.md content hashes are
 *      pinned in baseline.lock.json; the check re-reads them from the baseline at
 *      the pinned ref and refuses any mismatch. This dimension was DEFERRED
 *      through Phase 1 and Phase 2 (`encore-app-architecture` absorbed the
 *      static-serving wiring from spec 004 in Phase 2) and is now ACTIVE
 *      (status: "pinned"): the Phase 3 handshake filled the hashes, so a re-hash
 *      mismatch is reported as DRIFT and fails. A still-deferred pin (status:
 *      "deferred") instead emits a visible notice, never a silent pass.
 *   2. Baseline structure. The "lean baseline + compose" generator assumes the
 *      baseline ships a known set of core Encore services. The check asserts
 *      every one is present.
 *   3. Catalog binding. Every module the lockfile pins is present in this repo's
 *      (factory-encore) catalog. Phase 2 relocated the catalog out of the
 *      baseline into this repo, so the baseline no longer co-carries it.
 *
 * The check is fail-visible, never skipped-green: a missing source, an
 * unreadable pin, a missing invariant spec, or any verification failure is a
 * hard failure.
 *
 * Usage:
 *   tsx check.ts [--source <template-encore-checkout>]
 *   (source also resolvable via TEMPLATE_ENCORE_SOURCE, or the sibling repo)
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const LOCKFILE_PATH = path.join(HERE, 'baseline.lock.json')
// adapters/acme-vue-encore (lockstep dir is .../scripts/lockstep).
export const ADAPTER_ROOT = path.resolve(HERE, '..', '..')

export interface InvariantPin {
  status: 'deferred' | 'pinned'
  reason?: string
  specs: string[]
  hashes: Record<string, string>
}

export interface Lockfile {
  upstreamSource: string
  pinnedRef: string
  invariantPin: InvariantPin
  baselineStructure: { coreServices: string[]; modules: string[] }
}

export interface CheckResult {
  ok: boolean
  failures: string[]
  notices: string[]
  checked: string[]
}

export function loadLockfile(p: string = LOCKFILE_PATH): Lockfile {
  return JSON.parse(fs.readFileSync(p, 'utf-8')) as Lockfile
}

export function sha256File(p: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')
}

/**
 * Dimension 1: the frozen app-invariant pin. When pinned, each spec.md hash
 * must match the baseline; when deferred, the spec must merely be present (the
 * mechanism is wired) and a notice records that the hash is not yet enforced.
 */
export function verifyInvariantPin(source: string, lock: Lockfile): { failures: string[]; notices: string[] } {
  const failures: string[] = []
  const notices: string[] = []
  const pin = lock.invariantPin
  for (const rel of pin.specs) {
    const abs = path.join(source, rel)
    if (!fs.existsSync(abs)) {
      failures.push(`invariant spec missing at baseline source: ${rel}`)
      continue
    }
    if (pin.status === 'pinned') {
      const expected = pin.hashes[rel]
      if (!expected) {
        failures.push(`invariant pin is "pinned" but ${rel} has no hash in the lockfile`)
        continue
      }
      const actual = sha256File(abs)
      if (actual !== expected) {
        failures.push(`invariant spec DRIFT: ${rel}\n      pinned   ${expected}\n      upstream ${actual}`)
      }
    } else {
      notices.push(`invariant pin DEFERRED (Phase 3): ${rel} present at baseline, hash not yet enforced`)
    }
  }
  return { failures, notices }
}

/** Dimension 2: the baseline ships the core Encore services the generator clones. */
export function verifyBaselineStructure(source: string, lock: Lockfile): string[] {
  const failures: string[] = []
  for (const svc of lock.baselineStructure.coreServices) {
    if (!fs.existsSync(path.join(source, svc))) {
      failures.push(`baseline core service missing at source: ${svc}`)
    }
  }
  return failures
}

/**
 * Dimension 3: every module the lockfile pins is present in this repo's
 * (factory-encore) catalog. Phase 2 relocated the catalog out of the baseline
 * into this repo, so the baseline no longer co-carries it; only the generator's
 * own catalog is verified here.
 */
export function verifyCatalogBinding(adapterRoot: string, lock: Lockfile): string[] {
  const failures: string[] = []
  for (const m of lock.baselineStructure.modules) {
    if (!fs.existsSync(path.join(adapterRoot, 'modules', m, 'manifest.json'))) {
      failures.push(`generator catalog missing module manifest: modules/${m}/manifest.json`)
    }
  }
  return failures
}

export function runCheck(opts: { source: string; adapterRoot?: string; lock?: Lockfile }): CheckResult {
  const lock = opts.lock ?? loadLockfile()
  const adapterRoot = opts.adapterRoot ?? ADAPTER_ROOT
  const invariant = verifyInvariantPin(opts.source, lock)
  const failures = [
    ...invariant.failures,
    ...verifyBaselineStructure(opts.source, lock),
    ...verifyCatalogBinding(adapterRoot, lock),
  ]
  const checked = [
    ...lock.invariantPin.specs,
    ...lock.baselineStructure.coreServices,
    ...lock.baselineStructure.modules.map((m) => `modules/${m}`),
  ]
  return { ok: failures.length === 0, failures, notices: invariant.notices, checked }
}

/** Resolve a template-encore baseline checkout: --source, env, or sibling repo. */
export function resolveSource(argv: string[]): string | null {
  const i = argv.indexOf('--source')
  const flagVal = i !== -1 ? argv[i + 1] : undefined
  if (flagVal) return path.resolve(flagVal)
  if (process.env.TEMPLATE_ENCORE_SOURCE) return path.resolve(process.env.TEMPLATE_ENCORE_SOURCE)
  const sibling = path.resolve(ADAPTER_ROOT, '..', '..', '..', 'template-encore')
  if (fs.existsSync(path.join(sibling, 'specs'))) return sibling
  return null
}

function main(): void {
  const lock = loadLockfile()
  console.log('Lockstep: acme-vue-encore generator <-> template-encore baseline')
  console.log(`  pinned_ref:      ${lock.pinnedRef}`)
  console.log(`  upstreamSource:  ${lock.upstreamSource}`)
  console.log(`  invariant pin:   ${lock.invariantPin.status}`)

  const source = resolveSource(process.argv.slice(2))
  if (!source) {
    console.error(
      '::error::lockstep baseline source not found. Pass --source <template-encore-checkout> or set TEMPLATE_ENCORE_SOURCE. This gate is fail-visible, never skipped-green (spec 006).',
    )
    process.exit(1)
  }
  console.log(`  source:          ${source}\n`)

  const result = runCheck({ source })
  for (const n of result.notices) console.log(`::notice::${n}`)
  if (!result.ok) {
    console.error(`\nLOCKSTEP FAILED (${result.failures.length} drift / structure violation(s)):`)
    for (const f of result.failures) console.error(`  - ${f}`)
    console.error(
      '\nThe generator has drifted from the template-encore baseline it clones. Re-verify the baseline, then (in Phase 3) bump pinned_ref + the pinned hashes in baseline.lock.json (a coupling-gated edit to specs/006-factory-schema-lockstep).',
    )
    process.exit(1)
  }
  const pinNote = lock.invariantPin.status === 'deferred' ? ' (invariant hash pin deferred to Phase 3)' : ''
  console.log(`\nLockstep OK: ${result.checked.length} pinned unit(s) verified against the baseline${pinNote}.`)
}

const isEntry = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isEntry) main()

/**
 * Encore module-composition engine (spec 002).
 *
 * Encore discovers services from the filesystem and has no runtime registry,
 * so module composition is a set of filesystem + declarative-config edits:
 *
 *   - service directories copied into apps/api/<service>/
 *   - migration files merged (renumbered) into apps/api/db/migrations/
 *   - secret bindings merged into apps/api/infra.config.json
 *   - CORS contributions merged into apps/api/encore.app global_cors
 *
 * The pure functions below carry the merge/renumber logic with no I/O so they
 * can be unit-tested directly; the thin wrappers (copyServiceDir,
 * composeModule, decomposeModule) drive them over a real apps/api directory and
 * are exercised via fixtures.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { parse as parseJsonc, modify, applyEdits } from 'jsonc-parser'
import { type ModuleManifest } from './manifest.schema'

/** A single Encore secret binding: maps the secret name to the env var it reads. */
export interface SecretBinding {
  $env: string
}

/** The shape of an `encore.app` `global_cors` block (each field is a string list). */
export type GlobalCors = Record<string, string[]>

const MIGRATION_PREFIX_RE = /^(\d+)_/
const UP_MIGRATION_RE = /\.up\.sql$/

// ---------------------------------------------------------------------------
// Path-traversal guards (spec 002 - supply-chain hardening)
//
// A manifest is external input once `--with <module>` accepts third-party
// modules, so `service` names and `migration.source` paths must be validated
// before they reach path.join + copy/remove. Without these guards a manifest
// with `service: "../../etc"` or `migration.source: "../../apps/api/infra.config.json"`
// escapes the intended directories.
// ---------------------------------------------------------------------------

/**
 * Throws if `service` is anything other than a single, safe path segment.
 * A service name must equal its own basename and contain no separators or
 * dot-only components, so `path.join(apiDir, service)` can never escape apiDir.
 */
export function assertSafeServiceName(service: string): void {
  if (
    path.basename(service) !== service ||
    service.includes('/') ||
    service.includes('\\') ||
    service === '..' ||
    service === '.' ||
    service.trim() === ''
  ) {
    throw new Error(
      `Unsafe service name "${service}": it escapes the module directory. Service names must be a single path segment.`,
    )
  }
}

/**
 * Throws unless `targetPath` resolves to `baseDir` itself or a path nested
 * under it. Used to confirm a `migration.source` (which MAY contain subdirs
 * like `db/1_x.up.sql`) stays within the module's files/ root.
 */
export function assertWithinBase(baseDir: string, targetPath: string): void {
  const resolvedBase = path.resolve(baseDir)
  const resolvedTarget = path.resolve(targetPath)
  if (
    resolvedTarget !== resolvedBase &&
    !resolvedTarget.startsWith(resolvedBase + path.sep)
  ) {
    throw new Error(
      `Unsafe migration source "${targetPath}": it escapes the module directory.`,
    )
  }
}

// ---------------------------------------------------------------------------
// Pure functions (no I/O)
// ---------------------------------------------------------------------------

/**
 * Returns the next free numeric migration prefix: max `<n>` among existing
 * `*.up.sql` filenames + 1 (or 1 when there are none).
 */
export function nextMigrationPrefix(existingFilenames: string[]): number {
  let max = 0
  for (const filename of existingFilenames) {
    if (!UP_MIGRATION_RE.test(filename)) continue
    const match = MIGRATION_PREFIX_RE.exec(path.basename(filename))
    if (!match) continue
    const n = Number.parseInt(match[1], 10)
    if (Number.isFinite(n) && n > max) max = n
  }
  return max + 1
}

/**
 * Replaces the leading `<n>_` of a migration filename with `<prefix>_`.
 * e.g. renumberMigration('1_init.up.sql', 5) -> '5_init.up.sql'.
 * If there is no leading numeric prefix the name is returned unchanged.
 */
export function renumberMigration(filename: string, prefix: number): string {
  const base = path.basename(filename)
  if (!MIGRATION_PREFIX_RE.test(base)) return base
  return base.replace(MIGRATION_PREFIX_RE, `${prefix}_`)
}

/**
 * Returns a new secrets map with `name -> { $env: name }` added for each secret
 * not already present. Idempotent: never overwrites an existing binding.
 */
export function mergeSecrets(
  current: Record<string, SecretBinding>,
  secrets: { name: string }[],
): Record<string, SecretBinding> {
  const next: Record<string, SecretBinding> = { ...current }
  for (const { name } of secrets) {
    if (!(name in next)) {
      next[name] = { $env: name }
    }
  }
  return next
}

/** Returns a new secrets map with the given keys removed. */
export function removeSecrets(
  current: Record<string, SecretBinding>,
  names: string[],
): Record<string, SecretBinding> {
  const drop = new Set(names)
  const next: Record<string, SecretBinding> = {}
  for (const [key, value] of Object.entries(current)) {
    if (!drop.has(key)) next[key] = value
  }
  return next
}

/**
 * A single Encore `infra.config.json` `redis` cluster block. Topology-only,
 * reached over the typed REDIS_HOST / REDIS_USER / REDIS_PASSWORD connection
 * (spec 008 FR-001, template-encore spec 018). Encore accepts it without a
 * `CacheCluster` in code.
 */
export interface RedisCluster {
  host: string
  key_prefix?: string
  auth: { type: 'acl'; username: string; password: SecretBinding }
}

/**
 * Returns a new redis map with the module's cluster added, reached over the
 * typed connection triple. Idempotent: never overwrites an existing cluster of
 * the same name.
 */
export function mergeRedis(
  current: Record<string, RedisCluster>,
  resource: { cluster: string; keyPrefix?: string },
): Record<string, RedisCluster> {
  const next: Record<string, RedisCluster> = { ...current }
  if (!(resource.cluster in next)) {
    next[resource.cluster] = {
      host: '${REDIS_HOST}',
      ...(resource.keyPrefix ? { key_prefix: resource.keyPrefix } : {}),
      auth: { type: 'acl', username: '${REDIS_USER}', password: { $env: 'REDIS_PASSWORD' } },
    }
  }
  return next
}

/**
 * Returns a new redis map with the given cluster names removed.
 *
 * Invariant: a cluster name is treated as owned by a single module. mergeRedis is
 * idempotent (it never overwrites an existing cluster), but removeRedis deletes by
 * name unconditionally, so if two modules ever declared the same cluster (e.g.
 * both `{ cluster: 'cache' }`) decomposing either would remove the shared entry
 * and silently break the other. Today only data-redis declares a redis resource,
 * but infraResourcesSchema is designed for extension: a second redis-declaring
 * module MUST pick a distinct cluster name (or this remove path must become
 * refcounted).
 */
export function removeRedis(
  current: Record<string, RedisCluster>,
  clusters: string[],
): Record<string, RedisCluster> {
  const drop = new Set(clusters)
  const next: Record<string, RedisCluster> = {}
  for (const [key, value] of Object.entries(current)) {
    if (!drop.has(key)) next[key] = value
  }
  return next
}

/**
 * Returns a new global_cors with each entry's values appended to the matching
 * field (deduplicated, order-preserving). Creates the field array if absent.
 */
export function mergeCors(
  current: GlobalCors,
  entries: { field: string; values: string[] }[],
): GlobalCors {
  const next: GlobalCors = {}
  for (const [field, values] of Object.entries(current)) {
    next[field] = [...values]
  }
  for (const { field, values } of entries) {
    const existing = next[field] ?? []
    const seen = new Set(existing)
    const merged = [...existing]
    for (const value of values) {
      if (!seen.has(value)) {
        seen.add(value)
        merged.push(value)
      }
    }
    next[field] = merged
  }
  return next
}

/**
 * Returns a new global_cors with the given values removed from each entry's
 * matching field. Empty fields are left as empty arrays (never deleted).
 */
export function removeCors(
  current: GlobalCors,
  entries: { field: string; values: string[] }[],
): GlobalCors {
  const next: GlobalCors = {}
  for (const [field, values] of Object.entries(current)) {
    next[field] = [...values]
  }
  for (const { field, values } of entries) {
    if (!(field in next)) continue
    const drop = new Set(values)
    next[field] = next[field].filter((v) => !drop.has(v))
  }
  return next
}

// ---------------------------------------------------------------------------
// Thin I/O wrappers
// ---------------------------------------------------------------------------

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T
}

function writeJsonFile(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8')
}

/** Recursively copies a service directory tree from srcDir to destDir. */
export function copyServiceDir(srcDir: string, destDir: string): void {
  fs.cpSync(srcDir, destDir, { recursive: true })
}

interface InfraConfig {
  secrets?: Record<string, SecretBinding>
  redis?: Record<string, RedisCluster>
  [key: string]: unknown
}

interface EncoreApp {
  global_cors?: GlobalCors
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// JSONC-aware encore.app CORS I/O
//
// The real apps/api/encore.app is JSONC (it carries `//` documentation
// comments), so it is read with a tolerant parser and written with surgical
// edits that preserve comments + formatting. Only the global_cors fields a
// module actually contributes are rewritten; every other byte of the file
// (comments included) is left exactly as-is. infra.config.json is plain JSON
// and keeps the readJsonFile/writeJsonFile path.
// ---------------------------------------------------------------------------

/**
 * Read the array-valued `global_cors` fields from a JSONC encore.app (comments
 * tolerated). Non-array members such as `"debug": false` are intentionally
 * excluded: they are not CORS value lists and must not flow through the
 * list-merge. They remain untouched in the file (we only ever rewrite the
 * specific fields a module contributes).
 */
function readEncoreAppCors(appPath: string): GlobalCors {
  const app = parseJsonc(fs.readFileSync(appPath, 'utf-8')) as EncoreApp | undefined
  const raw = (app?.global_cors ?? {}) as Record<string, unknown>
  const cors: GlobalCors = {}
  for (const [field, value] of Object.entries(raw)) {
    if (Array.isArray(value)) cors[field] = value as string[]
  }
  return cors
}

/**
 * Write back only the named `global_cors` fields, preserving every comment and
 * the formatting of all untouched content via jsonc-parser's modify/applyEdits.
 * A field whose merged value is empty (every contributed value was removed on
 * decompose, and nothing else lived there) is deleted rather than left as a
 * stale `"field": []`, by passing `undefined` to modify.
 */
function writeEncoreAppCorsFields(
  appPath: string,
  cors: GlobalCors,
  fields: Set<string>,
): void {
  let text = fs.readFileSync(appPath, 'utf-8')
  const formattingOptions = { tabSize: 2, insertSpaces: true }
  for (const field of fields) {
    const value = cors[field]
    const next = value && value.length > 0 ? value : undefined
    const edits = modify(text, ['global_cors', field], next, { formattingOptions })
    text = applyEdits(text, edits)
  }
  fs.writeFileSync(appPath, text, 'utf-8')
}

/** List the `*.up.sql` filenames already present in a migrations directory. */
function listMigrationFilenames(migrationsDir: string): string[] {
  if (!fs.existsSync(migrationsDir)) return []
  return fs.readdirSync(migrationsDir).filter((f) => UP_MIGRATION_RE.test(f))
}

export interface ComposeResult {
  migrationsAdded: string[]
  secretsAdded: string[]
}

/**
 * Composes one v2 module into a target Encore app directory:
 *   - copies each `services[]` dir from <moduleDir>/files/<service> to <apiDir>/<service>
 *   - copies each `migrations[].source` into <apiDir>/db/migrations renumbered to
 *     the next free prefix
 *   - merges `secrets[]` into <apiDir>/infra.config.json
 *   - merges `corsEntries[]` into <apiDir>/encore.app global_cors
 *   - adds an `infraResources.redis` block to <apiDir>/infra.config.json
 *
 * Each section is skipped gracefully when empty.
 */
export function composeModule(opts: {
  moduleDir: string
  manifest: ModuleManifest
  apiDir: string
}): ComposeResult {
  const { moduleDir, manifest, apiDir } = opts
  const filesRoot = path.join(moduleDir, 'files')

  // 1. Service directories
  for (const service of manifest.services) {
    assertSafeServiceName(service)
    const srcDir = path.join(filesRoot, service)
    if (!fs.existsSync(srcDir)) continue
    copyServiceDir(srcDir, path.join(apiDir, service))
  }

  // 2. Migrations (renumbered onto the next free prefix)
  const migrationsAdded: string[] = []
  if (manifest.migrations.length > 0) {
    const migrationsDir = path.join(apiDir, 'db', 'migrations')
    fs.mkdirSync(migrationsDir, { recursive: true })
    let prefix = nextMigrationPrefix(listMigrationFilenames(migrationsDir))
    for (const migration of manifest.migrations) {
      const src = path.join(filesRoot, migration.source)
      assertWithinBase(filesRoot, src)
      if (!fs.existsSync(src)) continue
      const renamed = renumberMigration(migration.source, prefix)
      fs.copyFileSync(src, path.join(migrationsDir, renamed))
      migrationsAdded.push(renamed)
      prefix += 1
    }
  }

  // 3. Secrets in infra.config.json
  const secretsAdded: string[] = []
  if (manifest.secrets.length > 0) {
    const infraPath = path.join(apiDir, 'infra.config.json')
    if (fs.existsSync(infraPath)) {
      const infra = readJsonFile<InfraConfig>(infraPath)
      const current = infra.secrets ?? {}
      const merged = mergeSecrets(current, manifest.secrets)
      for (const name of Object.keys(merged)) {
        if (!(name in current)) secretsAdded.push(name)
      }
      infra.secrets = merged
      writeJsonFile(infraPath, infra)
    }
  }

  // 4. CORS in encore.app (JSONC-aware: preserves comments + untouched formatting)
  if (manifest.corsEntries.length > 0) {
    const appPath = path.join(apiDir, 'encore.app')
    if (fs.existsSync(appPath)) {
      const merged = mergeCors(readEncoreAppCors(appPath), manifest.corsEntries)
      const touched = new Set(manifest.corsEntries.map((e) => e.field))
      writeEncoreAppCorsFields(appPath, merged, touched)
    }
  }

  // 5. Redis resource block in infra.config.json (topology-only; spec 008 / 018)
  const redisResource = manifest.infraResources?.redis
  if (redisResource) {
    const infraPath = path.join(apiDir, 'infra.config.json')
    if (fs.existsSync(infraPath)) {
      const infra = readJsonFile<InfraConfig>(infraPath)
      infra.redis = mergeRedis(infra.redis ?? {}, redisResource)
      writeJsonFile(infraPath, infra)
    }
  }

  return { migrationsAdded, secretsAdded }
}

/**
 * Reverses composeModule for one v2 module against a target Encore app:
 *   - deletes each copied service dir
 *   - removes exactly the migration files this module composed (by name)
 *   - removes the module's secret bindings from infra.config.json
 *   - removes the module's CORS values from encore.app global_cors
 *   - removes the module's `infraResources.redis` block from infra.config.json
 *
 * Migration removal deletes precisely the renumbered filenames recorded in
 * `composedMigrations` (captured from composeModule's `migrationsAdded`). When
 * `composedMigrations` is not provided, migration deletion is skipped entirely:
 * the old basename-tail heuristic deleted sibling modules' migrations whose
 * source tail collided (e.g. two modules each shipping `1_init.up.sql`).
 */
export function decomposeModule(opts: {
  moduleDir: string
  manifest: ModuleManifest
  apiDir: string
  composedMigrations?: string[]
}): void {
  const { manifest, apiDir, composedMigrations } = opts

  // 1. Service directories
  for (const service of manifest.services) {
    assertSafeServiceName(service)
    const destDir = path.join(apiDir, service)
    if (fs.existsSync(destDir)) {
      fs.rmSync(destDir, { recursive: true, force: true })
    }
  }

  // 2. Migrations — delete exactly the recorded composed filenames (if any).
  if (composedMigrations && composedMigrations.length > 0) {
    const migrationsDir = path.join(apiDir, 'db', 'migrations')
    if (fs.existsSync(migrationsDir)) {
      for (const filename of composedMigrations) {
        const full = path.join(migrationsDir, filename)
        if (fs.existsSync(full)) fs.unlinkSync(full)
      }
    }
  } else if (manifest.migrations.length > 0) {
    // Legacy install: the module composed migrations but template.json has no
    // composedMigrations record, so we cannot know which renumbered files to
    // delete. Surface it loudly rather than silently orphaning them (the old
    // basename-tail heuristic that deleted siblings is intentionally gone).
    console.warn(
      `  Warning: "${manifest.name}" contributed ${manifest.migrations.length} migration(s) but template.json records no composedMigrations; ` +
        `its renumbered migration file(s) under db/migrations were NOT removed. Delete them manually if needed.`,
    )
  }

  // 3. Secrets
  if (manifest.secrets.length > 0) {
    const infraPath = path.join(apiDir, 'infra.config.json')
    if (fs.existsSync(infraPath)) {
      const infra = readJsonFile<InfraConfig>(infraPath)
      if (infra.secrets) {
        infra.secrets = removeSecrets(
          infra.secrets,
          manifest.secrets.map((s) => s.name),
        )
        writeJsonFile(infraPath, infra)
      }
    }
  }

  // 4. CORS (JSONC-aware: preserves comments + untouched formatting)
  if (manifest.corsEntries.length > 0) {
    const appPath = path.join(apiDir, 'encore.app')
    if (fs.existsSync(appPath)) {
      const next = removeCors(readEncoreAppCors(appPath), manifest.corsEntries)
      const touched = new Set(manifest.corsEntries.map((e) => e.field))
      writeEncoreAppCorsFields(appPath, next, touched)
    }
  }

  // 5. Redis resource block in infra.config.json (spec 008 / 018)
  const redisResource = manifest.infraResources?.redis
  if (redisResource) {
    const infraPath = path.join(apiDir, 'infra.config.json')
    if (fs.existsSync(infraPath)) {
      const infra = readJsonFile<InfraConfig>(infraPath)
      if (infra.redis) {
        infra.redis = removeRedis(infra.redis, [redisResource.cluster])
        if (Object.keys(infra.redis).length === 0) delete infra.redis
        writeJsonFile(infraPath, infra)
      }
    }
  }
}

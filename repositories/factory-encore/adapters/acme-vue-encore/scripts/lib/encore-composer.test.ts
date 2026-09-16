/**
 * Unit + integration tests for the Encore module-composition engine (spec 002).
 *
 * The pure functions are tested directly; the I/O wrappers (composeModule /
 * decomposeModule) are exercised against a temp apps/api fixture seeded with
 * existing migrations, secrets, and CORS so renumber/merge/remove behaviour is
 * observable end-to-end.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  nextMigrationPrefix,
  renumberMigration,
  mergeSecrets,
  removeSecrets,
  mergeRedis,
  removeRedis,
  mergeCors,
  removeCors,
  composeModule,
  decomposeModule,
  copyServiceDir,
  type GlobalCors,
  type SecretBinding,
  type RedisCluster,
} from './encore-composer'
import { parse as parseJsonc } from 'jsonc-parser'
import { manifestSchema } from './manifest.schema'
import {
  makeFixtureServiceModule,
  makeFixtureApiDir,
} from './__fixtures__/test-helpers'

// ─── pure: nextMigrationPrefix ─────────────────────────────────────────────

describe('nextMigrationPrefix', () => {
  it('returns 1 when there are no migrations', () => {
    expect(nextMigrationPrefix([])).toBe(1)
  })

  it('ignores non-up.sql files', () => {
    expect(nextMigrationPrefix(['1_init.down.sql', 'README.md', '4_thing.txt'])).toBe(1)
  })

  it('returns max prefix + 1', () => {
    expect(nextMigrationPrefix(['1_init.up.sql', '3_refresh_token.up.sql', '2_users.up.sql'])).toBe(4)
  })

  it('handles full paths, not just basenames', () => {
    expect(nextMigrationPrefix(['db/migrations/2_users.up.sql', 'db/migrations/5_x.up.sql'])).toBe(6)
  })

  it('skips filenames without a numeric prefix', () => {
    expect(nextMigrationPrefix(['init.up.sql', '7_real.up.sql'])).toBe(8)
  })
})

// ─── pure: renumberMigration ───────────────────────────────────────────────

describe('renumberMigration', () => {
  it('replaces the leading <n>_ with <prefix>_', () => {
    expect(renumberMigration('1_init.up.sql', 5)).toBe('5_init.up.sql')
  })

  it('replaces multi-digit prefixes', () => {
    expect(renumberMigration('12_widget.up.sql', 3)).toBe('3_widget.up.sql')
  })

  it('strips any directory component (returns basename)', () => {
    expect(renumberMigration('db/1_widget.up.sql', 9)).toBe('9_widget.up.sql')
  })

  it('returns the basename unchanged when there is no numeric prefix', () => {
    expect(renumberMigration('widget.up.sql', 4)).toBe('widget.up.sql')
  })
})

// ─── pure: mergeSecrets / removeSecrets ────────────────────────────────────

describe('mergeSecrets', () => {
  it('adds name -> { $env: name } for new secrets', () => {
    const result = mergeSecrets({}, [{ name: 'A' }, { name: 'B' }])
    expect(result).toEqual({ A: { $env: 'A' }, B: { $env: 'B' } })
  })

  it('is idempotent and never overwrites an existing binding', () => {
    const current: Record<string, SecretBinding> = { A: { $env: 'CUSTOM_ENV' } }
    const result = mergeSecrets(current, [{ name: 'A' }, { name: 'B' }])
    expect(result.A).toEqual({ $env: 'CUSTOM_ENV' })
    expect(result.B).toEqual({ $env: 'B' })
  })

  it('does not mutate the input object', () => {
    const current: Record<string, SecretBinding> = { A: { $env: 'A' } }
    mergeSecrets(current, [{ name: 'B' }])
    expect(current).toEqual({ A: { $env: 'A' } })
  })
})

describe('removeSecrets', () => {
  it('removes the named keys', () => {
    const current: Record<string, SecretBinding> = {
      A: { $env: 'A' },
      B: { $env: 'B' },
      C: { $env: 'C' },
    }
    expect(removeSecrets(current, ['B'])).toEqual({ A: { $env: 'A' }, C: { $env: 'C' } })
  })

  it('does not mutate the input and ignores unknown names', () => {
    const current: Record<string, SecretBinding> = { A: { $env: 'A' } }
    const result = removeSecrets(current, ['X'])
    expect(result).toEqual({ A: { $env: 'A' } })
    expect(current).toEqual({ A: { $env: 'A' } })
  })
})

// ─── pure: mergeRedis / removeRedis ────────────────────────────────────────

describe('mergeRedis', () => {
  it('adds a cluster reached over the typed REDIS_HOST / REDIS_USER / REDIS_PASSWORD triple', () => {
    const result = mergeRedis({}, { cluster: 'cache' })
    expect(result).toEqual({
      cache: {
        host: '${REDIS_HOST}',
        auth: { type: 'acl', username: '${REDIS_USER}', password: { $env: 'REDIS_PASSWORD' } },
      },
    })
  })

  it('includes key_prefix only when provided', () => {
    expect(mergeRedis({}, { cluster: 'cache', keyPrefix: 'app:' }).cache.key_prefix).toBe('app:')
    expect('key_prefix' in mergeRedis({}, { cluster: 'cache' }).cache).toBe(false)
  })

  it('is idempotent and never overwrites an existing cluster', () => {
    const current: Record<string, RedisCluster> = {
      cache: { host: 'custom', auth: { type: 'acl', username: 'u', password: { $env: 'P' } } },
    }
    const result = mergeRedis(current, { cluster: 'cache' })
    expect(result.cache.host).toBe('custom')
  })

  it('does not mutate the input object', () => {
    const current: Record<string, RedisCluster> = {}
    mergeRedis(current, { cluster: 'cache' })
    expect(current).toEqual({})
  })
})

describe('removeRedis', () => {
  it('removes the named clusters', () => {
    const current = mergeRedis({}, { cluster: 'cache' })
    expect(removeRedis(current, ['cache'])).toEqual({})
  })

  it('does not mutate the input and ignores unknown clusters', () => {
    const current = mergeRedis({}, { cluster: 'cache' })
    const result = removeRedis(current, ['other'])
    expect(result).toEqual(current)
    expect(Object.keys(current)).toEqual(['cache'])
  })
})

// ─── pure: mergeCors / removeCors ──────────────────────────────────────────

describe('mergeCors', () => {
  it('appends values to an existing field, deduplicated', () => {
    const current: GlobalCors = { allow_headers: ['Authorization', 'Content-Type'] }
    const result = mergeCors(current, [
      { field: 'allow_headers', values: ['Content-Type', 'X-Widget'] },
    ])
    expect(result.allow_headers).toEqual(['Authorization', 'Content-Type', 'X-Widget'])
  })

  it('creates the field array when absent', () => {
    const result = mergeCors({}, [{ field: 'expose_headers', values: ['X-Total'] }])
    expect(result.expose_headers).toEqual(['X-Total'])
  })

  it('does not mutate the input', () => {
    const current: GlobalCors = { allow_headers: ['A'] }
    mergeCors(current, [{ field: 'allow_headers', values: ['B'] }])
    expect(current.allow_headers).toEqual(['A'])
  })
})

describe('removeCors', () => {
  it('removes the given values from the matching field', () => {
    const current: GlobalCors = { allow_headers: ['Authorization', 'X-Widget', 'Content-Type'] }
    const result = removeCors(current, [{ field: 'allow_headers', values: ['X-Widget'] }])
    expect(result.allow_headers).toEqual(['Authorization', 'Content-Type'])
  })

  it('leaves other fields untouched and ignores unknown fields', () => {
    const current: GlobalCors = { allow_headers: ['A'] }
    const result = removeCors(current, [{ field: 'expose_headers', values: ['Z'] }])
    expect(result).toEqual({ allow_headers: ['A'] })
  })
})

// ─── I/O: copyServiceDir ───────────────────────────────────────────────────

describe('copyServiceDir', () => {
  let tmp: string
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'composer-copy-'))
  })
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('recursively copies a directory tree', () => {
    const src = path.join(tmp, 'src', 'svc')
    fs.mkdirSync(path.join(src, 'nested'), { recursive: true })
    fs.writeFileSync(path.join(src, 'a.ts'), 'a')
    fs.writeFileSync(path.join(src, 'nested', 'b.ts'), 'b')

    const dest = path.join(tmp, 'dest', 'svc')
    copyServiceDir(src, dest)

    expect(fs.readFileSync(path.join(dest, 'a.ts'), 'utf-8')).toBe('a')
    expect(fs.readFileSync(path.join(dest, 'nested', 'b.ts'), 'utf-8')).toBe('b')
  })
})

// ─── I/O: composeModule / decomposeModule ──────────────────────────────────

describe('composeModule / decomposeModule (fixture round-trip)', () => {
  let tmp: string
  let moduleDir: string
  let apiDir: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'composer-io-'))
    moduleDir = makeFixtureServiceModule(path.join(tmp, 'modules'))
    apiDir = makeFixtureApiDir(tmp)
  })

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  function loadManifest() {
    return manifestSchema.parse(
      JSON.parse(fs.readFileSync(path.join(moduleDir, 'manifest.json'), 'utf-8')),
    )
  }

  it('composeModule copies the service directory into apps/api/<service>', () => {
    composeModule({ moduleDir, manifest: loadManifest(), apiDir })
    expect(fs.existsSync(path.join(apiDir, 'widget', 'encore.service.ts'))).toBe(true)
    expect(fs.existsSync(path.join(apiDir, 'widget', 'widget.ts'))).toBe(true)
  })

  it('composeModule renumbers the migration to the next free prefix (3)', () => {
    const result = composeModule({ moduleDir, manifest: loadManifest(), apiDir })
    const migrationsDir = path.join(apiDir, 'db', 'migrations')
    expect(fs.existsSync(path.join(migrationsDir, '3_widget.up.sql'))).toBe(true)
    expect(result.migrationsAdded).toEqual(['3_widget.up.sql'])
    // original 1_/2_ untouched, source prefix (1_) not used
    expect(fs.existsSync(path.join(migrationsDir, '1_init.up.sql'))).toBe(true)
    expect(fs.existsSync(path.join(migrationsDir, '2_users.up.sql'))).toBe(true)
    expect(fs.existsSync(path.join(migrationsDir, '1_widget.up.sql'))).toBe(false)
  })

  it('composeModule adds the secret binding to infra.config.json without touching existing ones', () => {
    const result = composeModule({ moduleDir, manifest: loadManifest(), apiDir })
    const infra = JSON.parse(fs.readFileSync(path.join(apiDir, 'infra.config.json'), 'utf-8'))
    expect(infra.secrets.WIDGET_API_KEY).toEqual({ $env: 'WIDGET_API_KEY' })
    expect(infra.secrets.JWT_PRIVATE_KEY).toEqual({ $env: 'JWT_PRIVATE_KEY' })
    expect(result.secretsAdded).toContain('WIDGET_API_KEY')
  })

  it('composeModule adds the CORS value to encore.app, deduplicated', () => {
    composeModule({ moduleDir, manifest: loadManifest(), apiDir })
    const app = JSON.parse(fs.readFileSync(path.join(apiDir, 'encore.app'), 'utf-8'))
    expect(app.global_cors.allow_headers).toContain('X-Widget')
    // pre-existing headers preserved
    expect(app.global_cors.allow_headers).toContain('Authorization')
    expect(app.global_cors.allow_headers).toContain('Content-Type')
  })

  it('composeModule is idempotent on secrets and CORS (re-compose adds nothing new)', () => {
    composeModule({ moduleDir, manifest: loadManifest(), apiDir })
    // Recompose against a higher prefix; secrets/cors should not duplicate
    composeModule({ moduleDir, manifest: loadManifest(), apiDir })
    const app = JSON.parse(fs.readFileSync(path.join(apiDir, 'encore.app'), 'utf-8'))
    const widgetCount = app.global_cors.allow_headers.filter((h: string) => h === 'X-Widget').length
    expect(widgetCount).toBe(1)
    const infra = JSON.parse(fs.readFileSync(path.join(apiDir, 'infra.config.json'), 'utf-8'))
    expect(infra.secrets.WIDGET_API_KEY).toEqual({ $env: 'WIDGET_API_KEY' })
  })

  it('decomposeModule reverses service, migration, secret, and cors changes', () => {
    const { migrationsAdded } = composeModule({ moduleDir, manifest: loadManifest(), apiDir })
    decomposeModule({ moduleDir, manifest: loadManifest(), apiDir, composedMigrations: migrationsAdded })

    // service dir gone
    expect(fs.existsSync(path.join(apiDir, 'widget'))).toBe(false)

    // migration gone, originals intact
    const migrationsDir = path.join(apiDir, 'db', 'migrations')
    expect(fs.existsSync(path.join(migrationsDir, '3_widget.up.sql'))).toBe(false)
    expect(fs.existsSync(path.join(migrationsDir, '1_init.up.sql'))).toBe(true)
    expect(fs.existsSync(path.join(migrationsDir, '2_users.up.sql'))).toBe(true)

    // secret binding gone, existing one intact
    const infra = JSON.parse(fs.readFileSync(path.join(apiDir, 'infra.config.json'), 'utf-8'))
    expect(infra.secrets.WIDGET_API_KEY).toBeUndefined()
    expect(infra.secrets.JWT_PRIVATE_KEY).toEqual({ $env: 'JWT_PRIVATE_KEY' })

    // cors value gone, existing values intact
    const app = JSON.parse(fs.readFileSync(path.join(apiDir, 'encore.app'), 'utf-8'))
    expect(app.global_cors.allow_headers).not.toContain('X-Widget')
    expect(app.global_cors.allow_headers).toContain('Authorization')
  })

  it('composeModule skips gracefully when a section is empty', () => {
    const manifest = loadManifest()
    const emptyish = { ...manifest, services: [], migrations: [], corsEntries: [] }
    const result = composeModule({ moduleDir, manifest: emptyish, apiDir })
    expect(result.migrationsAdded).toEqual([])
    // only the secret was applied
    const infra = JSON.parse(fs.readFileSync(path.join(apiDir, 'infra.config.json'), 'utf-8'))
    expect(infra.secrets.WIDGET_API_KEY).toEqual({ $env: 'WIDGET_API_KEY' })
    expect(fs.existsSync(path.join(apiDir, 'widget'))).toBe(false)
  })

  // A marker-only data-redis-style manifest: no services/migrations/secrets/cors,
  // just the infra.config redis resource (spec 008 FR-001).
  function redisManifest() {
    return manifestSchema.parse({
      name: 'data-redis',
      description: 'redis resource',
      infraResources: { redis: { cluster: 'cache' } },
    })
  }

  it('composeModule adds the redis block to infra.config.json (typed triple), leaving sql/secrets intact', () => {
    composeModule({ moduleDir, manifest: redisManifest(), apiDir })
    const infra = JSON.parse(fs.readFileSync(path.join(apiDir, 'infra.config.json'), 'utf-8'))
    expect(infra.redis.cache).toEqual({
      host: '${REDIS_HOST}',
      auth: { type: 'acl', username: '${REDIS_USER}', password: { $env: 'REDIS_PASSWORD' } },
    })
    // the baseline's own secrets are untouched
    expect(infra.secrets.JWT_PRIVATE_KEY).toEqual({ $env: 'JWT_PRIVATE_KEY' })
  })

  it('decomposeModule removes the redis block (and drops the empty redis key)', () => {
    composeModule({ moduleDir, manifest: redisManifest(), apiDir })
    decomposeModule({ moduleDir, manifest: redisManifest(), apiDir })
    const infra = JSON.parse(fs.readFileSync(path.join(apiDir, 'infra.config.json'), 'utf-8'))
    expect(infra.redis).toBeUndefined()
    expect(infra.secrets.JWT_PRIVATE_KEY).toEqual({ $env: 'JWT_PRIVATE_KEY' })
  })
})

// ─── regression: sibling modules sharing a migration tail ──────────────────
//
// Two modules whose migration SOURCES share the same tail (both ship a
// `1_init.up.sql`) get renumbered to distinct on-disk prefixes (e.g. 3_/4_).
// The old tail-match decompose deleted BOTH on either remove; deleting by the
// exact recorded filename must leave the other module's migration intact.

describe('decomposeModule — sibling modules with colliding migration tails', () => {
  let tmp: string
  let apiDir: string

  /** Write a service module that ships `db/1_init.up.sql` (a colliding tail). */
  function makeInitModule(dir: string, name: string): string {
    const moduleDir = path.join(dir, name)
    const filesDir = path.join(moduleDir, 'files')
    const manifest = {
      name,
      version: '1.0.0',
      description: `Fixture module ${name} with a colliding init migration`,
      status: 'stable',
      services: [name],
      migrations: [{ source: 'db/1_init.up.sql', description: 'create table' }],
      secrets: [],
      corsEntries: [],
    }
    fs.mkdirSync(path.join(filesDir, name), { recursive: true })
    fs.mkdirSync(path.join(filesDir, 'db'), { recursive: true })
    fs.writeFileSync(path.join(moduleDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
    fs.writeFileSync(
      path.join(filesDir, name, 'encore.service.ts'),
      `import { Service } from 'encore.dev/service'\nexport default new Service('${name}')\n`,
    )
    fs.writeFileSync(
      path.join(filesDir, 'db', '1_init.up.sql'),
      `CREATE TABLE ${name} ( id BIGSERIAL PRIMARY KEY );\n`,
    )
    return moduleDir
  }

  function loadManifestAt(moduleDir: string) {
    return manifestSchema.parse(
      JSON.parse(fs.readFileSync(path.join(moduleDir, 'manifest.json'), 'utf-8')),
    )
  }

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'composer-collide-'))
    // Fresh empty apps/api (no seeded migrations) so prefixes start at 1.
    apiDir = path.join(tmp, 'apps', 'api')
    fs.mkdirSync(path.join(apiDir, 'db', 'migrations'), { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('decomposing the first does not delete the second module migration', () => {
    const modulesDir = path.join(tmp, 'modules')
    const dirA = makeInitModule(modulesDir, 'alpha')
    const dirB = makeInitModule(modulesDir, 'beta')

    const resultA = composeModule({ moduleDir: dirA, manifest: loadManifestAt(dirA), apiDir })
    const resultB = composeModule({ moduleDir: dirB, manifest: loadManifestAt(dirB), apiDir })

    const migrationsDir = path.join(apiDir, 'db', 'migrations')
    // Distinct on-disk names despite the shared source tail.
    expect(resultA.migrationsAdded).toEqual(['1_init.up.sql'])
    expect(resultB.migrationsAdded).toEqual(['2_init.up.sql'])
    expect(fs.existsSync(path.join(migrationsDir, '1_init.up.sql'))).toBe(true)
    expect(fs.existsSync(path.join(migrationsDir, '2_init.up.sql'))).toBe(true)

    // Decompose only the FIRST module, passing its exact composed filenames.
    decomposeModule({
      moduleDir: dirA,
      manifest: loadManifestAt(dirA),
      apiDir,
      composedMigrations: resultA.migrationsAdded,
    })

    // The first module's migration is gone; the SECOND module's survives.
    expect(fs.existsSync(path.join(migrationsDir, '1_init.up.sql'))).toBe(false)
    expect(fs.existsSync(path.join(migrationsDir, '2_init.up.sql'))).toBe(true)
  })
})

// ─── JSONC: encore.app CORS merge preserves comments (spec 003) ────────────
//
// The real apps/api/encore.app is JSONC (carries `//` comments). The composer
// must merge global_cors without stripping those comments or reformatting the
// rest of the file (spec 002 left this fixture-only; spec 003 hardens it).

describe('composeModule / decomposeModule — JSONC encore.app (comment-preserving)', () => {
  let tmp: string
  let moduleDir: string
  let apiDir: string

  const JSONC_ENCORE_APP = `{
  // App ID assigned by the Encore platform once linked.
  "id": "",
  "lang": "typescript",

  // CORS: credentialed origins must list every SPA origin.
  "global_cors": {
    "debug": false,

    // headers the browser may send (mirrors the real encore.app: comments
    // sit above each field, not inside the value arrays)
    "allow_headers": [
      "Authorization",
      "Content-Type"
    ]
  }
}
`

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'composer-jsonc-'))
    moduleDir = makeFixtureServiceModule(path.join(tmp, 'modules'))
    apiDir = path.join(tmp, 'apps', 'api')
    fs.mkdirSync(path.join(apiDir, 'db', 'migrations'), { recursive: true })
    fs.writeFileSync(
      path.join(apiDir, 'infra.config.json'),
      JSON.stringify({ secrets: {} }, null, 2) + '\n',
    )
    fs.writeFileSync(path.join(apiDir, 'encore.app'), JSONC_ENCORE_APP)
  })

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  function loadManifest() {
    return manifestSchema.parse(
      JSON.parse(fs.readFileSync(path.join(moduleDir, 'manifest.json'), 'utf-8')),
    )
  }

  it('composeModule merges into a JSONC encore.app without stripping comments', () => {
    composeModule({ moduleDir, manifest: loadManifest(), apiDir })
    const text = fs.readFileSync(path.join(apiDir, 'encore.app'), 'utf-8')

    // Every comment survives the merge.
    expect(text).toContain('// App ID assigned by the Encore platform once linked.')
    expect(text).toContain('// CORS: credentialed origins must list every SPA origin.')
    expect(text).toContain('// headers the browser may send')

    // The contributed value is merged in (read the value with the JSONC parser).
    const app = parseJsonc(text) as { global_cors: { allow_headers: string[] } }
    expect(app.global_cors.allow_headers).toContain('X-Widget')
    expect(app.global_cors.allow_headers).toContain('Authorization')
    expect(app.global_cors.allow_headers).toContain('Content-Type')
  })

  it('decomposeModule removes the value but keeps the comments', () => {
    const { migrationsAdded } = composeModule({ moduleDir, manifest: loadManifest(), apiDir })
    decomposeModule({ moduleDir, manifest: loadManifest(), apiDir, composedMigrations: migrationsAdded })

    const text = fs.readFileSync(path.join(apiDir, 'encore.app'), 'utf-8')
    expect(text).toContain('// CORS: credentialed origins must list every SPA origin.')

    const app = parseJsonc(text) as { global_cors: { allow_headers: string[] } }
    expect(app.global_cors.allow_headers).not.toContain('X-Widget')
    expect(app.global_cors.allow_headers).toContain('Authorization')
  })
})

// ─── security: path-traversal guards (spec 002) ─────────────────────────────

describe('composeModule — path-traversal guards', () => {
  let tmp: string
  let moduleDir: string
  let apiDir: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'composer-guard-'))
    moduleDir = makeFixtureServiceModule(path.join(tmp, 'modules'))
    apiDir = makeFixtureApiDir(tmp)
  })

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  function loadManifest() {
    return manifestSchema.parse(
      JSON.parse(fs.readFileSync(path.join(moduleDir, 'manifest.json'), 'utf-8')),
    )
  }

  it('throws for a service name that escapes the module directory', () => {
    const manifest = { ...loadManifest(), services: ['../evil'] }
    expect(() => composeModule({ moduleDir, manifest, apiDir })).toThrow(/escapes the module directory/)
  })

  it('throws for a migration.source that escapes the module directory', () => {
    const manifest = {
      ...loadManifest(),
      services: [],
      migrations: [{ source: '../../escape.up.sql', description: 'malicious' }],
    }
    expect(() => composeModule({ moduleDir, manifest, apiDir })).toThrow(/escapes the module directory/)
  })

  it('allows a legitimate migration.source in a subdirectory (db/...)', () => {
    // The fixture already ships db/1_widget.up.sql — services dropped so only
    // the (valid, sub-dir'd) migration path is exercised.
    const manifest = {
      ...loadManifest(),
      services: [],
      migrations: [{ source: 'db/1_widget.up.sql', description: 'create widget table' }],
    }
    const result = composeModule({ moduleDir, manifest, apiDir })
    expect(result.migrationsAdded).toEqual(['3_widget.up.sql'])
    expect(fs.existsSync(path.join(apiDir, 'db', 'migrations', '3_widget.up.sql'))).toBe(true)
  })
})

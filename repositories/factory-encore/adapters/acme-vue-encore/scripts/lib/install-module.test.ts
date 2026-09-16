/**
 * Regression coverage for the generate-path install (installModule).
 *
 * The guard around composeModule must fire for an infra-resource-only module
 * (data-redis: no services/migrations/secrets/cors, just infraResources.redis).
 * Before spec 008 FR-001 that guard checked only services/migrations/secrets/cors,
 * so a redis-only module was installed into template.json but its infra.config
 * redis block was silently dropped.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { installModule } from './install-module'
import { manifestSchema } from './manifest.schema'
import { buildEmptyState, makeFixtureApiDir } from './__fixtures__/test-helpers'

describe('installModule: infra-resource-only module (data-redis, spec 008 FR-001)', () => {
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'install-redis-'))
    makeFixtureApiDir(tmp) // seeds apps/api/infra.config.json
    // A marker-only module: no services/migrations/secrets/cors, only a redis resource.
    const moduleDir = path.join(tmp, 'modules', 'data-redis')
    fs.mkdirSync(moduleDir, { recursive: true })
    fs.writeFileSync(
      path.join(moduleDir, 'manifest.json'),
      JSON.stringify({
        name: 'data-redis',
        description: 'redis resource',
        infraResources: { redis: { cluster: 'cache' } },
      }),
    )
  })

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  function manifest() {
    return manifestSchema.parse(
      JSON.parse(fs.readFileSync(path.join(tmp, 'modules', 'data-redis', 'manifest.json'), 'utf-8')),
    )
  }

  it('composes the infra.config redis block with no service/migration/secret/cors declared', () => {
    installModule({
      projectRoot: tmp,
      adapterRoot: tmp,
      moduleName: 'data-redis',
      manifest: manifest(),
      state: buildEmptyState(),
    })
    const infra = JSON.parse(fs.readFileSync(path.join(tmp, 'apps', 'api', 'infra.config.json'), 'utf-8'))
    expect(infra.redis.cache).toEqual({
      host: '${REDIS_HOST}',
      auth: { type: 'acl', username: '${REDIS_USER}', password: { $env: 'REDIS_PASSWORD' } },
    })
    // the baseline's existing secret is untouched
    expect(infra.secrets.JWT_PRIVATE_KEY).toEqual({ $env: 'JWT_PRIVATE_KEY' })
  })
})

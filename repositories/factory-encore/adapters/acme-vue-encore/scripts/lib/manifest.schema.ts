import { z } from 'zod'

const envVarSchema = z.object({
  value: z.string().optional(),
  required: z.boolean(),
  description: z.string(),
  sensitive: z.boolean().optional(),
})

/**
 * Encore secret declaration: the `secret("Name")` a module's service needs,
 * bound in `infra.config.json`. Replaces the Express env-secret model.
 */
const secretSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  required: z.boolean().default(true),
})

/** An addition this module contributes to `encore.app` `global_cors`. */
const corsEntrySchema = z.object({
  field: z.enum([
    'allow_headers',
    'expose_headers',
    'allow_origins_with_credentials',
    'allow_origins_without_credentials',
  ]),
  values: z.array(z.string()),
})

/** A migration file merged into `db/migrations/` (renumbered deterministically on merge). */
const migrationSchema = z.object({
  source: z.string(),
  description: z.string().optional(),
})

/**
 * An optional Encore `infra.config.json` `redis` resource this module composes
 * (spec 008 FR-001, template-encore spec 018). Topology-only: the block is
 * reached over the typed REDIS_HOST / REDIS_USER / REDIS_PASSWORD connection and
 * needs no `CacheCluster` in code (verified against Encore v1.57.9). `cluster`
 * is the infra.config key (default `cache`); `keyPrefix` sets an optional
 * namespace.
 */
const redisResourceSchema = z.object({
  // Constrain the cluster name to a lowercase kebab identifier. mergeRedis writes
  // it as an object key reached via the `in` operator, which walks the prototype
  // chain, so an unconstrained value like "__proto__"/"constructor" could shadow
  // an inherited property instead of creating an own key. Manifests are
  // adapter-authored (low blast radius), but this constraint costs nothing and
  // closes the prototype-pollution vector.
  cluster: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/, 'cluster must be a lowercase kebab identifier')
    .default('cache'),
  keyPrefix: z.string().optional(),
})

/**
 * Encore `infra.config.json` resource blocks this module contributes. Redis is
 * the first (spec 008); further resource types (object storage, pub/sub,
 * metrics) extend this object once the redis promotion proves the pattern.
 */
const infraResourcesSchema = z.object({
  redis: redisResourceSchema.optional(),
})

/**
 * Module manifest contract — v2 (Encore compile-time service composition).
 *
 * Spec 001 (`module-manifest-schema`). The
 * Express runtime-registry fields (`apiRegistrations`, `authDriverRegistration`,
 * `sideEffectImports`) are removed: Encore discovers services from the
 * filesystem (`encore.service.ts` per directory) and has no `app.use` ordering
 * and no runtime auth-driver registry. Composition is now declared as service
 * directories plus declarative `encore.app` / `infra.config.json` / per-service
 * middleware-array contributions. The new fields are defined here and populated
 * by spec 002.
 */
export const manifestSchema = z.object({
  name: z.string().min(1),
  version: z.string().default('1.0.0'),
  description: z.string(),
  status: z.enum(['stable', 'planned']).default('stable'),

  requires: z.array(z.string()).default([]),
  requiresOneOf: z.array(z.array(z.string())).default([]),
  optionalPeers: z.array(z.string()).default([]),
  conflicts: z.array(z.string()).default([]),

  files: z.record(z.string(), z.string()).default({}),

  authExports: z.array(z.string()).default([]),

  // --- Encore service-composition contract (v2) ---
  /** Encore service directories this module contributes (each a `<svc>/encore.service.ts` + endpoints). */
  services: z.array(z.string()).default([]),
  /** Encore `secret()` names this module needs, bound in `infra.config.json`. */
  secrets: z.array(secretSchema).default([]),
  /** Additions to `encore.app` `global_cors`. */
  corsEntries: z.array(corsEntrySchema).default([]),
  /** `lib` middleware factories a contributed service composes (by export name). */
  middlewares: z.array(z.string()).default([]),
  /** Migration files merged into `db/migrations/`. */
  migrations: z.array(migrationSchema).default([]),

  packageDeps: z.record(z.string(), z.record(z.string(), z.string())).default({}),

  /** Optional Encore `infra.config.json` resource blocks (redis, ...). */
  infraResources: infraResourcesSchema.default({}),

  envVars: z.record(z.string(), envVarSchema).default({}),

  webSnippetFile: z.string().optional(),

  workspaceChanges: z
    .object({
      add: z.array(z.string()).optional(),
      remove: z.array(z.string()).optional(),
    })
    .optional(),
})

export type ModuleManifest = z.infer<typeof manifestSchema>
export type EnvVarDef = z.infer<typeof envVarSchema>
export type ModuleSecret = z.infer<typeof secretSchema>
export type ModuleCorsEntry = z.infer<typeof corsEntrySchema>
export type ModuleMigration = z.infer<typeof migrationSchema>
export type ModuleRedisResource = z.infer<typeof redisResourceSchema>
export type ModuleInfraResources = z.infer<typeof infraResourcesSchema>

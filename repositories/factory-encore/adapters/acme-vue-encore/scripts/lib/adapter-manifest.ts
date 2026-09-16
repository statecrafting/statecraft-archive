/**
 * Adapter-manifest reader (STRUCT-1 single authority).
 *
 * The adapter `manifest.yaml` `scaffold.profiles[].modules` is the single
 * source of truth for which optional modules a profile ships by default. The
 * generator reads it here instead of hardcoding a per-profile module list, so
 * the declaration and the behaviour cannot drift (the prior bug: three
 * declarations said `internal` ships `user-management`, the generator shipped
 * none). Only the slice the generator needs is parsed and validated; the rest
 * of the manifest is the stagecraft-admission concern (OAP).
 */

import fs from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'

/** The single profile entry the generator cares about. */
const profileSchema = z.object({
  name: z.string().min(1),
  variant: z.string().optional(),
  modules: z.array(z.string()).default([]),
  default: z.boolean().optional(),
})

/** Only `scaffold.profiles` is validated; everything else is passthrough. */
const scaffoldProfilesSchema = z.object({
  scaffold: z.object({
    profiles: z.array(profileSchema).default([]),
  }),
})

export type AdapterProfile = z.infer<typeof profileSchema>

/** Parse and validate `scaffold.profiles` from the adapter manifest. */
export function loadProfiles(adapterRoot: string): AdapterProfile[] {
  const manifestPath = path.join(adapterRoot, 'manifest.yaml')
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Adapter manifest not found at ${manifestPath}`)
  }
  const raw = parseYaml(fs.readFileSync(manifestPath, 'utf-8'))
  return scaffoldProfilesSchema.parse(raw).scaffold.profiles
}

/**
 * The modules a profile ships by default, per the manifest. Unknown profile
 * names throw (the caller has already validated the profile key against the
 * generator's auth-driver PROFILES, so a mismatch here means the manifest and
 * the generator disagree on the profile set, which is a real error to surface).
 */
export function profileModules(adapterRoot: string, profileKey: string): string[] {
  const profile = loadProfiles(adapterRoot).find((p) => p.name === profileKey)
  if (!profile) {
    throw new Error(
      `Profile "${profileKey}" not declared in manifest.yaml scaffold.profiles`,
    )
  }
  return profile.modules
}

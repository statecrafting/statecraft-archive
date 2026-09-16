import * as fs from 'node:fs'
import * as path from 'node:path'
import { type ModuleManifest } from './manifest.schema'

export function mergeEnvVars(
  projectRoot: string,
  manifest: ModuleManifest,
): { added: string[]; skipped: string[] } {
  const envPath = path.join(projectRoot, '.env.example')
  const content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : ''

  const existingKeys = new Set<string>()
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const key = trimmed.split('=')[0].trim()
      existingKeys.add(key)
    }
  }

  const added: string[] = []
  const skipped: string[] = []
  const newLines: string[] = []

  const envEntries = Object.entries(manifest.envVars)
  if (envEntries.length === 0) return { added, skipped }

  let hasNewVars = false
  for (const [key, def] of envEntries) {
    if (existingKeys.has(key)) {
      skipped.push(key)
    } else {
      if (!hasNewVars) {
        newLines.push('')
        newLines.push(`# --- ${manifest.name} ---`)
        hasNewVars = true
      }
      newLines.push(`# ${def.description}`)
      if (def.sensitive) {
        newLines.push(`# WARNING: This is a sensitive value — do not commit`)
      }
      newLines.push(`${key}=${def.value ?? ''}`)
      added.push(key)
    }
  }

  if (newLines.length > 0) {
    const updated = content.trimEnd() + '\n' + newLines.join('\n') + '\n'
    fs.writeFileSync(envPath, updated, 'utf-8')
  }

  return { added, skipped }
}

export function commentOutEnvVars(projectRoot: string, manifest: ModuleManifest): void {
  const envPath = path.join(projectRoot, '.env.example')
  if (!fs.existsSync(envPath)) return

  const content = fs.readFileSync(envPath, 'utf-8')
  const keysToComment = new Set(Object.keys(manifest.envVars))
  const sectionHeader = `# --- ${manifest.name} ---`

  const lines = content.split('\n')
  const result: string[] = []

  for (const line of lines) {
    if (line.trim() === sectionHeader) continue

    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const key = trimmed.split('=')[0].trim()
      if (keysToComment.has(key)) {
        result.push(`# ${line} # (removed with ${manifest.name})`)
        continue
      }
    }

    result.push(line)
  }

  fs.writeFileSync(envPath, result.join('\n'), 'utf-8')
}

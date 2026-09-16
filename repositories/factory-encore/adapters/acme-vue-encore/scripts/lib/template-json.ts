import * as fs from 'node:fs'
import * as path from 'node:path'
import { z } from 'zod'

const moduleEntrySchema = z.object({
  version: z.string(),
  installedAt: z.string().optional(),
  alwaysOn: z.boolean().optional(),
  composedMigrations: z.array(z.string()).optional(),
})

const templateJsonSchema = z.object({
  templateName: z.string().default('template-encore'),
  baseVersion: z.string().default('3.0.0'),
  description: z.string().optional(),
  modules: z.record(z.string(), moduleEntrySchema).default({}),
  fileOwnership: z.record(z.string(), z.string()).default({}),
})

export type TemplateJson = z.infer<typeof templateJsonSchema>

export function loadTemplateJson(projectRoot: string): TemplateJson {
  const filePath = path.join(projectRoot, 'template.json')
  if (!fs.existsSync(filePath)) {
    return templateJsonSchema.parse({})
  }
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  return templateJsonSchema.parse(raw)
}

export function saveTemplateJson(projectRoot: string, data: TemplateJson): void {
  const filePath = path.join(projectRoot, 'template.json')
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8')
}

export function isModuleInstalled(state: TemplateJson, moduleName: string): boolean {
  return moduleName in state.modules
}

export function getInstalledModules(state: TemplateJson): string[] {
  return Object.entries(state.modules)
    .filter(([, entry]) => !entry.alwaysOn)
    .map(([name]) => name)
}

export function getAllModules(state: TemplateJson): string[] {
  return Object.keys(state.modules)
}

export function addModuleToState(
  state: TemplateJson,
  name: string,
  version: string,
  files: Record<string, string>,
  alwaysOn?: boolean,
): TemplateJson {
  const today = new Date().toISOString().slice(0, 10)
  const updated = { ...state }
  updated.modules = {
    ...updated.modules,
    [name]: { version, installedAt: today, ...(alwaysOn ? { alwaysOn: true } : {}) },
  }
  updated.fileOwnership = { ...updated.fileOwnership }
  for (const [, dest] of Object.entries(files)) {
    updated.fileOwnership[dest] = name
  }
  return updated
}

export function removeModuleFromState(state: TemplateJson, name: string): TemplateJson {
  const updated = { ...state }
  const { [name]: _, ...remainingModules } = updated.modules
  updated.modules = remainingModules
  updated.fileOwnership = { ...updated.fileOwnership }
  for (const [filePath, owner] of Object.entries(updated.fileOwnership)) {
    if (owner === name) {
      delete updated.fileOwnership[filePath]
    }
  }
  return updated
}

export function getFileOwner(state: TemplateJson, filePath: string): string | null {
  return state.fileOwnership[filePath] ?? null
}

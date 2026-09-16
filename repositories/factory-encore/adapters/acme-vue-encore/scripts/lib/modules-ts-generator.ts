import * as fs from 'node:fs'
import * as path from 'node:path'
import { type TemplateJson } from './template-json'
import { manifestSchema } from './manifest.schema'

function loadModuleManifest(projectRoot: string, moduleName: string) {
  const manifestPath = path.join(projectRoot, 'modules', moduleName, 'manifest.json')
  if (!fs.existsSync(manifestPath)) return null
  const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
  return manifestSchema.parse(raw)
}

export function generateApiModulesTs(_projectRoot: string, _state: TemplateJson): string {
  throw new Error('The Express backend module loader has been retired (spec 002). Encore composes services at compile time; the Encore-native generator lands in spec 002. See specs/002-encore-generator-core/.')
}

export function generateWebModulesTs(
  projectRoot: string,
  state: TemplateJson,
): string | null {
  if (!state.modules['frontend-core']) return null
  const imports = new Set<string>()
  imports.add("import { registerNavItem } from './composables/useNavigation'")

  const snippetBlocks: string[] = []

  for (const moduleName of Object.keys(state.modules)) {
    const manifest = loadModuleManifest(projectRoot, moduleName)
    if (!manifest?.webSnippetFile) continue

    const snippetPath = path.join(projectRoot, 'modules', moduleName, manifest.webSnippetFile)
    if (!fs.existsSync(snippetPath)) continue

    const content = fs.readFileSync(snippetPath, 'utf-8')
    const contentLines = content.split('\n')
    const importLines: string[] = []
    const nonImportLines: string[] = []

    for (const rawLine of contentLines) {
      const line = rawLine.replace(/\r$/, '')
      if (line.trimStart().startsWith('import ')) {
        importLines.push(line)
      } else {
        nonImportLines.push(line)
      }
    }

    for (const imp of importLines) {
      imports.add(imp)
    }

    const block = nonImportLines.join('\n').trim()
    if (block) snippetBlocks.push(block)
  }

  const lines: string[] = []
  lines.push('/**')
  lines.push(' * Web Module Loader')
  lines.push(' * DO NOT EDIT MANUALLY — managed by module orchestrator')
  lines.push(' */')
  lines.push('')

  for (const imp of imports) {
    lines.push(imp)
  }
  lines.push('')

  // Detect nav system: web-internal uses SidebarNavItem with slot, web uses NavItem with position
  const navPath = path.join(projectRoot, 'apps', 'web', 'src', 'composables', 'useNavigation.ts')
  const usesSlot = fs.existsSync(navPath) && fs.readFileSync(navPath, 'utf-8').includes("slot: 'primary'")

  lines.push('export function registerAllWebModules(): void {')
  lines.push('  // Base navigation')
  if (usesSlot) {
    lines.push(
      "  registerNavItem({ id: 'nav-home', label: 'Home', to: '/', slot: 'primary', priority: 10 })",
    )
    lines.push(
      "  registerNavItem({ id: 'nav-about', label: 'About', to: '/about', slot: 'primary', priority: 20 })",
    )
  } else {
    lines.push(
      "  registerNavItem({ id: 'nav-home', label: 'Home', to: '/', position: 'left', priority: 10 })",
    )
    lines.push(
      "  registerNavItem({ id: 'nav-about', label: 'About', to: '/about', position: 'left', priority: 20 })",
    )
  }

  if (snippetBlocks.length > 0) {
    lines.push('')
    lines.push('  // Module snippets')
    for (const block of snippetBlocks) {
      for (const line of block.split('\n')) {
        lines.push(line ? `  ${line}` : '')
      }
    }
  }

  lines.push('}')
  lines.push('')
  return lines.join('\n')
}

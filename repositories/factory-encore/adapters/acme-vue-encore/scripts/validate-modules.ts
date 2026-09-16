import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { manifestSchema } from './lib/manifest.schema'
import { loadTemplateJson, isModuleInstalled } from './lib/template-json'
import { generateWebModulesTs } from './lib/modules-ts-generator'

// Allow --root <path> or ROOT env var to target a different project (same pattern as add-module.ts).
// MODULES_ROOT always points to the script's own repo so the catalog is found even when
// validating a project at a different path via --root.
const _scriptDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const _rootArgIdx = process.argv.indexOf('--root')
const _rootOverride = _rootArgIdx !== -1 ? process.argv[_rootArgIdx + 1] : process.env.ROOT
const PROJECT_ROOT = _rootOverride ? path.resolve(_rootOverride) : _scriptDir
const MODULES_ROOT = _scriptDir
const showGraph = process.argv.includes('--graph')

let errors = 0

function fail(msg: string): void {
  console.error(`  FAIL: ${msg}`)
  errors++
}

function pass(msg: string): void {
  console.log(`  OK: ${msg}`)
}

// --- Check 1: template.json validity ---
console.log('\n1. Validating template.json...')
let state
try {
  state = loadTemplateJson(PROJECT_ROOT)
  pass('template.json is valid')
} catch (err) {
  fail(`template.json is invalid: ${(err as Error).message}`)
  process.exit(1)
}

// --- Check 2: Module catalog manifests ---
console.log('\n2. Validating module catalog manifests...')
const modulesDir = path.join(MODULES_ROOT, 'modules')
if (fs.existsSync(modulesDir)) {
  const moduleDirs = fs
    .readdirSync(modulesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)

  for (const dir of moduleDirs) {
    const manifestPath = path.join(modulesDir, dir, 'manifest.json')

    if (!fs.existsSync(manifestPath)) {
      fail(`modules/${dir}/manifest.json does not exist`)
      continue
    }

    try {
      const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
      const manifest = manifestSchema.parse(raw)

      // Name must match directory
      if (manifest.name !== dir) {
        fail(`modules/${dir}: manifest name "${manifest.name}" does not match directory "${dir}"`)
      }

      // All source files must exist
      for (const [src] of Object.entries(manifest.files)) {
        const srcPath = path.join(modulesDir, dir, 'files', src)
        if (!fs.existsSync(srcPath)) {
          fail(`modules/${dir}: source file "files/${src}" does not exist`)
        }
      }

      // webSnippetFile must exist if declared
      if (manifest.webSnippetFile) {
        const snippetPath = path.join(modulesDir, dir, manifest.webSnippetFile)
        if (!fs.existsSync(snippetPath)) {
          fail(
            `modules/${dir}: webSnippetFile "${manifest.webSnippetFile}" does not exist`,
          )
        }
      }

      pass(`modules/${dir}/manifest.json is valid`)
    } catch (err) {
      fail(`modules/${dir}/manifest.json is invalid: ${(err as Error).message}`)
    }
  }
} else {
  pass('No modules directory (OK if no modules defined yet)')
}

// --- Check 3: File ownership ---
console.log('\n3. Validating file ownership...')
for (const [filePath, owner] of Object.entries(state.fileOwnership)) {
  const fullPath = path.resolve(PROJECT_ROOT, filePath)
  if (!fs.existsSync(fullPath)) {
    fail(`Owned file "${filePath}" does not exist on disk`)
  }
  if (!isModuleInstalled(state, owner)) {
    fail(`File "${filePath}" is owned by "${owner}" which is not installed`)
  }
}
if (Object.keys(state.fileOwnership).length === 0) {
  pass('No file ownership entries (empty state)')
} else {
  pass(`All ${Object.keys(state.fileOwnership).length} owned files verified`)
}

// --- Check 4: Dependencies ---
console.log('\n4. Validating module dependencies...')
for (const moduleName of Object.keys(state.modules)) {
  const manifestPath = path.join(modulesDir, moduleName, 'manifest.json')
  if (!fs.existsSync(manifestPath)) {
    fail(`Installed module "${moduleName}" has no manifest in catalog`)
    continue
  }

  const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
  const manifest = manifestSchema.parse(raw)

  // Check requires
  for (const req of manifest.requires) {
    if (!isModuleInstalled(state, req)) {
      fail(`Module "${moduleName}" requires "${req}" which is not installed`)
    }
  }

  // Check requiresOneOf
  for (const group of manifest.requiresOneOf) {
    const satisfied = group.some((m) => isModuleInstalled(state, m))
    if (!satisfied) {
      fail(
        `Module "${moduleName}" requires one of [${group.join(', ')}] but none are installed`,
      )
    }
  }

  // Check no conflicts co-installed
  for (const conflict of manifest.conflicts) {
    if (isModuleInstalled(state, conflict)) {
      fail(
        `Module "${moduleName}" conflicts with "${conflict}" and both are installed`,
      )
    }
  }
}
if (Object.keys(state.modules).length === 0) {
  pass('No modules installed (empty state)')
} else {
  pass(`Dependencies verified for ${Object.keys(state.modules).length} modules`)
}

// --- Check 5: Generated files match ---
console.log('\n5. Validating generated files...')

// Web modules.ts
const expectedWebModules = generateWebModulesTs(PROJECT_ROOT, state)
const webModulesPath = path.join(PROJECT_ROOT, 'apps/web/src/modules.ts')
if (expectedWebModules === null) {
  if (fs.existsSync(webModulesPath)) {
    fail('apps/web/src/modules.ts exists but frontend-core is not installed')
  } else {
    pass('apps/web/src/modules.ts correctly absent (no frontend-core)')
  }
} else {
  if (fs.existsSync(webModulesPath)) {
    const actual = fs.readFileSync(webModulesPath, 'utf-8')
    if (actual.replace(/\r\n/g, '\n') === expectedWebModules) {
      pass('apps/web/src/modules.ts matches expected output')
    } else {
      fail(
        'apps/web/src/modules.ts does not match expected output (run add-module to regenerate)',
      )
    }
  } else {
    fail('apps/web/src/modules.ts does not exist but frontend-core is installed')
  }
}

// The @template/auth driver barrel (packages/auth/src/index.ts) was a
// runtime-registry artifact with no Encore analog; its generator was retired
// in spec 003 (auth-driver selection is configuration over the in-app drivers).

// --- Dependency graph (optional) ---
if (showGraph) {
  console.log('\n6. Module dependency graph (Mermaid):\n')
  console.log('```mermaid')
  console.log('graph TD')

  const modulesGraphDir = path.join(MODULES_ROOT, 'modules')
  const graphDirs = fs
    .readdirSync(modulesGraphDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)

  for (const dir of graphDirs) {
    const mp = path.join(modulesGraphDir, dir, 'manifest.json')
    if (!fs.existsSync(mp)) continue
    try {
      const raw = JSON.parse(fs.readFileSync(mp, 'utf-8'))
      const manifest = manifestSchema.parse(raw)
      const id = dir.replace(/-/g, '_')

      // Node label
      const installed = isModuleInstalled(state, dir)
      const marker = installed ? ':::installed' : ''
      console.log(`  ${id}["${dir}"]${marker}`)

      // requires edges
      for (const req of manifest.requires) {
        console.log(`  ${req.replace(/-/g, '_')} --> ${id}`)
      }

      // conflicts edges
      for (const conflict of manifest.conflicts) {
        console.log(`  ${id} -.-x ${conflict.replace(/-/g, '_')}`)
      }
    } catch { /* skip invalid */ }
  }

  console.log('  classDef installed fill:#d4edda,stroke:#28a745')
  console.log('```')
}

// --- Summary ---
console.log('\n' + '='.repeat(50))
if (errors > 0) {
  console.error(`\nValidation FAILED with ${errors} error(s)`)
  process.exit(1)
} else {
  console.log('\nAll checks passed!')
}

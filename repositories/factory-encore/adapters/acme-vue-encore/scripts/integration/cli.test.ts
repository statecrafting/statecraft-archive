/**
 * True CLI Integration Tests
 *
 * These tests spawn the actual add-module.ts, remove-module.ts, and
 * validate-modules.ts scripts as child processes against a real temporary
 * project directory. They test the complete CLI wiring — argument parsing,
 * step sequencing, file operations, and exit codes — not just the underlying
 * library functions.
 *
 * The auth-* / service-auth modules were retired in spec 003, so these tests
 * drive the surviving modules (security-core, api-gateway, data-redis). Those
 * cross-cutting modules were converted to thin declarative overlays in spec
 * 063 (no apps/api/src/** payloads): security-core / data-redis own no files
 * (they contribute env knobs only), and api-gateway carries the single file
 * payload among them — its frontend /connectivity view — so file-copy and
 * fileOwnership-mismatch coverage is driven through api-gateway. The Express
 * backend modules.ts regeneration and the conflict/requiresOneOf end-to-end
 * cases are gone: Encore discovers services from the filesystem (no backend
 * loader), and no surviving module declares conflicts/requiresOneOf (those
 * rules are covered at the library level in manifest.schema.test.ts).
 *
 * Flags used in every spawn:
 *   --yes         skip confirmation prompts
 *   --no-install  skip npm install / build (keeps tests fast)
 *   --root <dir>  target the sandbox instead of the template repo itself
 *
 * Each describe block gets its own fresh sandbox directory so test suites
 * are fully isolated. Sandboxes land in scripts/integration/sandbox/ (gitignored)
 * and are removed in afterAll — leave afterAll commented out temporarily if you
 * want to inspect the filesystem state after a run.
 */

import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { loadTemplateJson, isModuleInstalled } from '../lib/template-json.js'
import { createTempProjectDir, cleanTempDir, PROJECT_ROOT } from '../lib/__fixtures__/test-helpers.js'

// ─── Subprocess helper ────────────────────────────────────────────────

// Scripts are .ts; we run them through Node's own tsx loader (node --import
// tsx ...) so spawnSync executes the Node binary directly with no shell.

// Sandbox base: gitignored directory inside the repo so runs are inspectable
const SANDBOX_BASE = path.join(PROJECT_ROOT, 'scripts', 'integration', 'sandbox')

function createSandbox(label: string): string {
  const dir = path.join(SANDBOX_BASE, label)
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
  const tmp = createTempProjectDir()
  fs.cpSync(tmp, dir, { recursive: true })
  cleanTempDir(tmp)
  return dir
}

interface RunResult {
  exitCode: number
  stdout: string
  stderr: string
}

function runScript(scriptRelPath: string, args: string[]): RunResult {
  const scriptPath = path.join(PROJECT_ROOT, scriptRelPath)
  // Run the .ts entrypoint via Node's tsx loader with a direct argument vector
  // and no shell, so PROJECT_ROOT-derived paths are never parsed by cmd.exe.
  const cmdArgs = ['--import', 'tsx', scriptPath, ...args]
  const result = spawnSync(process.execPath, cmdArgs, {
    encoding: 'utf-8',
    timeout: 60_000,
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
  })

  // spawnSync sets status=null and error.code='ETIMEDOUT' on timeout.
  // Throw so Vitest names the failure clearly rather than showing a generic exit-1.
  const spawnErr = result.error as NodeJS.ErrnoException | undefined
  if (spawnErr?.code === 'ETIMEDOUT' || (result.status === null && result.signal != null)) {
    const preview = [result.stdout, result.stderr].filter(Boolean).join('\n').slice(0, 500)
    throw new Error(
      `Subprocess timed out after 60s — likely a blocking prompt or infinite loop\n` +
      `  cmd: ${[process.execPath, ...cmdArgs].join(' ')}\n` +
      `  output: ${preview || '(none)'}`,
    )
  }

  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function add(sandbox: string, moduleName: string, extraArgs: string[] = []): RunResult {
  return runScript('scripts/add-module.ts', [moduleName, '--yes', '--no-install', '--root', sandbox, ...extraArgs])
}

function remove(sandbox: string, moduleName: string, extraArgs: string[] = []): RunResult {
  return runScript('scripts/remove-module.ts', [moduleName, '--yes', '--no-install', '--root', sandbox, ...extraArgs])
}

function validate(sandbox: string): RunResult {
  return runScript('scripts/validate-modules.ts', ['--root', sandbox])
}

// ─── add-module.ts ────────────────────────────────────────────────────

describe('add-module.ts — happy path', () => {
  let sandbox: string

  beforeAll(() => {
    sandbox = createSandbox('add-happy')
  })

  afterAll(() => {
    cleanTempDir(sandbox)
  })

  it('exits 0 when module is installed successfully', () => {
    const result = add(sandbox, 'security-core')
    expect(result.exitCode).toBe(0)
  })

  it('copies a module payload to the project root (api-gateway frontend view)', () => {
    // security-core is a declarative overlay (no files); api-gateway carries the
    // only file payload among the converted modules: its /connectivity view.
    const result = add(sandbox, 'api-gateway') // auto-installs the security-core dep
    expect(result.exitCode).toBe(0)
    const state = loadTemplateJson(sandbox)
    const ownedFiles = Object.keys(state.fileOwnership).filter(
      (f) => state.fileOwnership[f] === 'api-gateway',
    )
    expect(ownedFiles.length).toBeGreaterThan(0)
    for (const f of ownedFiles) {
      expect(fs.existsSync(path.resolve(sandbox, f))).toBe(true)
    }
  })

  it('records the module in template.json', () => {
    const state = loadTemplateJson(sandbox)
    expect(isModuleInstalled(state, 'security-core')).toBe(true)
  })

  it('stdout contains success message', () => {
    // Re-run (already installed path) to capture fresh output
    const result = add(sandbox, 'security-core')
    expect(result.stdout).toContain('security-core')
  })
})

describe('add-module.ts — auto-dependency installation', () => {
  let sandbox: string

  beforeAll(() => {
    sandbox = createSandbox('add-auto-dep')
  })

  afterAll(() => {
    cleanTempDir(sandbox)
  })

  it('auto-installs the required dependency (security-core) before api-gateway', () => {
    const result = add(sandbox, 'api-gateway')
    expect(result.exitCode).toBe(0)
    const state = loadTemplateJson(sandbox)
    expect(isModuleInstalled(state, 'security-core')).toBe(true)
    expect(isModuleInstalled(state, 'api-gateway')).toBe(true)
  })
})

describe('add-module.ts — dry-run', () => {
  let sandbox: string

  beforeAll(() => {
    sandbox = createSandbox('add-dry-run')
  })

  afterAll(() => {
    cleanTempDir(sandbox)
  })

  it('exits 0 but makes no filesystem changes', () => {
    const stateBefore = JSON.stringify(loadTemplateJson(sandbox))

    const result = add(sandbox, 'security-core', ['--dry-run'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('dry-run')
    expect(JSON.stringify(loadTemplateJson(sandbox))).toBe(stateBefore)
  })
})

describe('add-module.ts — error cases', () => {
  let sandbox: string

  beforeAll(() => {
    sandbox = createSandbox('add-errors')
  })

  afterAll(() => {
    cleanTempDir(sandbox)
  })

  it('exits 1 for an unknown module name', () => {
    const result = add(sandbox, 'no-such-module')
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toMatch(/not found|Error/i)
  })

  it('exits 1 when no module name is provided', () => {
    const result = runScript('scripts/add-module.ts', ['--root', sandbox])
    expect(result.exitCode).toBe(1)
  })
})

describe('add-module.ts --list', () => {
  it('exits 0 and lists available modules', () => {
    const result = runScript('scripts/add-module.ts', ['--list'])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('user-management')
    expect(result.stdout).toContain('security-core')
  })
})

// ─── remove-module.ts ─────────────────────────────────────────────────

describe('remove-module.ts — happy path', () => {
  let sandbox: string

  beforeAll(() => {
    sandbox = createSandbox('remove-happy')
    add(sandbox, 'api-gateway') // brings security-core (dep); api-gateway owns the connectivity view
  })

  afterAll(() => {
    cleanTempDir(sandbox)
  })

  it('exits 0 when module is removed successfully', () => {
    const result = remove(sandbox, 'api-gateway')
    expect(result.exitCode).toBe(0)
  })

  it('deletes the module\'s owned files from disk', () => {
    add(sandbox, 'api-gateway') // re-install (the previous test removed it)
    const stateBefore = JSON.parse(fs.readFileSync(path.join(sandbox, 'template.json'), 'utf-8')) as {
      fileOwnership: Record<string, string>
    }
    const ownedByGateway = Object.entries(stateBefore.fileOwnership)
      .filter(([, owner]) => owner === 'api-gateway')
      .map(([f]) => f)
    expect(ownedByGateway.length).toBeGreaterThan(0)

    remove(sandbox, 'api-gateway')

    for (const f of ownedByGateway) {
      expect(fs.existsSync(path.resolve(sandbox, f))).toBe(false)
    }
  })

  it('removes the module from template.json', () => {
    // api-gateway already removed above; its security-core dependency remains
    const state = loadTemplateJson(sandbox)
    expect(isModuleInstalled(state, 'api-gateway')).toBe(false)
    expect(isModuleInstalled(state, 'security-core')).toBe(true)
  })
})

describe('remove-module.ts — error cases', () => {
  let sandbox: string

  beforeAll(() => {
    sandbox = createSandbox('remove-errors')
    add(sandbox, 'security-core')
    add(sandbox, 'api-gateway') // requires security-core
  })

  afterAll(() => {
    cleanTempDir(sandbox)
  })

  it('exits 1 when module is not installed', () => {
    const result = remove(sandbox, 'data-redis')
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toMatch(/not installed|Error/i)
  })

  it('exits 1 when a reverse dependency would break', () => {
    // api-gateway requires security-core; removing security-core should be blocked
    const result = remove(sandbox, 'security-core')
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('api-gateway')
  })

  it('exits 1 when no module name is provided', () => {
    const result = runScript('scripts/remove-module.ts', ['--root', sandbox])
    expect(result.exitCode).toBe(1)
  })
})

// ─── validate-modules.ts ─────────────────────────────────────────────

describe('validate-modules.ts', () => {
  let sandbox: string

  beforeAll(() => {
    sandbox = createSandbox('validate')
    add(sandbox, 'api-gateway') // brings security-core (dep) and owns the connectivity view
    add(sandbox, 'data-redis')
  })

  afterAll(() => {
    cleanTempDir(sandbox)
  })

  it('exits 0 after a clean install', () => {
    const result = validate(sandbox)
    expect(result.exitCode).toBe(0)
  })

  it('stdout reports all checks passed', () => {
    const result = validate(sandbox)
    expect(result.stdout).toContain('All checks passed!')
  })

  it('exits 1 after an owned file is manually deleted (fileOwnership mismatch)', () => {
    const state = loadTemplateJson(sandbox)
    // api-gateway owns the connectivity view (the converted modules' one file payload).
    const victimFile = Object.entries(state.fileOwnership)
      .find(([, owner]) => owner === 'api-gateway')
      ?.[0]
    expect(victimFile).toBeDefined()
    fs.unlinkSync(path.resolve(sandbox, victimFile!))

    const result = validate(sandbox)
    expect(result.exitCode).toBe(1)
    expect(result.stderr + result.stdout).toContain('does not exist on disk')
  })

  it('exits 1 with a malformed template.json', () => {
    // `{}` is valid (every field defaults); a truly invalid file is malformed
    // JSON, which loadTemplateJson rejects in Check 1.
    const brokenSandbox = createSandbox('validate-broken')
    fs.writeFileSync(path.join(brokenSandbox, 'template.json'), '{ "modules": ')
    const result = validate(brokenSandbox)
    expect(result.exitCode).toBe(1)
    cleanTempDir(brokenSandbox)
  })
})

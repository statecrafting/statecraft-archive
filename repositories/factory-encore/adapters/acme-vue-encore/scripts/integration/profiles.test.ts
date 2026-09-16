/**
 * Generator regression suites (create-time surface).
 *
 * The scaffold-feature.md, code-quality.md, and eslint.config.mjs regression
 * suites moved with the product (they govern the born-with dev harness, not the
 * generator); they live in template-encore. What stays here are the create-time
 * artifacts factory-encore owns: the FAC-S boundary half of validate.md, the
 * template orchestrator's feature-planning guidance, and the validate-modules
 * structural checks. The AUTH-007 obligation survives in Encore form and the
 * guards below assert the reconciled create-time docs still teach it.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, it, expect } from 'vitest'
import { PROJECT_ROOT } from '../lib/__fixtures__/test-helpers'

// --- AUTH-007 (Encore) regression: validate.md role-scoped data gate -------

describe('AUTH-007 (Encore) regression: validate.md role-scoped data gate', () => {
  const validateSrc = path.join(PROJECT_ROOT, 'orchestration', 'skills', 'validate.md')

  it('has an AUTH-007 role-scoped data verification check', () => {
    const content = fs.readFileSync(validateSrc, 'utf-8')
    expect(content).toContain('AUTH-007 Role-Scoped Data Verification')
  })

  it('marks an unscoped multi-role endpoint as a BLOCKER', () => {
    const content = fs.readFileSync(validateSrc, 'utf-8')
    const idx = content.indexOf('AUTH-007 Role-Scoped Data Verification')
    const section = content.slice(idx, idx + 2000)
    expect(section).toContain('BLOCKER')
  })

  it('checks for requireRole + service-layer role branching + a scoped query', () => {
    const content = fs.readFileSync(validateSrc, 'utf-8')
    const idx = content.indexOf('AUTH-007 Role-Scoped Data Verification')
    const section = content.slice(idx, idx + 2000)
    expect(section).toContain('requireRole')
    expect(section).toMatch(/roles\.includes\(/)
    expect(section).toMatch(/WHERE /)
  })
})

// --- validate-modules.ts source-level regression ---------------------------

describe('validate-modules.ts structural checks', () => {
  const validateModulesSrc = path.join(PROJECT_ROOT, 'scripts', 'validate-modules.ts')

  it('uses manifestSchema.parse() to validate each module manifest (not bare JSON.parse)', () => {
    const content = fs.readFileSync(validateModulesSrc, 'utf-8')
    expect(content).toContain('manifestSchema.parse(')
  })

  it('imports loadTemplateJson from ./lib/template-json', () => {
    const content = fs.readFileSync(validateModulesSrc, 'utf-8')
    expect(content).toMatch(/from ['"]\.\/lib\/template-json['"]/)
    expect(content).toContain('loadTemplateJson')
  })

  it('imports generateWebModulesTs for generated-file verification', () => {
    const content = fs.readFileSync(validateModulesSrc, 'utf-8')
    expect(content).toContain('generateWebModulesTs')
    expect(content).not.toContain('generateApiModulesTs')
  })

  it('no longer references the retired @template/auth barrel generator', () => {
    const content = fs.readFileSync(validateModulesSrc, 'utf-8')
    expect(content).not.toContain('generateAuthIndex')
  })

  it('calls process.exit(1) when errors are found', () => {
    const content = fs.readFileSync(validateModulesSrc, 'utf-8')
    expect(content).toContain('process.exit(1)')
  })

  it('checks fileOwnership to detect orphaned or missing file tracking', () => {
    const content = fs.readFileSync(validateModulesSrc, 'utf-8')
    expect(content).toContain('fileOwnership')
  })
})

// --- AUTH-007 (Encore) regression: template-orchestrator.md feature planning

describe('AUTH-007 (Encore) regression: template-orchestrator.md feature planning', () => {
  const orchSrc = path.join(PROJECT_ROOT, 'orchestration', 'template-orchestrator.md')

  it('retains the Feature Plan step', () => {
    const content = fs.readFileSync(orchSrc, 'utf-8')
    expect(content).toContain('Convert the Build Specification endpoints into a **Feature Plan**')
  })

  it('Feature Plan area flags AUTH-007 multi-role detection', () => {
    const content = fs.readFileSync(orchSrc, 'utf-8')
    const fpIdx = content.indexOf('Convert the Build Specification endpoints into a **Feature Plan**')
    expect(fpIdx).toBeGreaterThan(-1)
    const nearby = content.slice(fpIdx, fpIdx + 3000)
    expect(nearby).toContain('AUTH-007')
  })

  it('multi-role note references private- vs public-authenticated viewTypes', () => {
    const content = fs.readFileSync(orchSrc, 'utf-8')
    const idx = content.indexOf('multi-role access pattern detection (AUTH-007)')
    expect(idx).toBeGreaterThan(-1)
    const nearby = content.slice(idx, idx + 1500)
    expect(nearby).toContain('private-authenticated')
    expect(nearby).toMatch(/public-authenticated|public.*portal/)
  })

  it('requires requireRole with all roles + service-layer data scoping (Encore)', () => {
    const content = fs.readFileSync(orchSrc, 'utf-8')
    const idx = content.indexOf('multi-role access pattern detection (AUTH-007)')
    expect(idx).toBeGreaterThan(-1)
    const nearby = content.slice(idx, idx + 1500)
    expect(nearby).toContain('requireRole')
    expect(nearby).toMatch(/role-scoped data|scope.*query|scoped/i)
  })
})

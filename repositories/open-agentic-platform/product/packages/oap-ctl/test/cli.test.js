// Minimal smoke tests for oap-ctl. Runs with Node's built-in test runner
// (`node --test`), no external dependencies.
//
// Covers spec 110 §7 verification item: "oap-ctl run factory --help contract
// test" — the canonical help string must advertise the subcommand, its
// required flags, and its environment inputs so users can discover the
// dispatch path without reading the source.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CLI = join(__dirname, '..', 'src', 'cli.js')

function run(args, env = {}) {
  return spawnSync('node', [CLI, ...args], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  })
}

test('--help advertises the run factory subcommand', () => {
  const res = run(['--help'])
  assert.equal(res.status, 0)
  assert.match(res.stdout, /run factory <project-id>/)
  assert.match(res.stdout, /--adapter <name>/)
  assert.match(res.stdout, /--knowledge <object-id>/)
  assert.match(res.stdout, /--watch/)
})

test('--help documents statecraft env and lockfile fallbacks', () => {
  const res = run(['--help'])
  assert.equal(res.status, 0)
  assert.match(res.stdout, /statecraft_URL/)
  assert.match(res.stdout, /statecraft_TOKEN/)
  assert.match(res.stdout, /~\/\.oap\/statecraft\.url/)
  assert.match(res.stdout, /~\/\.oap\/statecraft\.token/)
})

test('run factory without project-id or adapter prints usage and exits 1', () => {
  const res = run(['run', 'factory'], { STATECRAFT_URL: '', STATECRAFT_TOKEN: '' })
  assert.equal(res.status, 1)
  assert.match(res.stderr, /Usage: oap-ctl run factory/)
})

test('run factory fails fast when statecraft URL is not resolvable', () => {
  // Force both env and lockfile absent: override HOME to an empty dir so
  // readFileSync on ~/.oap/statecraft.url never finds one.
  const res = run(
    ['run', 'factory', 'some-project-id', '--adapter', 'encore-react'],
    {
      STATECRAFT_URL: '',
      STATECRAFT_TOKEN: '',
      HOME: '/nonexistent-oap-home-for-tests',
    },
  )
  assert.equal(res.status, 1)
  assert.match(res.stderr, /statecraft URL not set/)
})

test('run factory fails when token is missing but URL is set', () => {
  const res = run(
    ['run', 'factory', 'some-project-id', '--adapter', 'encore-react'],
    {
      STATECRAFT_URL: 'http://localhost:4000',
      STATECRAFT_TOKEN: '',
      HOME: '/nonexistent-oap-home-for-tests',
    },
  )
  assert.equal(res.status, 1)
  assert.match(res.stderr, /statecraft token not set/)
})

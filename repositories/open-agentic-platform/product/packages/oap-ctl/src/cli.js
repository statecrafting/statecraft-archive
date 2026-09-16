#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0
/**
 * oap-ctl — remote control CLI for a running open-agentic-platform instance.
 *
 * Reads ~/.oap/control.port and ~/.oap/control.token, then calls the
 * control HTTP server exposed by the OAP desktop app.
 *
 * The `run factory` subcommand is the exception: it calls the statecraft
 * initPipeline endpoint directly so the web button and the CLI share a
 * single orchestration path (spec 110 §2.5).
 *
 * Usage:
 *   oap-ctl status
 *   oap-ctl projects
 *   oap-ctl sessions --project <id>
 *   oap-ctl messages --session <id> --project <project_id>
 *   oap-ctl send <prompt> --session <id> --project <project_id> [--model <m>]
 *   oap-ctl cancel --session <id>
 *   oap-ctl run factory <project-id> --adapter <name> [--knowledge <id>...] [--watch]
 *   oap-ctl --help
 */

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { request } from 'http'
import { request as httpsRequest } from 'https'
import { URL } from 'url'

const OAP_DIR = join(homedir(), '.oap')
const PORT_FILE = join(OAP_DIR, 'control.port')
const TOKEN_FILE = join(OAP_DIR, 'control.token')

// ---------------------------------------------------------------------------
// Lockfile helpers
// ---------------------------------------------------------------------------

function readLockfiles() {
  if (!existsSync(PORT_FILE)) {
    console.error('The OAP desktop app does not appear to be running.')
    console.error(`Expected lockfile: ${PORT_FILE}`)
    console.error('Start the desktop app first, then retry.')
    process.exit(1)
  }
  const portRaw = readFileSync(PORT_FILE, 'utf8').trim()
  const port = parseInt(portRaw, 10)
  if (isNaN(port) || port < 1 || port > 65535) {
    console.error(`Invalid port in ${PORT_FILE}: ${portRaw}`)
    process.exit(1)
  }
  const token = existsSync(TOKEN_FILE) ? readFileSync(TOKEN_FILE, 'utf8').trim() : ''
  return { port, token }
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

function httpRequest(port, token, method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body != null ? JSON.stringify(body) : null
    const opts = {
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: {
        'X-Control-Token': token,
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }
    const req = request(opts, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        if (res.statusCode === 401) {
          console.error('Authentication failed (stale token). Restart the desktop app and retry.')
          process.exit(1)
        }
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) })
        } catch {
          resolve({ status: res.statusCode, body: data })
        }
      })
    })
    req.on('error', (err) => {
      if (err.code === 'ECONNREFUSED') {
        console.error(`Connection refused on port ${port}. Is the OAP desktop app running?`)
        process.exit(1)
      }
      reject(err)
    })
    if (payload) req.write(payload)
    req.end()
  })
}

// ---------------------------------------------------------------------------
// Argument parser
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { flags: {}, positional: [] }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2)
      // Next element is the value unless it also starts with '--' or is missing.
      let value
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        value = argv[i + 1]
        i++
      } else {
        value = true
      }
      // Collect repeat occurrences (e.g. --knowledge a --knowledge b) into
      // an array. Single-occurrence flags stay scalar to preserve the shape
      // the existing subcommands depend on.
      if (Object.prototype.hasOwnProperty.call(args.flags, key)) {
        const prev = args.flags[key]
        args.flags[key] = Array.isArray(prev) ? [...prev, value] : [prev, value]
      } else {
        args.flags[key] = value
      }
    } else {
      args.positional.push(argv[i])
    }
  }
  return args
}

function asArray(val) {
  if (val === undefined || val === null || val === false) return []
  return Array.isArray(val) ? val : [val]
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function col(text, width) {
  const s = String(text ?? '')
  return s.length >= width ? s.slice(0, width - 1) + ' ' : s.padEnd(width)
}

function unwrap(res, label) {
  if (!res.body?.success) {
    const msg = res.body?.error ?? JSON.stringify(res.body)
    console.error(`${label} failed (HTTP ${res.status}): ${msg}`)
    process.exit(1)
  }
  return res.body.data
}

// ---------------------------------------------------------------------------
// Statecraft (run factory) helpers
// ---------------------------------------------------------------------------

const STATECRAFT_URL_FILE = join(OAP_DIR, 'statecraft.url')
const STATECRAFT_TOKEN_FILE = join(OAP_DIR, 'statecraft.token')

function resolveStatecraft() {
  const urlEnv = process.env.statecraft_URL
  const tokenEnv = process.env.statecraft_TOKEN
  const url = urlEnv && urlEnv.length > 0
    ? urlEnv
    : existsSync(STATECRAFT_URL_FILE)
      ? readFileSync(STATECRAFT_URL_FILE, 'utf8').trim()
      : ''
  const token = tokenEnv && tokenEnv.length > 0
    ? tokenEnv
    : existsSync(STATECRAFT_TOKEN_FILE)
      ? readFileSync(STATECRAFT_TOKEN_FILE, 'utf8').trim()
      : ''

  if (!url) {
    console.error('statecraft URL not set. Export STATECRAFT_URL or write it to ~/.oap/statecraft.url.')
    process.exit(1)
  }
  if (!token) {
    console.error('statecraft token not set. Export STATECRAFT_TOKEN or write it to ~/.oap/statecraft.token.')
    process.exit(1)
  }
  return { url: url.replace(/\/+$/, ''), token }
}

function statecraftPost(baseUrl, token, path, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(path, baseUrl)
    const isHttps = u.protocol === 'https:'
    const payload = JSON.stringify(body ?? {})
    const opts = {
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }
    const req = (isHttps ? httpsRequest : request)(opts, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        let parsed = data
        try { parsed = JSON.parse(data) } catch { /* not json */ }
        resolve({ status: res.statusCode ?? 0, body: parsed })
      })
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

function openStatecraftSse(baseUrl, token, path, onFrame, onClose) {
  const u = new URL(path, baseUrl)
  const isHttps = u.protocol === 'https:'
  const opts = {
    hostname: u.hostname,
    port: u.port || (isHttps ? 443 : 80),
    path: u.pathname + u.search,
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'text/event-stream',
    },
  }
  const req = (isHttps ? httpsRequest : request)(opts, (res) => {
    if (res.statusCode !== 200) {
      let body = ''
      res.on('data', (c) => { body += c })
      res.on('end', () => onClose(new Error(`SSE open failed (HTTP ${res.statusCode}): ${body}`)))
      return
    }
    res.setEncoding('utf8')
    // SSE frames are delimited by a blank line; buffer until we see one.
    let buffer = ''
    res.on('data', (chunk) => {
      buffer += chunk
      let idx
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        const frame = parseSseFrame(raw)
        if (frame) onFrame(frame)
      }
    })
    res.on('end', () => onClose(null))
    res.on('error', (err) => onClose(err))
  })
  req.on('error', (err) => onClose(err))
  req.end()
  return req
}

function parseSseFrame(raw) {
  if (!raw || raw.startsWith(':')) return null
  let event = 'message'
  let dataLines = []
  let id
  for (const line of raw.split('\n')) {
    if (line.startsWith(':')) continue
    if (line.startsWith('event:')) {
      event = line.slice(6).trim()
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^ /, ''))
    } else if (line.startsWith('id:')) {
      id = line.slice(3).trim()
    }
  }
  const dataStr = dataLines.join('\n')
  let data = dataStr
  try { data = JSON.parse(dataStr) } catch { /* leave as string */ }
  return { event, id, data }
}

async function watchFactoryStream(baseUrl, token, projectId) {
  return new Promise((resolve, reject) => {
    const req = openStatecraftSse(
      baseUrl,
      token,
      `/api/projects/${encodeURIComponent(projectId)}/factory/stream`,
      (frame) => {
        if (frame.event === 'snapshot') {
          const s = frame.data ?? {}
          console.log(`[snapshot] pipeline=${s.pipeline_id ?? '(none)'} status=${s.status ?? '(none)'} stage=${s.current_stage ?? '—'}`)
        } else if (frame.event === 'pipeline_event') {
          const d = frame.data ?? {}
          const parts = [
            `event=${d.event_type ?? '?'}`,
            d.stage_id ? `stage=${d.stage_id}` : null,
            d.actor ? `actor=${d.actor}` : null,
          ].filter(Boolean).join(' ')
          console.log(`[event] ${parts}`)
        } else if (frame.event === 'closed') {
          const reason = (frame.data && frame.data.reason) || 'closed'
          console.log(`[closed] ${reason}`)
          // The server will end the response; resolve in onClose.
        } else if (frame.event === 'error') {
          const msg = (frame.data && frame.data.message) || 'error'
          console.error(`[error] ${msg}`)
        }
      },
      (err) => {
        if (err) reject(err)
        else resolve()
      },
    )
    // Forward SIGINT so Ctrl-C cleanly closes the stream.
    const onSigint = () => {
      try { req.destroy() } catch { /* ignore */ }
    }
    process.once('SIGINT', onSigint)
  })
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

const HELP = `oap-ctl — remote control a running open-agentic-platform instance

Commands:
  status                                     Show server status and version
  projects                                   List all projects
  sessions --project <id>                    List sessions for a project
  messages --session <id> --project <id>     Show messages for a session
  send <prompt> --session <id> \\
               --project <id>               Send a prompt to a session (queued for execution)
  cancel --session <id>                      Cancel a running session
  run factory <project-id> \\
      --adapter <name> \\
      [--knowledge <object-id>]... \\
      [--watch]                              Trigger a Factory pipeline run on statecraft
                                             (the request is dispatched to a connected
                                             OPC over the duplex channel). --watch
                                             subscribes to the project SSE stream and
                                             prints stage transitions until terminal.
  --help, -h                                 Show this help

Environment:
  ~/.oap/control.port       Port written by the desktop app at startup
  ~/.oap/control.token      Auth token written by the desktop app at startup
  STATECRAFT_URL            Required by 'run factory' (e.g. https://statecraft.example)
  STATECRAFT_TOKEN          Bearer token used by 'run factory'
  ~/.oap/statecraft.url     Fallback when STATECRAFT_URL is unset
  ~/.oap/statecraft.token   Fallback when STATECRAFT_TOKEN is unset

Examples:
  oap-ctl status
  oap-ctl projects
  oap-ctl sessions --project my-project-id
  oap-ctl messages --session abc123 --project my-project-id
  oap-ctl run factory my-project-id --adapter encore-react --watch
  oap-ctl run factory my-project-id --adapter next-prisma \\
      --knowledge ko_123 --knowledge ko_456 --watch`

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2)
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    console.log(HELP)
    process.exit(0)
  }

  const cmd = argv[0]
  const args = parseArgs(argv.slice(1))

  // ---- run factory <project-id> ----
  // Short-circuits before readLockfiles(): this subcommand talks to
  // statecraft, not to the local OPC control server, so the absence of a
  // running desktop app must not block it (spec 110 §2.5).
  if (cmd === 'run' && args.positional[0] === 'factory') {
    const projectId = args.positional[1]
    const adapter = args.flags.adapter
    const knowledge = asArray(args.flags.knowledge)
    const watch = args.flags.watch === true || args.flags.watch === 'true'

    if (!projectId || typeof projectId !== 'string' || !adapter || typeof adapter !== 'string') {
      console.error('Usage: oap-ctl run factory <project-id> --adapter <name> [--knowledge <id>]... [--watch]')
      process.exit(1)
    }

    const { url, token: sToken } = resolveStatecraft()
    const initRes = await statecraftPost(
      url,
      sToken,
      `/api/projects/${encodeURIComponent(projectId)}/factory/init`,
      {
        adapter,
        knowledge_object_ids: knowledge,
        source: 'statecraft',
      },
    )

    if (initRes.status < 200 || initRes.status >= 300) {
      const body = typeof initRes.body === 'string' ? initRes.body : JSON.stringify(initRes.body)
      console.error(`initPipeline failed (HTTP ${initRes.status}): ${body}`)
      process.exit(1)
    }

    const data = initRes.body ?? {}
    console.log(`pipeline_id:     ${data.pipeline_id}`)
    console.log(`adapter:         ${data.adapter}`)
    console.log(`policy_bundle:   ${data.policy_bundle_id}`)
    console.log(`source:          ${data.source}`)
    console.log(`status:          ${data.status}`)

    if (watch) {
      console.log('watching...')
      try {
        await watchFactoryStream(url, sToken, projectId)
      } catch (err) {
        console.error(`stream error: ${err.message ?? err}`)
        process.exit(1)
      }
    }
    return
  }

  const { port, token } = readLockfiles()

  // ---- status ----
  if (cmd === 'status') {
    const res = await httpRequest(port, token, 'GET', '/control/status', null)
    const data = unwrap(res, 'status')
    console.log(`status:   ${data.status}`)
    console.log(`version:  ${data.version}`)
    console.log(`port:     ${port}`)
    return
  }

  // ---- projects ----
  if (cmd === 'projects') {
    const res = await httpRequest(port, token, 'GET', '/control/projects', null)
    const projects = unwrap(res, 'projects')
    if (!projects || projects.length === 0) {
      console.log('No projects found.')
      return
    }
    console.log(`${col('ID', 36)}  ${col('NAME', 32)}  PATH`)
    console.log('-'.repeat(100))
    for (const p of projects) {
      console.log(`${col(p.id, 36)}  ${col(p.name, 32)}  ${p.path ?? ''}`)
    }
    return
  }

  // ---- sessions ----
  if (cmd === 'sessions') {
    const projectId = args.flags.project
    if (!projectId) {
      console.error('Usage: oap-ctl sessions --project <id>')
      process.exit(1)
    }
    const res = await httpRequest(
      port, token, 'GET',
      `/control/projects/${encodeURIComponent(projectId)}/sessions`,
      null,
    )
    const sessions = unwrap(res, 'sessions')
    if (!sessions || sessions.length === 0) {
      console.log('No sessions found for this project.')
      return
    }
    console.log(`${col('ID', 36)}  ${col('MODEL', 28)}  LAST ACTIVITY`)
    console.log('-'.repeat(90))
    for (const s of sessions) {
      const ts = s.last_message_at
        ? new Date(s.last_message_at).toLocaleString()
        : '—'
      console.log(`${col(s.id, 36)}  ${col(s.model ?? '—', 28)}  ${ts}`)
    }
    return
  }

  // ---- messages ----
  if (cmd === 'messages') {
    const sessionId = args.flags.session
    const projectId = args.flags.project
    if (!sessionId || !projectId) {
      console.error('Usage: oap-ctl messages --session <id> --project <id>')
      process.exit(1)
    }
    const res = await httpRequest(
      port, token, 'GET',
      `/control/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(projectId)}`,
      null,
    )
    const history = unwrap(res, 'messages')
    if (!Array.isArray(history) || history.length === 0) {
      console.log('No messages found.')
      return
    }
    for (const msg of history) {
      // history entries are raw JSON from the JSONL file
      const role = (msg.type === 'human' ? 'user' : msg.type ?? 'unknown').padEnd(9)
      let text = ''
      if (typeof msg.message?.content === 'string') {
        text = msg.message.content
      } else if (Array.isArray(msg.message?.content)) {
        text = msg.message.content
          .filter((b) => b.type === 'text')
          .map((b) => b.text ?? '')
          .join('')
      } else if (typeof msg.content === 'string') {
        text = msg.content
      }
      console.log(`[${role}] ${text.slice(0, 140).replace(/\n/g, ' ')}`)
    }
    return
  }

  // ---- send ----
  if (cmd === 'send') {
    const sessionId = args.flags.session
    const projectId = args.flags.project
    const prompt = args.positional[0]
    if (!sessionId || !projectId || !prompt) {
      console.error('Usage: oap-ctl send <prompt> --session <id> --project <id>')
      process.exit(1)
    }
    const res = await httpRequest(
      port, token, 'POST',
      `/control/sessions/${encodeURIComponent(sessionId)}/messages`,
      { prompt, project_id: projectId },
    )
    const data = unwrap(res, 'send')
    console.log(JSON.stringify(data, null, 2))
    return
  }

  // ---- cancel ----
  if (cmd === 'cancel') {
    const sessionId = args.flags.session
    if (!sessionId) {
      console.error('Usage: oap-ctl cancel --session <id>')
      process.exit(1)
    }
    const res = await httpRequest(
      port, token, 'DELETE',
      `/control/sessions/${encodeURIComponent(sessionId)}`,
      null,
    )
    const data = unwrap(res, 'cancel')
    console.log(JSON.stringify(data, null, 2))
    return
  }

  console.error(`Unknown command: ${cmd}`)
  console.error('Run oap-ctl --help for usage.')
  process.exit(1)
}

main().catch((err) => {
  console.error('Fatal:', err.message ?? err)
  process.exit(1)
})

---
id: "128-api-origin-guard"
title: "The origin guard: the daemon answers its own page and its own clients, and never serves a credential"
status: approved
created: "2026-09-11"
implementation: in-progress
risk: medium
depends_on:
  - "022-http-api-and-events"
  - "027-api-projects"
  - "121-candidate-and-receipt"
  - "031-journal-export"
establishes:
  - "members/src/orchestrator/api/origin-guard.ts"
  - "members/src/orchestrator/api/origin-guard.test.ts"
extends:
  # 022 owns the API directory: the guard runs first in the router, and the
  # envelope's error vocabulary gains `forbidden` (additive; no shape changes).
  - { spec: "022-http-api-and-events", unit: "members/src/orchestrator/api/server.ts", nature: additive }
  - { spec: "022-http-api-and-events", unit: "members/src/orchestrator/api/types.ts", nature: additive }
  - { spec: "022-http-api-and-events", unit: "members/src/orchestrator/api/server.test.ts", nature: additive }
  # The API view reduces userinfo in historical values it serves (B-8).
  - { spec: "022-http-api-and-events", unit: "members/src/orchestrator/api/state.ts", nature: additive }
  # The event pump streams and replays record payloads, which are served
  # historical values too (D-11).
  - { spec: "022-http-api-and-events", unit: "members/src/orchestrator/api/events.ts", nature: additive }
  # 030's route test posts to its GET-only route; the post gains the version
  # header so the route, not the guard, is what it tests (B-10).
  - { spec: "030-run-economics", unit: "members/src/orchestrator/economics.test.ts", nature: additive }
  # 113's parity suite holds the two exports to one byte stream; it gains the
  # policy-6 case (FR-006).
  - { spec: "113-journal-port", unit: "members/src/members/journal-parity.test.ts", nature: additive }
  # 024's web fixtures build an ApiMeta by hand, which gains `guardRefusals`.
  - { spec: "024-web-ui", unit: "members/web/test/fixtures.ts", nature: additive }
  - { spec: "024-web-ui", unit: "members/web/test/store.test.tsx", nature: additive }
  # 123's policy module computed a path at load, which stopped the built UI
  # from rendering at all; §5's browser round needs the page to load (D-15).
  - { spec: "123-policy-kit-handoff", unit: "members/src/orchestrator/lifecycle-policy.ts", nature: additive }
  # 121 owns the candidate, where the origin URL is read before it is
  # journaled in a receipt or served as a project's origin.
  - { spec: "121-candidate-and-receipt", unit: "members/src/orchestrator/candidate.ts", nature: additive }
  - { spec: "121-candidate-and-receipt", unit: "members/src/orchestrator/candidate.test.ts", nature: additive }
  # 025 owns the project probe, which reads the origin a second time and
  # journals it in a qualification check's detail.
  - { spec: "025-project-registry", unit: "members/src/orchestrator/projects.ts", nature: additive }
  - { spec: "025-project-registry", unit: "members/src/orchestrator/projects.test.ts", nature: additive }
  # 024 owns the web UI, whose dev server proxies the API (B-9).
  - { spec: "024-web-ui", unit: "members/web/vite.config.ts", nature: additive }
  # 031 owns the export policy; the value scan learns credential-shaped URLs
  # and the policy moves to version 6.
  - { spec: "031-journal-export", unit: "members/src/orchestrator/export.ts", nature: additive }
  - { spec: "031-journal-export", unit: "members/src/orchestrator/export.test.ts", nature: additive }
  # 113 owns the Rust journal crate, which carries the policy's second copy;
  # parity is byte-for-byte (039 FR-003), so the bump lands on both or neither.
  - { spec: "113-journal-port", unit: { kind: directory, path: "crates/statecraft-journal/" }, nature: additive }
  # Doc 05 is the record this spec is born from (D58, D59).
  - { spec: "110-corpus-merge", unit: { kind: directory, path: "docs/design/" }, nature: additive }
references:
  - { unit: { kind: file, path: "docs/design/05-the-realignment-checked.md" }, role: context }
summary: >
  The daemon binds loopback because it has no auth layer (022), and loopback
  keeps other machines out. It does not keep out a web page open in the
  operator's own browser: the API checks neither Origin nor Host, the version
  header is optional, and a text/plain body is parsed as JSON, so any page can
  send a preflight-free POST that arms a project, changes its posture or gate,
  or approves a human gate, and a DNS-rebinding page can read every answer.
  Measured on 2026-09-11, a foreign-origin POST disarmed a fixture project. This
  spec refuses, before any route runs, a request whose Host is not a loopback
  name at the bound port or whose Origin is not the daemon's own, and requires
  on every state-changing request a header a cross-origin page cannot send
  without a preflight the server never grants. It also stops a credential in
  the origin remote URL from being journaled, served or exported, which was
  measured passing through a minted receipt and the export policy, and on
  2026-09-12 through a second copy of the lookup into the daemon's project
  registry. A credential already chained is never rewritten: the export
  withholds it and the API reduces it where it serves it. The daemon's own
  page, the engine CLI and the Vite dev UI keep working.
---

# 128: The origin guard

## 1. Purpose

Spec 022 made loopback the trust boundary: "no auth in v1 (loopback trust),
designed so an auth layer slots in front without shape changes." The
reasoning holds for processes. It does not hold for a browser, because a
browser on the operator's machine will send a request to `127.0.0.1` on
behalf of any page the operator has open.

Three facts in `server.ts` make that request effective:

- nothing reads `Origin` or `Host`;
- `X-Api-Version` is checked only when present (`versionMismatch`);
- `readJsonBody` parses the body whatever its `Content-Type`.

A POST with a `text/plain` body and no custom header is a CORS "simple
request", which a browser sends without asking the server first. The page
cannot read the answer; the effect still happens. Measured on 2026-09-11
against a real server built from the API test fixtures: a POST to
`/api/projects/alpha/disarm` with `Origin: https://attacker.example` and
`Content-Type: text/plain` returned 200 and journaled `project.disarmed`. A
GET with a foreign `Host`, the shape a DNS-rebinding page produces once its
name resolves to `127.0.0.1`, returned 200, and a rebinding page is
same-origin with itself, so it reads what it gets.

Every control 027 and 021 expose is reachable that way: registering a path,
arming, the execution profile, the gate contract, the lifecycle policy, the
cost ceiling, `approve` and `force-human-gate`. Some browsers now ask before
letting a public page reach a local address. That is a browser's policy, not
this server's, and the daemon is not allowed to depend on it.

The second half is smaller and was found the same day. `originUrl` returns
`git remote get-url origin` verbatim, and a remote of the common CI shape
`https://x-access-token:<token>@github.com/...` puts the token into every
receipt's `repo.origin` and into the API's project view. The export passes it
(measured: `withheldFields: []`), because `origin` is not a stripped field and
the value is not a path. Worse, the handoff capsule (123) renders the same
string into every remediation prompt (`stages/build.ts:1122-1126`,
`handoff.ts:172`), so the token is sent to the model provider. A journal is
hash-chained, so a token that reaches one stays there.

Both halves were measured again on 2026-09-12 at `874766b` (doc 05 §18.1,
§18.2), and the second check widened each. `Origin: null` and an origin on
another loopback port (`http://localhost:5173`) change state exactly as a
foreign one does, and the rebinding-shaped read returns every project's
`repoDir`. The project probe has its own `originUrl` (`projects.ts:716-720`)
whose value becomes the detail `origin is <url>` of a qualification check,
journaled in `project.registered` and `project.requalified` in the daemon's
projects chain and served by the API (`api/state.ts:492`); measured, the
token is in that chain's bytes. And the guard as first drafted would refuse
the Vite dev UI, whose proxy forwards the dev server's `Host` and `Origin`
(`web/vite.config.ts:30-34`).

This spec is not an auth layer, and it is not a step toward binding anywhere
but loopback. It makes loopback trust mean what 022 meant by it.

## 2. Territory

- `members/src/orchestrator/api/origin-guard.ts`: the admission check, a pure
  function of the request's method and headers and the server's bound
  address.
- `members/src/orchestrator/api/origin-guard.test.ts`: its table.
- `members/src/orchestrator/api/server.ts` (extends 022): the guard runs first
  in `route`, before the version check, the `authorize` seam and every route,
  static assets included.
- `members/src/orchestrator/api/types.ts` (extends 022): `forbidden` joins the
  error kinds, answered as 403.
- `members/src/orchestrator/candidate.ts` (extends 121): `originUrl` returns the
  URL without userinfo, through the one exported reduction B-6 defines.
- `members/src/orchestrator/projects.ts` (extends 025): the probe's
  `originUrl` uses the same reduction.
- `members/src/orchestrator/api/state.ts` (extends 022): historical values are
  reduced where they are served (B-8).
- `members/src/orchestrator/export.ts` (extends 031) and the Rust journal crate
  (extends 113): the value scan withholds a string that contains a URL with
  userinfo, and the policy moves to version 6 on both sides.
- `members/web/vite.config.ts` (extends 024): the dev proxy (B-9).

## 3. Behavior

### B-1. Host names the daemon

The guard admits a request only when its `Host` header is one of
`127.0.0.1:<port>`, `localhost:<port>` or `[::1]:<port>`, where `<port>` is the
port the server actually bound. A missing `Host` is refused. This is the whole
defense against DNS rebinding: the rebinding page's requests carry its own
name, and no name but a loopback one is served.

### B-2. Origin, when present, is the daemon's own

A request that carries `Origin` is admitted only when the value is
`http://127.0.0.1:<port>`, `http://localhost:<port>` or `http://[::1]:<port>`.
`Origin: null` (a sandboxed frame, a `file:` page) is refused. A request with
no `Origin` is admitted: the CLI's client and `curl` send none, and a browser
sends one on every cross-origin request that could change state.

### B-3. A state-changing request carries a header a page cannot forge quietly

Every method other than `GET` and `HEAD` must carry `X-Api-Version`. Both
first-party clients already send it on every request (`api-client.ts`, which
the web UI reuses). A custom header makes any cross-origin browser request a
preflighted one, and B-4 guarantees the preflight fails. This is defense in
depth behind B-2, for a client that omits `Origin`.

### B-4. The server never grants cross-origin access

No response carries an `Access-Control-Allow-*` header, and an `OPTIONS`
request is answered by the guard with `forbidden` rather than routed. The
server serves exactly one origin, which is 024's same-origin design as
`static.ts` states it: "one origin, no CORS, no second port".

### B-5. A refusal is the envelope, and says which rule

A refused request is answered `{ ok: false, error: { kind: "forbidden",
message } }` with status 403, the message naming the rule (`host`, `origin`,
`header` or `preflight`) and the value it saw. Refusals are not journaled: a
hostile page could otherwise write to the journal at will. They are counted,
and `/api/meta` reports the count since start.

### B-6. The origin URL loses its userinfo before anyone reads it

`originUrl` parses an `http` or `https` remote and returns it with the whole
userinfo removed (user and password alike, because a token can sit in either),
so a receipt, the capsule (and with it every remediation prompt) and the API
all carry `https://github.com/...`. The reduction is one exported function,
and both lookups of the origin use it: `candidate.ts`'s, and the project
probe's in `projects.ts`, so a registration or requalification journals `origin
is https://github.com/...`. An `ssh://` or scp-style remote
(`git@github.com:org/repo.git`) and a local path are returned unchanged: an
SSH user part is not a secret, and 031 already withholds a private path on
export. A remote that names `http` or `https` but does not parse as a URL is
returned as `null`, never guessed.

### B-7. The export withholds a credential-shaped URL it did not mint

The export's value scan treats a string that contains an `http` or `https` URL
with userinfo the way it treats a private path: the leaf field holding it is
stripped and named in `withheldFields` (for a receipt, `origin`, which is the
key the scan removes; it does not name the enclosing `repo`). Containing, not
only being: a gate command in a receipt's suite whose argument embeds a
token-bearing URL is withheld the same way. (Output tails are already stripped
by name.) A receipt minted before B-6, whose bytes stay in the journal
unchanged, therefore exports as redacted rather than leaking. The redaction
policy moves to version 6 on the TypeScript and Rust sides in the same change,
and a version-6 bundle verifies under both.

### B-8. Historical values are reduced where they are served, never rewritten

The projects chain is never exported, but the API serves what it holds. Where
the API serves a value read from an existing record (a qualification check's
`detail`, a receipt's `repo.origin`, the capsule's origin), it applies B-6's
reduction to any `http` or `https` URL with userinfo inside that string. The
journal's bytes are not touched, no record is appended, and a verifier of the
chain sees what was written. A requalification after this spec journals the
reduced detail going forward.

### B-9. The dev UI reaches the guard as the daemon's own page

`web/vite.config.ts` proxies `/api` with `changeOrigin: true`, so the daemon
sees its own `Host`, and rewrites `Origin` to the daemon's own origin only
when the incoming `Origin` is exactly the dev server's own. A request that
reaches the dev server from any other origin is forwarded with its `Origin`
unchanged, and B-2 refuses it. The daemon carries no development exception.

### B-10. Who must keep working

| Client | What it sends | Under the guard |
|---|---|---|
| The daemon's own page | the typed client (`api-client.ts`): `X-Api-Version` on every request; its own `Origin` | admitted, when opened at a loopback name and the bound port |
| Its event stream and evidence links | GETs, no custom header | admitted (B-3 applies to state changes only) |
| The engine CLI | the typed client, no `Origin`, `Host` from `--url` | admitted |
| `curl` | no `Origin`; a POST needs `-H 'X-Api-Version: 2'` | admitted with the header (D-2) |
| The Vite dev UI | proxied through B-9 | admitted |
| The umbrella, the Rust drivers and sensors | nothing: none speaks HTTP to the daemon | not a client |

The API tests' raw non-GET requests (37 at `874766b`, most without the
version header) gain it where they lack it; the typed client's tests change
nothing.

## 4. Functional requirements

- **FR-001.** Guard table (`origin-guard.test.ts`): each B-1 to B-4 rule
  admits and refuses the cases named there, at a port other than the default,
  for IPv4, `localhost` and IPv6.
- **FR-002.** Over real HTTP (`server.test.ts`): a foreign-origin
  `text/plain` POST to a control route is refused with 403 and journals
  nothing; so are the same POST with `Origin: null` and with an origin on
  another loopback port; a foreign `Host` GET is refused; the same POST with
  no `Origin` and with `X-Api-Version` is applied; the typed client passes
  every existing route test unchanged.
- **FR-003.** No response in the server suite carries an
  `Access-Control-Allow-*` header.
- **FR-004.** `/api/meta` reports the refusal count, and a refusal appends no
  journal record.
- **FR-005.** `originUrl` over a temporary repository: an `https` remote with a
  token user, with `user:password`, and without userinfo all return the bare
  URL; an scp-style remote is unchanged.
- **FR-006.** Export: a receipt payload whose `repo.origin` carries userinfo
  exports with `origin` named in `withheldFields` and without the token
  anywhere in the serialized bundle; a receipt whose suite holds a command
  argument embedding a token-bearing URL is withheld the same way; the journal file's bytes are
  identical before and after the export; the TypeScript and Rust exports of
  the same chains are byte-identical at policy version 6.
- **FR-007.** The project probe over a temporary repository with a
  token-bearing `https` origin journals a registration whose `origin-remote`
  detail carries the bare URL, and the token appears nowhere in the projects
  chain's bytes.
- **FR-008.** Historical values: a projects chain and a work chain written
  before this spec (a registration detail and a receipt carrying a token) are
  served by the API without the token, and both chains' bytes and hashes are
  unchanged afterwards.
- **FR-009.** The dev proxy (a function the Vite config exports and a unit
  test drives): a proxied request whose `Origin` is the dev server's own
  reaches the daemon with the daemon's `Host` and `Origin`; one carrying any
  other `Origin` keeps it.

## 5. Acceptance

- `bun test` in `members/` is green; `cargo test -p statecraft-journal` is
  green; `make gate` exits 0.
- A live round in a real browser: the daemon's own UI loads and a control
  applied from it is journaled, and a page served from another loopback port
  that posts to the same control is refused, with the refusal count on
  `/api/meta` incremented and no journal record.
- The same round through `bun run web:dev`: the dev UI loads and a control
  applied from it is journaled.
- The committed evidence bundle and every bundle 132 fixes still verify.

## Verification

```sh
cd members && bun test src/orchestrator/api/origin-guard.test.ts
cd members && bun test src/orchestrator/api/server.test.ts
cd members && bun test src/orchestrator/candidate.test.ts
cd members && bun test src/orchestrator/projects.test.ts
cd members && bun test src/orchestrator/export.test.ts
cargo test -p statecraft-journal
make gate
```

## 6. Out of scope

- **An auth layer.** 022's `authorize` seam stays unwired. The guard answers
  "which page and which name", not "which person".
- **Binding anything but loopback.** Unchanged, and this spec is no argument
  for changing it.
- **What the API serves to a local reader.** Gate output tails and session
  evidence are served as they are to same-origin clients, which after this
  spec means local processes and the daemon's own page.
- **The umbrella's token paste.** `statecraft login` echoes a pasted token on
  a terminal, a deliberate v1 deferral recorded in `auth.rs`; doc 05 D72
  replaces the paste altogether.
- **Rewriting a journal.** A credential already chained stays in its record;
  B-7 keeps it out of every export instead.

## 7. Resolved decisions

D-1 (2026-09-11). Refuse by name and port, not by resolving. B-1 compares the
`Host` header's text with the three loopback names at the bound port, and never
resolves a name. Resolution is what a rebinding attack controls, so it cannot
be part of the defense.

D-2 (2026-09-11). `X-Api-Version` on every state-changing request, not
`Content-Type: application/json`. Both make a cross-origin request preflighted,
but the first-party client sends no body, and therefore no content type, on
controls such as `pause`; it sends the version header on every request. The
cost is that a raw `curl -X POST` now needs `-H 'X-Api-Version: 2'`, and the
refusal message says so.

D-3 (2026-09-11). `forbidden` is a new kind, not `bad-request`. The envelope's
`kind` is the token a client branches on (022 B-2), and "this request was
well-formed and is not allowed from where it came" is a different branch from
"this request was malformed". The addition is additive: no existing kind
changes meaning.

D-4 (2026-09-11). Refusals are counted, not journaled. A journal record per
refusal would hand the thing being refused a way to write to the journal.

D-5 (2026-09-11). Userinfo is dropped whole, not just the password. GitHub
accepts a token as the user part of an `https` URL with no password at all.

D-6 (2026-09-12; adopted by the owner the same day, D-9). The dev UI is admitted by the
proxy, not by the daemon (B-9). The alternative is a daemon flag admitting one
extra origin, off by default. The proxy is recommended because the daemon then
has one rule in every mode and no flag an operator can leave on. Its limit is
stated: requests that reach the daemon through the dev proxy carry the
daemon's `Host`, so in dev mode the rebinding defense is Vite's own host check
(`server.allowedHosts`), not B-1. Dev mode is a contributor's tool, never how
the product is run. Doc 05 D79.

D-7 (2026-09-12). Reduce where served, never rewrite (B-8). A journal is
hash-chained and its verification is its value; rewriting a record to remove a
token would break every later link and every exported bundle that named it.
The token stays in the operator's own files, and leaves them through no
interface this repository provides. Doc 05 D78.

D-8 (2026-09-12). The export scan looks for a URL with userinfo inside a
string, not only a string that is one. The registration detail (`origin is
<url>`) puts a token-bearing URL inside prose, and a gate command can embed
one in an argument (`git ls-remote https://user:token@host/...`); a scan that
matched only whole values would pass both. Doc 05 D78.

D-9 (2026-09-12, the owner). Approved by the adoption of revision 4's CLI-01
(doc 05 §19): this spec is built first, the dev proxy of B-9 is kept (D-6),
both origin lookups use the one reduction (B-6), and historical values are
redacted where served without rewriting a journal (B-8, D-7). The attack
probes that measured F1, F3 and F9 are promoted into regression tests, each
written as the request or remote that was measured, so a test asserts the
refusal or the absence where the probe saw success: FR-002 carries the
foreign-origin, `Origin: null`, other-loopback-port and rebinding requests;
FR-006 to FR-008 carry the token-bearing origin through a receipt, the
export, the projects chain and a served historical record.

D-10 (2026-09-12, build). At port 80 a `Host` without a port is the same
authority. B-1 names `<name>:<port>`, and an HTTP client omits the port when
it is the scheme's default (RFC 9110 §7.2), so a strict reading would refuse
a browser addressing a daemon bound at 80. The guard admits the bare three
names, and the matching bare origins, only at port 80; at any other port a
portless `Host` is refused. This adds no name and resolves nothing, so D-1
stands.

D-11 (2026-09-12, build). B-8's reduction runs at the two places the API
serializes, not field by field. Every JSON envelope (`ok` and `fail`) leaves
through `servedJsonText`, and the event pump reduces a record's payload before
the ring buffers it, so a stream and its replay carry the same reduced value.
Per-field reduction was rejected: B-8 lists a check detail, a receipt's
origin and the capsule's, but the history, run, decisions and evidence views
and the stream can all carry a record's strings, and a list of fields is the
kind that is one route short. The cost is one text test per envelope, and a
second serialization only when that test matches. Raw evidence bytes and
static assets are not envelopes and are served as they are (§6). The pump's
module, `events.ts`, is 022's and gains an `extends` edge.

D-12 (2026-09-12, build). The reduction is exported from `candidate.ts`
(`reduceRemoteUrl`, `containsUrlUserinfo`, `withoutUrlUserinfo`) and used by
both origin lookups, the export scan and the API. Its pattern spells the
scheme letter by letter and whitespace as its six ASCII bytes, so the Rust
copy in `statecraft-journal` matches exactly the same strings: `(?i)` and
`\s` are not the same set in the two regex engines, and FR-006's byte-for-byte
parity would otherwise depend on which strings a chain happens to hold. A
remote that names `http` or `https` and does not parse is `null` (B-6), which
the probe's check reports as `no "origin" remote`; the probe's interface has
one null, and telling "unparseable" apart would widen it for a remote git
itself would not use.

D-13 (2026-09-12, build). The server suite's request helper adds
`X-Api-Version` to a non-GET request that lacks it, which is B-10's "gain it"
in one place rather than at 36 call sites, and asserts on every response that
no `Access-Control-Allow-*` header is present, which is FR-003 for the whole
suite. The attack probes (FR-002, FR-004, FR-008) call `fetch` directly, so
each chooses every header it sends.

D-14 (2026-09-12, build). The dev proxy's target is 022's default address,
or `STATECRAFT_DEV_DAEMON_URL` when set, and the rewritten `Origin` follows
the target. The config accepts only an `http` URL at one of the three
loopback names and refuses to load otherwise. The need was found running §5's
`web:dev` round: the operator's own daemon held port 4519, and the proxy as
first written could only reach that daemon, so the round would have driven
it. A contributor in the same position needs the same thing, and a refusal of
any non-loopback target keeps the proxy from becoming a way off the machine.

D-15 (2026-09-12, build). `lifecycle-policy.ts`'s `POLICY_FILE` becomes the
literal `.statecraft/policy.json` instead of `join(".statecraft",
"policy.json")` evaluated at load. Found running §5's browser round: the built
UI threw `(0, c(...).join) is not a function` before rendering, because
`api-client.ts` imports `policyPayload` from that module and a browser bundle
stubs `path` with an empty object. The same throw was reproduced from
`origin/main` (`874766b`) with an identical bundle, so the built UI has not
rendered in a browser since spec 123 added the import; no test loads the
bundle in a browser. The literal is what `join` produced on every platform
the members support (108 D-10), and 123's tests pass unchanged. The larger
defect of the same cause, the dev server's, is recorded in the status below
and not fixed here.

## Status (2026-09-12, in progress: one acceptance round blocked)

Implemented and committed on branch `128-api-origin-guard`; the gate, `make
members` (typecheck, member builds, 994 Bun tests), `cargo fmt`, `clippy` and
`cargo test` exit 0. Acceptance, criterion by criterion:

- `bun test`, `cargo test -p statecraft-journal`, `make gate`: pass.
- The browser round: pass, in headless Chrome 152 driven over the DevTools
  protocol with a throwaway profile, against a daemon built from this branch
  on port 4631 with a scratch home and an unqualified scratch repository (so
  nothing could be driven). A page served from `127.0.0.1:4632` posted
  `disarm` twice (a `no-cors` simple request and a CORS one): both reached the
  daemon and were refused, `/api/meta` `guardRefusals` went from 0 to 2, the
  projects chain's SHA-256 was unchanged and the project stayed armed. The
  daemon's own UI then loaded and its Disarm control journaled
  `project.disarmed` with source `ui` at seq 4, with no refusal counted. A
  second run of the page took the count to 4 and appended nothing. The
  Chrome extension was not connected, which is why the round was driven
  headless.
- The same round through `bun run web:dev`: **blocked, not by this spec.** The
  dev server (Vite 8.2.0, proxying to the scratch daemon through D-14) serves
  the UI, which throws before rendering: `Module "path" has been externalized
  for browser compatibility`, raised from `journal.ts`. The chain is
  `api-client.ts` → `lifecycle-policy.ts` (`policyPayload`) → `receipt.ts` →
  `journal.ts` → `path`, `fs`, `crypto`, and every link is present at
  `origin/main`; a production build drops the unused bindings, which is why
  D-15 was enough there and is not here. What remains is to take the web
  client's policy payload off that chain (for example, `policyPayload` in a
  module with no Node imports, which both `api-client.ts` and
  `lifecycle-policy.ts` use), then rerun this round and flip to `complete`.
  That change belongs to 022's client and 123's module; it is reported for the
  owner to place rather than folded into this spec.
- The committed evidence bundle verifies under both verifiers (the parity
  suite's FR-003 (a)); spec 132 has minted no bundles yet.

## Status (2026-09-12, approved)

Approved on 2026-09-12 by the owner's adoption of revision 4 (doc 05 §19,
CLI-01; D-9), `implementation: pending`. It is the first of the revision-4
builds.

## Status (2026-09-12)

Authored `draft`, `implementation: pending`, on 2026-09-11 from doc 05 §3 F1
and F3. The measurements it rests on were taken with throwaway probes against
the API test fixtures and a temporary repository; nothing touched the
operator's running daemon or a real remote.

Revised on 2026-09-12 from doc 05 §18 (F1 and F3 re-measured at `874766b`;
F9, F10, F13; D78, D79): the project probe's second origin lookup, historical
values served without rewriting, the substring scan, the dev proxy, the
client table, and FR-006's field name corrected from `repo` to `origin`. The
negative cases were run against today's code, where every one of them
succeeds; they are the tests this spec would turn into refusals. Nothing is
implemented, and approval is a human flip. D-6 is the choice most worth a look
at approval.

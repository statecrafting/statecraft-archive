---
id: "130-member-distribution"
title: "Member distribution: one release installs a working engine, its members and its UI, with no checkout"
status: draft
created: "2026-09-11"
implementation: pending
risk: medium
depends_on:
  - "107-release-distribution"
  - "108-member-dispatch"
  - "042-member-contract"
  - "024-web-ui"
  - "124-provider-conformance"
establishes:
  - ".github/workflows/dist-smoke.yml"
  - "members/scripts/package-members.ts"
extends:
  # 107 owns the release pipeline and the installer; both gain the member set.
  - { spec: "107-release-distribution", unit: ".github/workflows/release.yml", nature: additive }
  - { spec: "107-release-distribution", unit: "install.sh", nature: additive }
  # 108 owns the umbrella's member surface; `members doctor` joins `list`,
  # through the same clap and dispatch units 108 itself extended.
  - { spec: "108-member-dispatch", unit: { kind: symbol, id: "statecraft_cli::members" }, nature: additive }
  - { spec: "102-crate-scaffold", unit: { kind: symbol, id: "statecraft_cli::cli::MembersCommand" }, nature: additive }
  - { spec: "102-crate-scaffold", unit: { kind: symbol, id: "statecraft_cli::commands::dispatch" }, nature: additive }
  # 102 owns the crate manifest and lockfile; doctor needs SHA-256 (`sha2`).
  - { spec: "102-crate-scaffold", unit: "Cargo.toml", nature: additive }
  - { spec: "102-crate-scaffold", unit: "Cargo.lock", nature: additive }
  # 024 owns static serving; the asset directory becomes a run-time decision.
  - { spec: "024-web-ui", unit: "members/src/orchestrator/api/static.ts", nature: additive }
  - { spec: "024-web-ui", unit: "members/src/orchestrator/api/static.test.ts", nature: additive }
  # 023 owns the engine's CLI: `daemon start` re-spawns itself correctly when
  # compiled, and the daemon passes the resolved asset directory.
  - { spec: "023-orchestrator-cli", unit: "members/src/commands/orchestrator.ts", nature: additive }
  # 026 owns the standby daemon's code-staleness freeze, and 022 the meta
  # route that reports it; a packaged engine compares a build constant or
  # reports the freeze unknown.
  - { spec: "026-standby-daemon", unit: "members/src/orchestrator/standby.ts", nature: additive }
  - { spec: "022-http-api-and-events", unit: "members/src/orchestrator/api/server.ts", nature: additive }
  # 124 owns qualification records, which a packaged engine must find.
  - { spec: "124-provider-conformance", unit: "members/src/orchestrator/qualification.ts", nature: additive }
  # 024 owns package.json's scripts section (042 extended it with the member
  # builds); the per-target engine builds join them.
  - { spec: "024-web-ui", unit: { kind: section, file: "members/package.json", anchor: "scripts" }, nature: additive }
  # Doc 05 is the record this spec is born from (D63, D64).
  - { spec: "110-corpus-merge", unit: { kind: directory, path: "docs/design/" }, nature: additive }
references:
  - { unit: { kind: file, path: "docs/design/05-the-realignment-checked.md" }, role: context }
summary: >
  Spec 107 made the umbrella installable; 042 packaged the members and 108
  taught the umbrella to discover them, and both put installing members out
  of scope for "a later spec". This is that spec. A compiled engine run
  outside the checkout was measured on 2026-09-11: its API answers, but its
  UI answers 503 with assets expected at /web/dist, and `daemon start` fails
  because it re-spawns itself as if it were a source file (042 D-10 recorded
  the cause and deferred the fix to here). A tag now also builds a member
  archive per macOS and Linux triple holding the engine, the native sensor
  and drivers, the built UI, the provider qualification records, and a
  manifest of every file's digest, with the same checksum, SBOM and
  provenance the umbrella's archives carry. The installer installs it into
  the managed member directory, verifying before it replaces, and keeps the
  previous set. A packaged engine finds its assets, its data and itself at
  run time. `statecraft members doctor` names what is missing, refused or
  altered and which provider prerequisites are absent. A CI job that never
  checks the repository out proves the result.
---

# 130: Member distribution

## 1. Purpose

A new user should be able to install this product, register a repository
they already have, run a governed build and inspect its evidence without a
source checkout and without an account (doc 05 D73). Today they can install
the umbrella and nothing it dispatches to.

The pieces exist and do not meet:

- `release.yml` builds and archives `statecraft` alone, and `install.sh`
  installs only it.
- `members.yml` builds the engine, the sensors, both drivers and the UI on
  every push, and publishes none of them.
- 108 resolves a managed member directory and discovers members in it, and
  states that "this spec does not install members into it".

And the engine, compiled, does not work where a user would put it. Measured
on 2026-09-11 with `bun run build:member:engine`, the binary copied to a
directory outside the checkout:

- `daemon run --data-dir <dir>` serves the API;
- `GET /` answers 503, "The web UI has not been built", with assets expected
  at `/web/dist`, because `static.ts` resolves them from `import.meta.dir`,
  which in a compiled bundle is a virtual root;
- `daemon start` exits 1 after 15 s: it re-spawns `process.execPath` with
  `join(PROJECT_DIR, "src/index.ts")` as its first argument, which the
  compiled binary reads as an unknown command, so the child prints usage and
  never takes the lock;
- the default data directory and the qualification directory have the same
  source-relative shape, so a packaged engine would need `--data-dir` on
  every verb and would call every driver unqualified.

042 D-10 recorded exactly this and assigned the fix to "the spec that makes a
member binary the primary way its verbs are reached". This spec is that one.

Measured again on 2026-09-12 at `874766b` (doc 05 §18.1, §18.2 F11): the 503
and the 15-second `daemon start` failure both reproduce, and `daemon stop`
works. Three more source-relative defaults were found. With no `--repo`, a
compiled `daemon run` registers `/$bunfs`, the bundle's virtual root, as its
first project (measured). The code-staleness freeze reads the engine's git
head from `import.meta.dir`, which compiled is `/`, so the freeze is silently
off (`orchestrator.ts:2814-2817`, read). And `daemon start` with port 0 waits
on the literal `:0` URL (read). The umbrella's `members list` already finds a
compiled engine placed in a managed member directory (measured), and `members
doctor` does not exist yet. The engine reads no provider data from disk other
than the qualification records: models and prompts are code constants.

## 2. Territory

- `.github/workflows/release.yml` (extends 107): the member archives.
- `members/scripts/package-members.ts`: assembles one triple's member set and
  writes its `members.json`.
- `install.sh` (extends 107): installs the member set when asked.
- `src/members.rs` (extends 108) and the crate manifest (extends 102):
  `statecraft members doctor`.
- `members/src/orchestrator/api/static.ts` (extends 024),
  `members/src/commands/orchestrator.ts` (extends 023) and
  `members/src/orchestrator/qualification.ts` (extends 124): run-time
  locations and the self re-spawn.
- `members/package.json` scripts (extends 024's section): the per-target
  engine builds.
- `.github/workflows/dist-smoke.yml`: the clean-machine proof.

## 3. Behavior

### B-1. What ships

The member set for a triple is: `statecraft-engine` (the TypeScript engine,
compiled with `bun build --compile --target=<bun target>`); the Rust
`statecraft-sensor-claude`, `statecraft-sensor-codex`,
`statecraft-driver-claude` and `statecraft-driver-codex` (112, 114, 115, 116),
built `--locked` for the triple; `statecraft-engine-web/`, the Vite build of
the UI; `statecraft-engine-qualification/`, the qualification records the
release was cut with (124); the Rust `statecraft-journal` (113), the
independent bundle verifier; and `members.json`. The fixture driver (124) is a
test instrument and does not ship. D-1 records why the Rust sensor and
drivers ship rather than the TypeScript builds of the same names, and D-6
what that choice changes.

Supported triples are the four macOS and Linux ones of 107. Windows receives
the umbrella only, as today: the engine's signal handling (108 D-10) and the
fence's shims are unix-only.

### B-2. The manifest names every byte

`members.json` carries the release tag, the member-contract version, and for
every file its path relative to the set, its SHA-256 and its size. Each
member's own `--member-manifest` output is recorded beside its entry, so the
set's declaration and the binary's are compared, not assumed equal. The
archive `statecraft-members-<tag>-<triple>.tar.gz` carries a `.sha256`
sidecar, a CycloneDX SBOM (the Rust crates from `Cargo.lock`, the engine
from `members/bun.lock`) and a SLSA provenance attestation whose subject is
the archive, exactly as 107 §3 does for the umbrella.

### B-3. The installer verifies before it replaces

With `STATECRAFT_WITH_MEMBERS=1`, `install.sh` also downloads the member
archive for the platform and verifies its checksum (hard) and provenance
(best effort, or hard under `STATECRAFT_REQUIRE_ATTESTATION=1`, 107 §4). It
extracts into a temporary sibling of the managed member directory (108 §4,
honouring `STATECRAFT_MEMBER_DIR`), verifies every file against
`members.json`, and only then moves the previous directory aside as
`<dir>.previous` and the new one into place. A failure at any step leaves the
installed set untouched. One previous generation is kept; restoring it is a
rename, which `members doctor` names.

`STATECRAFT_ARCHIVE_DIR` makes the installer read archives from a local
directory instead of GitHub Releases, which is what the smoke job uses. The
new installer names stay clear of the CLI's configuration keys (107 §4).

### B-4. A packaged engine finds its files at run time

Each location resolves in the same order: an explicit flag, then an
environment variable, then the directory beside the running binary, then the
source checkout (so `bun members/src/index.ts` keeps working unchanged):

| Location | Flag | Variable | Beside the binary |
|---|---|---|---|
| Web assets | `--web-dir` | `STATECRAFT_WEB_DIR` | `statecraft-engine-web/` |
| Qualification records | none | `STATECRAFT_QUALIFICATION_DIR` (124) | `statecraft-engine-qualification/` |
| Daemon home | `--data-dir` | none | not beside it: see below |

The daemon home of a packaged engine defaults to `statecraft/engine` under
the same platform data root 108 §4 uses for members. The source checkout
keeps its current default, so an operator's existing registry is not moved
from under them; `members doctor` reports a source-checkout daemon home when
one exists, and the operator chooses with `--data-dir`. Nothing migrates a
journal automatically.

The static handler's "not built" page (024 B-1's serving, which `static.ts`
holds to B-7's honesty rule) names the resolved directory and the variable
that overrides it.

Three defaults that have no location to resolve change for a packaged engine
only; the source checkout keeps each as it is:

- **The default repository.** A packaged `daemon run` or `daemon start` with
  no `--repo` registers nothing: an empty registry stays empty and says so,
  rather than registering the bundle's virtual root.
- **The code-staleness freeze.** A packaged engine carries its build's commit
  as a compile-time constant and compares that; with no constant, the freeze
  reports its state as `unknown` on `/api/meta`, never silently off.
- **Port 0.** `daemon start` refuses `--url` with port 0 and says why (it
  cannot wait on a port it does not know); `daemon run` keeps accepting it and
  prints the bound URL, as today.

### B-5. `daemon start` re-spawns what is running

When compiled, `daemon start` spawns `process.execPath` with the verb
arguments (`orchestrator daemon run ...`) and no script path; from source it
keeps spawning `bun src/index.ts`. The same holds for any other self
re-spawn in the engine.

### B-6. `statecraft members doctor`

A read-only umbrella verb that reports, in the 104 §5.2 envelope under
`--output json`:

- each member `members.json` expects: `ok`, `missing`, `refused` (contract
  outside the supported range, 108), `digest-mismatch`, or `shadowed` (an
  earlier `PATH` entry would win, which 108 already detects);
- the web and qualification directories: present and matching the manifest,
  or not;
- provider prerequisites, each `found` with its path and version or `absent`:
  `claude`, `codex` (including `STATECRAFT_CODEX_BIN`), `spec-spine` against
  `spec-spine.toml`'s required floor when run inside a governed repository,
  `git`, and `gh`, which the broker needs to publish (122). For each found
  provider binary, whether a qualification record covers its version (124
  D57);
- the installed set's tag beside the running daemon's version when a daemon
  answers, so an upgrade that has not been restarted is visible.

Doctor never installs, signs in, starts or stops anything. An absent provider
is a report, not a failure: the product runs with whichever provider is
present, and says which that is.

### B-7. The smoke job has no checkout

`dist-smoke.yml` runs on pull requests that touch the packaging paths and on
tags. A build job produces the umbrella and member archives for
`ubuntu-latest` and `macos-latest`, and uploads them with `install.sh`. A
second job, on a fresh runner that never runs `actions/checkout`, downloads
those artifacts and installs spec-spine from its own installer (an explicit
prerequisite, not bundled), then:

1. `install.sh` with `STATECRAFT_WITH_MEMBERS=1` and
   `STATECRAFT_ARCHIVE_DIR`;
2. `statecraft members doctor --output json`: every member `ok`, providers
   reported absent;
3. `statecraft engine orchestrator daemon start` with a temporary daemon home
   and port;
4. `GET /` answers 200 with the UI's root element, and `GET /api/meta`
   answers `ok`;
5. a repository created with `git init` and `spec-spine init` is registered
   through `projects add`, and appears in `GET /api/projects` with its
   qualification verdict;
6. one governed change: an approved fixture spec in that repository is built
   by the engine with the fixture driver (124), which the build job hands to
   this job as a separate CI artifact and never puts in the archive, pointed
   at by `STATECRAFT_DRIVER_BIN`; the round mints a receipt;
7. the run's bundle is exported by the installed engine and verified by the
   installed Rust `statecraft-journal verify-bundle`, a second implementation
   of the verifier, whose report (132 B-7, once 132 lands) reads `integrity:
   pass`, `signature: unsigned`, `issuerTrust: unknown`;
8. `daemon stop`, and the job fails if any step did.

## 4. Functional requirements

- **FR-001.** `package-members.ts` over a built set writes a `members.json`
  whose digests match the files, and refuses a set missing any B-1 entry.
- **FR-002.** `install.sh` (exercised by the smoke job and a local test over a
  tampered archive): a digest mismatch in any file leaves the previous set
  in place and exits non-zero; a clean install leaves `<dir>.previous`.
- **FR-003.** Run-time resolution (`static.test.ts` and a compiled-binary
  test): with the assets beside the binary and no checkout, `GET /` answers
  200; with neither, the "not built" page names the resolved directory.
- **FR-004.** A compiled engine's `daemon start` acquires the lock, answers
  `/api/meta`, and `daemon stop` stops it, from a directory outside the
  checkout.
- **FR-005.** `members doctor` reports each B-6 state from fixture member
  directories (108's `STATECRAFT_MEMBER_DIR` fixtures), including a
  digest mismatch and an absent provider, and exits 0 when only providers are
  absent.
- **FR-006.** The release pipeline's publish step fails on a missing member
  archive exactly as it does on a missing umbrella archive (107 §3.5).
- **FR-007.** A compiled engine run outside the checkout with no `--repo`
  and an empty daemon home registers no project; with a build commit constant
  the freeze compares it, and without one `/api/meta` reports the freeze
  `unknown`; `daemon start` with port 0 exits non-zero naming the reason.
- **FR-008.** The smoke job's governed change (B-7 steps 6 and 7) mints a
  receipt, and the exported bundle verifies under the installed Rust
  verifier.

## 5. Acceptance

- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`,
  `cargo test`, `bun test` in `members/`, `make gate` and `make members` are
  green.
- `dist-smoke.yml` is green on both runners, on the pull request that lands
  this spec.
- The first tag after this spec produces, beside the umbrella's fifteen
  assets, four member archives with sidecars, SBOMs and attestations that
  `gh attestation verify` accepts.
- A live check on a clean user account on a developer machine: install with
  members from that release, run `members doctor`, start the daemon, load the
  UI, register an existing repository and run one governed build with
  whichever provider is signed in, then export its bundle and verify it with
  the installed Rust verifier. The transcript goes in this spec's status
  section, as 107's did.
- Until the smoke job has passed for a tag, no document, page or view
  describes the UI or the engine as available (D-7).

## Verification

```sh
cargo test members
cd members && bun test src/orchestrator/api/static.test.ts
cd members && bun run build:member:engine && bun test src/members/
make gate
```

## 6. Out of scope

- **Installing, signing in to or updating a provider.** Doctor reports; the
  operator acts.
- **Windows members** (B-1).
- **Notarization and code signing** of the member binaries, as 107 §7 left
  them out for the umbrella; the attestation is the authenticity story.
- **A self-updater.** Re-running the installer is the upgrade path, as 107
  §7 decided.
- **Running members as services** (launchd, systemd). 042 §6 names it and no
  spec claims it yet.
- **Flattening the engine's verbs.** 042 D-7's condition (a packaged member
  is the primary way its verbs are reached) becomes true with this spec;
  the flattening, with aliases, is doc 05 D73 and a later spec.
- **Retiring the TypeScript sensor and driver.** They stay for the source
  path; this spec only chooses what ships (D-1).

## 7. Resolved decisions

D-1 (2026-09-11). The Rust sensor and drivers ship; the TypeScript builds of
the same names do not. The names collide, so one of each must be chosen, and
the Rust builds are native per triple, need no Bun runtime in the archive,
and are held to the TypeScript ones by 112's and 114's parity tests. The
TypeScript builds keep serving `observatory` and the source path until a
retirement spec says otherwise. This is a choice for the owner to confirm at
approval; doc 05 §16 lists it as open.

D-2 (2026-09-11). Assets beside the binary, not embedded in it. Embedding the
Vite build in the compiled engine would need a generated import table and
would make the UI unreplaceable without a rebuild; a sibling directory keeps
024's static handler reading from disk, unchanged, and is covered by the same
manifest digests as the binaries.

D-3 (2026-09-11). The installer, not a new umbrella verb, installs. 107
made `install.sh` the installation path and 108 deferred "its own verb and
its own release-channel reasoning"; one installer for both halves keeps one
verification story. The umbrella gains only the read-only `doctor`.

D-4 (2026-09-11). The source checkout's daemon home does not move. Moving an
operator's registry because they installed a binary would surprise them;
reporting it and letting `--data-dir` choose does not.

D-5 (2026-09-11). The smoke job proves "no checkout" by construction: its
second job has no `actions/checkout` step at all, so a path that reaches
into a source tree fails there rather than passing by accident.

D-6 (2026-09-12; proposed, the owner's choice). D-1 confirmed, with its
consequences stated. The engine resolves a driver from an explicit variable,
then the managed member directory, then `PATH`, then the source entry
(`driver.ts:212-233`). So installing this member set changes the Claude driver
a *source-checkout* engine runs, from the TypeScript build to the Rust one,
not only a packaged engine's; 114's parity tests are the justification, and
the release notes say it. Codex has only a Rust driver, so nothing changes for
it. The engine never invokes a sensor, so the sensors ship for the umbrella's
dispatch and could be left out of the first archive without changing anything
the engine does; they are included because they are built and parity-tested.
`statecraft-journal` ships because a verifier the user did not get from the
same code path as the exporter is the point of "separately verified". Doc 05
D83.

D-7 (2026-09-12; proposed). "Available" means installed and verified. Each
surface (the engine API, the UI, the drivers, the verifier) is described as
`source-only`, `packaged` (built by CI, not released), `released` (in a tag's
assets), `installed-verified` (this spec's smoke job passed for that tag) or
`exercised` (a recorded live round), and nothing is called available below
`installed-verified`. On 2026-09-12 the UI is `source-only`, the engine API and
driver discovery are `packaged`, and nothing is `released`. Doc 05 D84.

D-8 (2026-09-12). The smoke job's governed change uses the fixture driver,
delivered as a CI artifact beside the archives. CI has no provider account,
and a smoke job that depended on one would be skipped more often than run. The
fixture driver is the conformance instrument 124 built for exactly this, and
keeping it out of the archive keeps the shipped set free of a test double.

## Status (2026-09-12)

Authored `draft`, `implementation: pending`, from doc 05 §3 F4 and D63 and
D64. The measurements were taken on macOS with Bun 1.3.11, a compiled engine
in a scratch directory, a throwaway daemon home and ports other than the
operator's running daemon's.

Revised on 2026-09-12 from doc 05 §18 (F4 re-measured, F11; D83, D84): the
three further defaults, the verifier in the member set, the smoke job's
governed change and separate verification, the availability vocabulary, and
D-1's consequences. No clean machine was used and nothing was released; the
re-measurement copied a locally compiled engine to a scratch directory.
Nothing is implemented, and approval is a human flip. D-6 is the choice most
worth a look at approval.

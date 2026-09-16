---
id: "005-architecture-doc-governance"
title: "Architecture documentation governance: human docs as derived views of the owning specs"
status: approved
created: "2026-06-10"
owner: bart
kind: governance
domain: docs
risk: low
implementation: complete
# encore-app-architecture lives in template-encore and is pinned here via
# the lockstep (006-factory-schema-lockstep). Only the in-corpus dependency is
# kept.
depends_on: ["002-encore-generator-core"]
code_aliases: ["DOC_GOVERNANCE"]
summary: >
  Human-facing architecture documentation is a derived view of the owning
  specs. factory-encore owns the codemap/readme generators
  (`scripts/codemaps/`, `scripts/readmes/`) and the `orchestration/` guides;
  these are mechanically coupled (an edit requires touching this spec). The
  `CODEMAP.md` those generators emit is a born-with product artifact, carried
  into the produced app and governed there, not established here. `docs/` and
  `README.md` sit inside the coupling gate's built-in bypass floor, so their
  fidelity is enforced editorially: each doc names the spec(s) it derives
  from, and a doc change that contradicts an owning spec is a review-blocking
  defect.
# CODEMAP.md is a product artifact (born-with the produced app), so it is no
# longer established here; factory-encore owns the codemap/readme GENERATORS
# that emit it, plus the create-time orchestration guides.
establishes:
  - "adapters/acme-vue-encore/orchestration/"
  - "adapters/acme-vue-encore/scripts/codemaps/"
  - "adapters/acme-vue-encore/scripts/readmes/"
references:
  - { unit: { kind: file, path: "docs/" }, role: "governed editorially; mechanically exempt via the gate's bypass floor" }
---

# 005. Architecture documentation governance: human docs as derived views of the owning specs

## 1. Purpose

Human-authored architecture documentation is accurate when it is a faithful
derived view of the owning specs and inaccurate when it drifts from them. This
spec declares the governance contract that keeps every documentation surface
in this repository from drifting, using two complementary enforcement
mechanisms — mechanical coupling for root-level surfaces, editorial governance
for the `docs/` tree — matched to what each surface's path geometry makes
possible.

## 2. Territory

This spec owns the `orchestration/` guides and the codemap/readme generators
(`scripts/codemaps/`, `scripts/readmes/`). These paths are within the coupling
gate's claimed surface, so a change to any of them without a corresponding touch
to this spec causes `npx spec-spine couple --base origin/main` to exit non-zero.

`CODEMAP.md` is **not** owned here. It is a born-with product artifact: the
`scripts/codemaps/` generator emits it into the produced app, where it is
governed against that app's `encore-app-architecture`. factory-encore governs
the generator that emits it, not the emitted file (which does not exist in this
repository).

`docs/` and `README.md` sit inside the coupling gate's **built-in bypass
floor**. The gate exempts these paths by design; they are not and cannot be
mechanically coupled. Their governance is therefore editorial: each document
names the spec(s) it derives from, and a change that contradicts an owning
spec is a review-blocking defect adjudicated by human reviewers.

## 3. Behavior

### 3.1 Mechanically coupled surfaces

**FR-01**: The codemap generator (`scripts/codemaps/`) MUST emit a `CODEMAP.md`
that reflects the Encore service decomposition defined by the baseline's
`encore-app-architecture` invariant (pinned via spec `006-factory-schema-lockstep`):
the six services (`lib`, `db`, `health`, `auth`, `gateway`, `web`), the
`SQLDatabase("app")`, port 4000, and the generator script layout. Because the
generator is an `establishes` path, any change to the emitted service layout MUST
touch this spec in the same diff. The emitted `CODEMAP.md` itself is governed in
the produced app, not here.

**FR-02**: `orchestration/` contains the template orchestrator guide and the
per-step skill bodies. These documents MUST describe the Encore compile-time
service-composition model (copy-base + select auth driver + compose modules +
merge config). They MUST NOT describe any runtime-registry, middleware-chain,
or dynamic loader model. Because composition is additive, they MUST NOT
describe the generator as offering a configuration option to subtract, trim, or
remove a **core (built-in) service**: the baseline service floor (`auth`, `db`,
`gateway`, `health`, `lib`, `web`) is composed onto, never subtracted from. The
manual Trim phase (skill `template-trim`) prunes only optional composed modules
and Vue views, never core services, and the orchestration docs MUST keep that
distinction clear. The generator pipeline described by spec
`002-encore-generator-core` is the normative source; a change to the pipeline
MUST be reflected in the affected orchestration documents in the same diff.

**FR-03**: `scripts/codemaps/` and `scripts/readmes/` contain per-profile
generated codemaps and readme templates. They MUST reflect the current Encore
service graph and the two-app dual model (spec `004-dual-app-generator`). A
change to the profile structure MUST be reflected in these directories in the
same diff.

**FR-04**: Because `orchestration/`, `scripts/codemaps/`, and `scripts/readmes/`
are `establishes` paths of this spec, the coupling gate requires any PR that
edits these surfaces to also touch this spec. This is the mechanical lock
against silent drift. `CODEMAP.md` is not an `establishes` path: it is the
born-with output of `scripts/codemaps/`, governed in the produced app.

### 3.2 Editorially governed surfaces

**FR-05**: Each document in `docs/` MUST name the spec(s) it derives from,
either in a header comment or in an introductory sentence. Example: "This
document is a derived view of spec `encore-app-architecture`."

**FR-06**: A change to `docs/` that contradicts a statement in the named
owning spec is a **review-blocking defect**. Reviewers MUST reject such a
change and request that the owning spec be updated first (if the spec is
wrong) or that the doc change be corrected (if the doc is wrong).

**FR-07**: `README.md` is editorially governed under the same contract.
Changes to `README.md` that contradict spec `encore-app-architecture` or
spec `002-encore-generator-core` are review-blocking defects.

**FR-08**: The editorial governance contract applies to the following `docs/`
documents and their owning specs:

| Document | Owning spec(s) / source |
|----------|-------------------------|
| `docs/architecture.md` | the three-layer factory model (`process/`, `contract/`) and `002-encore-generator-core` (the adapter's create-time generator) |
| `docs/how-to.md` | `002-encore-generator-core`, `004-dual-app-generator` (running the generator) |
| `docs/oap-integration.md` | the OAP contract mirror under `contract/`; `000-factory-kernel` for the governance surface |
| `README.md` | `000-factory-kernel`, `002-encore-generator-core` |

The `docs/` tree here is the framework's own documentation. The produced-app
document set (`DEVELOPMENT.md`, `AUTH-SETUP.md`, `DEPLOYMENT.md`, and the rest)
is authored and governed in the produced app against its own spec corpus, not
here; the codemap/readme generators (`scripts/readmes/`) seed the produced app's
starting docs.

### 3.3 Coupling gate geometry

The coupling gate's built-in bypass floor exempts `.github/`, `docs/`,
`README.md`, `CODEOWNERS`, lockfiles, and `.derived/`. This is a deliberate
design choice in the gate's implementation, not a gap in this spec's
governance. The editorial contract in FR-05 through FR-08 is the governance
instrument for these paths; it is enforced by reviewers, not by the gate.

The mechanically coupled paths (`orchestration/`, `scripts/codemaps/`,
`scripts/readmes/`) are above the bypass floor and are fully gate-coupled. The
split between the two mechanisms is an architectural fact, not a limitation to
be closed.

## 4. Acceptance criteria

- **AC-1:** The `scripts/codemaps/` generator emits a `CODEMAP.md` describing the
  Encore service decomposition matching the pinned `encore-app-architecture`: six
  services, `SQLDatabase("app")`, port 4000, and the generator script layout. (The
  emitted file is born-with the produced app; it does not exist in this
  repository.)
- **AC-2:** Every file in `orchestration/` describes the Encore compile-time
  composition model. A search for runtime-session or dynamic-registry keywords
  across `orchestration/` returns zero matches, and no orchestration document
  describes a generator option to trim, subtract, or remove a core (built-in)
  service.
- **AC-3:** `npx spec-spine couple --base origin/main` exits 0 when
  `orchestration/`, `scripts/codemaps/`, and `scripts/readmes/` change only in a
  diff that also touches this spec.
- **AC-4:** At least one document in `docs/` names its owning spec in its
  header or introduction.
- **AC-5:** `npx spec-spine compile` and `npx spec-spine lint --fail-on-warn`
  exit 0 with this spec present.

## 5. Out of scope

- Governing module payload templates under `modules/**/files/` — those paths
  are governed by their owning module specs (e.g., spec `003-user-management-module`).
- Governing `standards/` documents — those are owned by the spec that
  introduces each standard.
- Automated enforcement of the editorial contract. The FR-05 through FR-08
  rules are enforced by human reviewers during code review. Automated linting
  of `docs/` content against spec claims is future work.
- Governing inline code comments that reference architecture decisions —
  those are governed by the code-owning spec, not by this spec.

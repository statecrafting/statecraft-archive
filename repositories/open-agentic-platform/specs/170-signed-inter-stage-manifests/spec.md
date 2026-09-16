---
id: "170-signed-inter-stage-manifests"
slug: signed-inter-stage-manifests
title: "Signed inter-stage manifests in factory-engine — cryptographic identity between stages (ASI07)"
status: approved
implementation: complete
owner: bart
created: "2026-05-22"
kind: capability
domain: platform
risk: medium
depends_on:
  - "035-agent-governed-execution"  # agent-governed-execution (agent ephemeral keys)
  - "074-factory-ingestion"  # factory-ingestion (contract types)
  - "075-factory-workflow-engine"  # factory-workflow-engine (the spec this spec refines)
  - "102-governed-excellence"  # governed-excellence (signature chain composes with certificate)
code_aliases: ["INTER_STAGE_SIGNED_MANIFEST", "FACTORY_STAGE_SIGNATURE_CHAIN"]
establishes:
  - unit: { kind: file, path: crates/factory-engine/src/inter_stage_manifest.rs }
  - unit: { kind: file, path: crates/factory-engine/tests/spec_170_handoff_chain.rs }
  - unit: { kind: file, path: crates/factory-engine/tests/spec_170_certificate_chain.rs }
refines:
  - aspect: "inter-stage-handoff-signing"
    unit: { kind: directory, path: crates/factory-engine }
extends:
  - spec: "102-governed-excellence"
    nature: additive
    unit: { kind: file, path: crates/factory-engine/src/governance_certificate.rs }
  - spec: "075-factory-workflow-engine"
    nature: additive
    unit: { kind: file, path: crates/factory-engine/src/engine.rs }
  - spec: "075-factory-workflow-engine"
    nature: additive
    unit: { kind: file, path: crates/factory-engine/src/bin/factory_run.rs }
references:
  - role: decomposition-source
    unit: { kind: file, path: docs/owasp/factory/AIDE-VELOCITY-OAP-INTENT.md }
  - role: substrate-spec
    unit: { kind: file, path: specs/075-factory-workflow-engine/spec.md }
  - role: doctrine-source
    unit: { kind: file, path: docs/owasp/owasp_top_10_agentic_applications_summary.md }
compliance:
  - framework: owasp-asi-2026
    controls: ["ASI07"]
summary: >
  OWASP ASI07 (Insecure Inter-Agent Communication)
  prescribes mTLS + cryptographic identity assertions
  between cooperating agents as the canonical
  mitigation. OAP's factory-engine (spec 075) runs as
  a two-phase pipeline (s0–s5 sequential, s6a–s6g
  fan-out). Today's hand-off between stages is an
  in-process call or a serialised state blob — no
  cryptographic identity assertion crosses the
  boundary.

  This spec refines spec 075 by requiring every inter-
  stage hand-off to carry a *signed manifest*: a
  structured payload identifying the previous stage's
  output, signed by the dispatching agent's ephemeral
  key (spec 035 substrate). The receiving stage
  validates the signature against the run's
  established key chain (the run's certificate, spec
  102, anchors the chain) and refuses to consume an
  unsigned or mis-signed manifest.

  The chain composes with spec 102's governance
  certificate: per-stage signatures aggregate into the
  certificate's chain, giving an auditor a per-stage-
  boundary verification surface in addition to the
  certificate's run-boundary one.
---

# 170 — Signed inter-stage manifests in factory-engine

## 1. Problem

Spec 075's two-phase factory engine sequences stages
s0–s5 and fans out s6a–s6g. Between stages, the engine
hands off a state blob (typed records from
`crates/factory-contracts`). Today the hand-off is
trusted by the engine's in-process construction — the
producing stage writes a struct; the consuming stage
reads it; no cryptographic boundary.

OWASP ASI07 (Insecure Inter-Agent Communication) treats
this seam as a structural risk:

> *"Signed manifests + mTLS = canonical ASI07
> mitigation."*

The convergence doc §2.C amplifies:

> *"Signed inter-stage manifests in factory-engine.
> Every hand-off between s0…s5 and s6a…s6g should be
> signed by the dispatching agent's ephemeral key.
> ASI07's core mitigation is mTLS + cryptographic
> identity assertions between cooperating agents."*

The gap is concrete:

1. A compromised stage (e.g., a stage running
   adapter-emitted code in a sandbox per spec 162)
   could in principle mutate the state blob before
   the next stage consumes it. Without signing, the
   downstream stage has no way to detect the
   mutation.
2. A multi-process or multi-host pipeline (when
   factory-engine eventually distributes stages across
   sandbox boundaries) cannot rely on in-process trust
   — a network or filesystem boundary breaks the
   implicit trust.
3. Spec 102's governance certificate binds per-stage
   artifact hashes, but the certificate is assembled
   *after* the run completes. Spec 170 closes the gap
   between assembly and run-time: each stage verifies
   the prior stage's signature before consuming, not
   only after the fact.

## 2. Decision

Require every inter-stage hand-off in factory-engine to
carry a signed manifest. The manifest is a structured
JSON payload:

```json
{
  "run_id": "<uuid>",
  "from_stage": "<stage_id>",
  "to_stage": "<stage_id>",
  "produced_at": "<ISO-8601>",
  "artifact_hashes": { "<name>": "<sha256>", ... },
  "metadata": { ... },
  "signer": {
    "agent_id": "<uri>",
    "ephemeral_key_id": "<key-fingerprint>"
  },
  "signature": "<base64-signature>"
}
```

### 2.1 Key chain

Each factory run establishes a key chain at s0
(preflight). The run's *root key* is registered in the
run's governance certificate (spec 102 FR-007's signer
field). Subsequent stages mint *ephemeral keys* derived
from the root key (per spec 035's agent ID + ephemeral-
key model); each ephemeral key is bound to a stage and
discarded at stage exit.

The receiving stage validates an incoming manifest by:

1. Resolving the `signer.ephemeral_key_id` against the
   run's key chain (loaded from the run's manifest
   directory).
2. Verifying the signature using the resolved public
   key.
3. Recomputing the manifest's content hash and
   confirming it matches the signed payload.

Validation failure halts the run.

### 2.2 Composition with the governance certificate

At run completion, spec 102's certificate assembly
includes the manifest chain as a stage-level
verification record. The auditor's verifier (spec 102
`verify-certificate`) can validate not only the
run-level certificate but also the per-stage manifest
chain — providing two independent verification
surfaces.

### 2.3 Inter-process / inter-host extensibility

The manifest format is identical whether stages run
in-process, across processes (sandbox per spec 162),
or across hosts (future distributed factory). The
signing discipline is independent of transport. This
lets the factory engine evolve from single-process to
distributed without re-spec'ing the hand-off
semantics.

### 2.4 Fan-out signing

Spec 075's s6a–s6g fan-out involves multiple parallel
consumers receiving the same state from s5. Each fan-
out branch receives the *same* signed manifest from
s5; the receiving stage validates against s5's
signature once, then independently signs its own
output manifest for any downstream consumer.

## 3. Functional Requirements

- **FR-001** Every inter-stage hand-off in
  `crates/factory-engine` (sequential s0–s5 and
  fan-out s6a–s6g) carries a signed manifest of the
  shape declared in §2.
- **FR-002** The signer is the dispatching stage's
  ephemeral key, derived from the run's root key.
- **FR-003** The receiving stage validates the
  signature before consuming the state. Validation
  failure halts the run with a typed error naming the
  failing manifest.
- **FR-004** The run's root key is established at s0
  (preflight) and recorded in the run's certificate's
  signer chain.
- **FR-005** Ephemeral keys are minted per stage and
  discarded at stage exit. No long-lived stage keys
  exist.
- **FR-006** Manifest validation is offline-capable:
  the receiving stage validates using only the
  signed manifest and the run's local key-chain
  state. No network calls.
- **FR-007** At run completion, the manifest chain
  is recorded in the governance certificate
  (spec 102). `make verify-certificate` validates
  both the run-level certificate and each stage
  manifest's signature.
- **FR-008** Fan-out branches independently sign
  their own output manifests; a single mis-signed
  fan-out branch halts only that branch's downstream
  consumption, while other branches continue (per
  spec 075's bounded fan-out semantics).
- **FR-009** Tampering with any artifact hash in a
  manifest causes validation to fail at the next
  receiver or at certificate verification time —
  whichever is earlier.

## 4. Success Criteria

- **SC-001** A normal factory run produces a manifest
  chain whose every link validates at receive time
  and at certificate-verify time.
- **SC-002** An adversarial test that mutates the
  inter-stage state blob between stages causes the
  receiving stage to halt with a signature-validation
  failure.
- **SC-003** An adversarial test that swaps a signed
  manifest from one run into another run causes
  validation to fail (the signer's ephemeral key is
  not in the receiving run's chain).
- **SC-004** `make verify-certificate` on a complete
  run validates both the certificate and the manifest
  chain offline.
- **SC-005** Fan-out branches' independent signing
  produces a verifiable per-branch manifest chain.

## 5. Scope

### In scope

- The manifest format definition.
- The signing discipline (root key + ephemeral
  per-stage keys).
- The validation requirement at each inter-stage
  boundary.
- Composition with spec 102's certificate.
- Fan-out signing semantics.

### Out of scope (deferred)

- **mTLS at the network layer.** When the factory
  engine distributes across hosts, mTLS at the network
  boundary is a complementary mitigation. Spec 170
  covers the *application-layer* signature; transport-
  layer mTLS is its own concern.
- **Key rotation policy.** Ephemeral keys are minted
  per stage; root key rotation across runs is
  operational policy, not a structural requirement of
  this spec.
- **Cross-run signature aggregation.** Each run is
  independently signed; an attempt to demonstrate
  "all runs in this period were signed by approved
  keys" is a portfolio concern, not part of this
  spec.
- **HSM integration.** The first cut signs with
  software keys. Future HSM integration is a
  refinement of the key custody, not the signing
  protocol.

## 6. Compliance

Spec 170 is the load-bearing OAP mitigation for
**ASI07 (Insecure Inter-Agent Communication)**. Each
factory stage is, in effect, a cooperating agent —
producing structured output for downstream consumption.
Signed manifests are the application-layer assertion of
cryptographic identity per OWASP doctrine.

The spec composes with spec 102 (run-level
verifiability) and spec 162 (sandbox boundaries
between stages where applicable). The three together
give a structurally complete ASI05 + ASI07 + ASI09
posture for factory-engine work.

## 7. Implementation map

| Concern | Code |
|---|---|
| Manifest format, signing, validation | `crates/factory-engine/src/inter_stage_manifest.rs` (`InterStageManifest`, `RunKeyChain`, `sign_manifest`, `verify_manifest`) |
| Run-scope signing session + offline chain reload | `inter_stage_manifest::StageHandoffSigner` (writes `<run_dir>/keychain.json` + `<run_dir>/manifests/*.json`) |
| Engine entry points | `FactoryEngine::establish_signing_session`, `FactoryEngine::seal_stage_handoff` (in `crates/factory-engine/src/engine.rs`) |
| Post-hoc chain emission from a run directory | `inter_stage_manifest::generate_chain_from_run_dir` (walks `PROCESS_STAGE_SEQUENCE` + dynamic `s6*` fan-out) |
| Certificate composition (FR-007) | `governance_certificate::InterStageChainRecord` field on `GovernanceCertificate`; `CertificateBuilder::inter_stage_chain`; verifier replays chain offline |
| `factory-run` runtime wiring | `crates/factory-engine/src/bin/factory_run.rs::emit_certificate` calls `generate_chain_from_run_dir` and binds the chain into every emitted cert |
| SC-001..SC-005 coverage | `crates/factory-engine/tests/spec_170_handoff_chain.rs` + `crates/factory-engine/tests/spec_170_certificate_chain.rs` (CLI-level SC-004 via `CARGO_BIN_EXE_verify-certificate`) |

The certificate version bump from `1.2.0` → `1.3.0` records the
chain field's introduction; `skip_serializing_if = "Option::is_none"`
preserves byte-identity for runs that legitimately omit the chain.

## 8. Cross-references

- **INTENT doc** §7.2, §9.11.
- **Spec 075** — factory-workflow-engine; spec 170
  refines.
- **Spec 035** — agent-governed-execution; the
  ephemeral-key substrate.
- **Spec 074** — factory-ingestion; contract types
  whose state blobs are signed.
- **Spec 102** — governed-excellence; composes via
  certificate chain.
- **Spec 162** — sandbox execution contract;
  composes via sandbox boundaries between stages.
- **Convergence doc §2.C** — doctrine framing.

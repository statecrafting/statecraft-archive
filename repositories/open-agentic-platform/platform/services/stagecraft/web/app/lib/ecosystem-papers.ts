/**
 * Governed Whitepaper Data Model
 *
 * Each paper demonstrates the spec-to-content binding:
 * - Bound to a governing spec (from spec-spine)
 * - Content hash (SHA-256 of the content body)
 * - Governance certificate reference
 * - Audit trail entries
 */

export interface AuditEntry {
  timestamp: string;
  action: string;
  actor: string;
  specRef: string;
  hash: string;
}

export interface GovernanceCertificate {
  version: string;
  specSpineAttestation: string;
  sbomHash: string;
  signatureAlgorithm: string;
  signerIdentity: string;
  issuedAt: string;
  expiresAt: string;
}

export interface PaperSection {
  id: string;
  heading: string;
  content: string;
  specBinding: string;
  contentHash: string;
}

export interface Paper {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  abstract: string;
  governingSpec: {
    id: string;
    title: string;
    version: string;
    sha256: string;
  };
  contentHash: string;
  status: "published" | "draft" | "under-review";
  publishedAt: string;
  lastVerifiedAt: string;
  authors: string[];
  tags: string[];
  sections: PaperSection[];
  auditTrail: AuditEntry[];
  certificate: GovernanceCertificate;
}

export const papers: Paper[] = [
  {
    id: "wp-001",
    slug: "governance-model",
    title: "The Governance Execution Model",
    subtitle: "Why governance must be the execution model, not a compliance sidecar",
    abstract: "Traditional software governance operates as a post-hoc compliance layer, audits happen after the fact, policies are checked manually, and drift between intent and implementation accumulates silently. This paper argues that governance must be the execution model itself: every state transition authorised by a spec, every artifact traceable to its governing intent, every deployment verified before it runs.",
    governingSpec: {
      id: "spec-102",
      title: "governance-execution-model",
      version: "2.1.0",
      sha256: "a7f3c9d2e1b4f8a6c3d5e7f9a1b2c4d6e8f0a2b4c6d8e0f1a3b5c7d9e1f3a5b7",
    },
    contentHash: "e4d7a2f1c8b3e6d9a5f2c7b4e1d8a3f6c9b2e5d7a4f1c8b3e6d9a2f5c7b4e1d8",
    status: "published",
    publishedAt: "2026-06-15T09:00:00Z",
    lastVerifiedAt: "2026-07-04T06:00:00Z",
    authors: ["Platform Architecture Team"],
    tags: ["governance", "execution-model", "spec-spine", "trust"],
    sections: [
      {
        id: "s1",
        heading: "The Compliance Sidecar Problem",
        content: "In most organisations, governance is bolted on after the fact. Code ships, then auditors review. Policies exist in wikis, disconnected from the systems they govern. The result is predictable: drift accumulates between what was intended and what was built. By the time an audit catches a deviation, the cost of correction has compounded.\n\nThis pattern, governance as a sidecar, fails for three structural reasons:\n\n1. **Temporal disconnect**: The gap between action and verification creates a window where ungoverned state persists.\n2. **Authority ambiguity**: When policies live outside the system, there is no deterministic way to answer \"who authorised this change?\"\n3. **Drift accumulation**: Small deviations compound. Without continuous verification, systems diverge from their governing intent silently.",
        specBinding: "spec-102 § 2.1",
        contentHash: "f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2",
      },
      {
        id: "s2",
        heading: "Governance as Execution Model",
        content: "The alternative is to make governance the execution model itself. Every state transition in the system requires authorisation from a governing spec. Every artifact produced carries a cryptographic binding to the spec that authorised its creation. Every deployment is verified against its governance certificate before it runs.\n\nThis is not aspirational, it is the architecture of the Open Agentic Platform. The spec-spine compiles markdown specs into a deterministic JSON registry. The factory-encore pipeline refuses to produce artifacts without a governing spec. The tenant-emit CLI signs governance certificates that bind the spec corpus, the SBOM, and the build artifacts into a single verifiable chain.\n\nThe result: there is no ungoverned state. Not because governance is enforced after the fact, but because ungoverned transitions are structurally impossible.",
        specBinding: "spec-102 § 3.1",
        contentHash: "a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3",
      },
      {
        id: "s3",
        heading: "The Spec-to-Code Coupling Gate",
        content: "The coupling gate is the mechanism that prevents drift. At PR time, spec-spine's `couple` command checks whether the code being merged is consistent with its owning spec. If the spec has changed but the code hasn't been updated, or vice versa, the gate fails with exit code 1.\n\nThis is not a linter. It is not a style check. It is a structural verification that the relationship between intent (spec) and implementation (code) remains intact. The gate operates on the deterministic registry produced by `spec-spine compile`, ensuring that the verification is reproducible: same inputs produce byte-identical output on every platform.\n\nThe coupling gate transforms governance from a periodic audit into a continuous invariant.",
        specBinding: "spec-127 § 4.2",
        contentHash: "b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4",
      },
      {
        id: "s4",
        heading: "Certificate Chain: From Identity to Audit",
        content: "The governance certificate is the terminal artifact of the governed delivery pipeline. It is a single JSON document that proves:\n\n- **Identity**: Who signed it (Ed25519, operator-supplied key)\n- **Corpus binding**: Which spec-spine attestation hash was current at build time\n- **SBOM binding**: Which CycloneDX BOM content hash was produced\n- **Artifact binding**: Which build outputs were included in the signed envelope\n\nThe certificate is produced by tenant-emit and verified by tenant-tail. These two tools are distinct distributables by construction, no verify verb in the emitter, no emit verb in the verifier. This separation ensures that the verification path has no dependency on the production path.\n\ntenant-tail verification is offline-capable, identity-free, and read-only. You do not need to trust the producer. You do not need network access. You need only the certificate and the artifacts it claims to govern.",
        specBinding: "spec-219 § 5.1 / spec-220 § 3.2",
        contentHash: "c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5",
      },
    ],
    auditTrail: [
      { timestamp: "2026-06-10T14:22:00Z", action: "spec-authored", actor: "arch-team", specRef: "spec-102 v2.0.0", hash: "d5e6f7a8..." },
      { timestamp: "2026-06-12T09:15:00Z", action: "content-drafted", actor: "content-team", specRef: "spec-102 v2.0.0", hash: "e6f7a8b9..." },
      { timestamp: "2026-06-13T16:40:00Z", action: "spec-updated", actor: "arch-team", specRef: "spec-102 v2.1.0", hash: "f7a8b9c0..." },
      { timestamp: "2026-06-14T11:00:00Z", action: "coupling-gate-pass", actor: "ci-pipeline", specRef: "spec-102 v2.1.0", hash: "a8b9c0d1..." },
      { timestamp: "2026-06-15T09:00:00Z", action: "certificate-emitted", actor: "tenant-emit", specRef: "spec-102 v2.1.0", hash: "b9c0d1e2..." },
      { timestamp: "2026-07-04T06:00:00Z", action: "certificate-verified", actor: "tenant-tail", specRef: "spec-102 v2.1.0", hash: "c0d1e2f3..." },
    ],
    certificate: {
      version: "1.0.0",
      specSpineAttestation: "a7f3c9d2e1b4f8a6c3d5e7f9a1b2c4d6e8f0a2b4c6d8e0f1a3b5c7d9e1f3a5b7",
      sbomHash: "d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5",
      signatureAlgorithm: "Ed25519",
      signerIdentity: "platform-arch-team@statecraft.ing",
      issuedAt: "2026-06-15T09:00:00Z",
      expiresAt: "2027-06-15T09:00:00Z",
    },
  },
  {
    id: "wp-002",
    slug: "spec-spine-architecture",
    title: "Spec Spine: The Authority Ledger",
    subtitle: "How a markdown corpus becomes a deterministic, hash-verifiable registry",
    abstract: "spec-spine is the canonical contract system of the Open Agentic Platform. It transforms a directory of markdown specs with YAML frontmatter into a deterministic JSON registry that serves as the single source of truth for what exists, what is authorised, and what each scope is allowed to do. This paper details the architecture, the determinism guarantees, and the coupling gate that prevents spec-code drift.",
    governingSpec: {
      id: "spec-127",
      title: "spec-code-coupling-gate",
      version: "1.3.0",
      sha256: "b8c4d1e2f3a5b7c9d1e3f5a7b9c1d3e5f7a9b1c3d5e7f9a1b3c5d7e9f1a3b5c7",
    },
    contentHash: "f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6",
    status: "published",
    publishedAt: "2026-06-20T10:30:00Z",
    lastVerifiedAt: "2026-07-04T06:00:00Z",
    authors: ["Spec Spine Maintainers"],
    tags: ["spec-spine", "registry", "determinism", "coupling-gate"],
    sections: [
      {
        id: "s1",
        heading: "The Problem: Specs That Lie",
        content: "Documentation drifts. It is one of the most reliable laws of software engineering. The spec says one thing; the code does another. The wiki describes an architecture that existed six months ago. The README promises features that were never implemented.\n\nThis drift is not a discipline problem, it is a structural one. When specs and code live in disconnected systems with no automated verification of their relationship, drift is the default outcome. The question is not whether it will happen, but how much has accumulated since the last manual check.\n\nspec-spine eliminates this class of problem by making the spec corpus a compiled artifact with deterministic output and a coupling gate that refuses code that has drifted from its owning spec.",
        specBinding: "spec-127 § 1.1",
        contentHash: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
      },
      {
        id: "s2",
        heading: "Deterministic Compilation",
        content: "The core guarantee of spec-spine is determinism: given the same input files and configuration, the output is byte-identical on every platform, every time. This is not an aspiration, it is a tested invariant.\n\nThe compile step reads every markdown file in the specs/ directory, parses YAML frontmatter (id, title, status, owner, dependencies), and produces two deterministic views:\n\n1. **The Registry** (spec-as-source): A JSON structure indexed by spec ID, containing metadata, dependency graphs, and content hashes.\n2. **The Index** (code-as-source): A reverse mapping from code paths to their governing specs, enabling the coupling gate.\n\nBoth views are pure functions of (config, file contents). There is no timestamp, no random seed, no environment variable that can alter the output. This determinism is what makes the coupling gate trustworthy, if the gate passes today, it will pass tomorrow given the same inputs.",
        specBinding: "spec-127 § 2.1",
        contentHash: "b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3",
      },
      {
        id: "s3",
        heading: "Per-Unit Shard Trees",
        content: "At scale, a monolithic registry creates merge conflicts. If every spec change touches the same output file, parallel development becomes serialised.\n\nspec-spine solves this with per-unit shard trees. Instead of a single registry.json, the output is sharded by spec (by-spec/) and by package (by-package/). Each shard is an independent file that can be updated without touching any other shard.\n\nThe practical effect: PRs that touch different specs never conflict. Teams can work on independent specs in parallel without coordination overhead. The coupling gate checks only the shards relevant to the changed code, keeping CI fast even as the spec corpus grows.",
        specBinding: "spec-127 § 3.4",
        contentHash: "c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4",
      },
      {
        id: "s4",
        heading: "The Coupling Gate in Practice",
        content: "The coupling gate is invoked at PR time as a CI check. It performs three verifications:\n\n1. **Freshness**: Are the derived shards up to date with the current spec content? (Detected by `spec-spine index check`)\n2. **Ownership**: Does every changed file have a governing spec? (Unowned code is ungoverned code)\n3. **Consistency**: Has the spec changed without corresponding code changes, or vice versa?\n\nIf any check fails, the gate exits with code 1 and the PR cannot merge. This is not a warning. It is not a suggestion. It is a hard gate that prevents ungoverned changes from entering the main branch.\n\nThe gate is available as a cargo crate, an npm package, and a Python wheel, ensuring it can run in any CI environment without language-specific toolchain requirements.",
        specBinding: "spec-127 § 4.1",
        contentHash: "d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5",
      },
    ],
    auditTrail: [
      { timestamp: "2026-06-16T10:00:00Z", action: "spec-authored", actor: "spine-team", specRef: "spec-127 v1.3.0", hash: "e5f6a7b8..." },
      { timestamp: "2026-06-18T14:30:00Z", action: "content-drafted", actor: "docs-team", specRef: "spec-127 v1.3.0", hash: "f6a7b8c9..." },
      { timestamp: "2026-06-19T11:20:00Z", action: "coupling-gate-pass", actor: "ci-pipeline", specRef: "spec-127 v1.3.0", hash: "a7b8c9d0..." },
      { timestamp: "2026-06-20T10:30:00Z", action: "certificate-emitted", actor: "tenant-emit", specRef: "spec-127 v1.3.0", hash: "b8c9d0e1..." },
      { timestamp: "2026-07-04T06:00:00Z", action: "certificate-verified", actor: "tenant-tail", specRef: "spec-127 v1.3.0", hash: "c9d0e1f2..." },
    ],
    certificate: {
      version: "1.0.0",
      specSpineAttestation: "b8c4d1e2f3a5b7c9d1e3f5a7b9c1d3e5f7a9b1c3d5e7f9a1b3c5d7e9f1a3b5c7",
      sbomHash: "e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6",
      signatureAlgorithm: "Ed25519",
      signerIdentity: "spec-spine-maintainers@statecraft.ing",
      issuedAt: "2026-06-20T10:30:00Z",
      expiresAt: "2027-06-20T10:30:00Z",
    },
  },
  {
    id: "wp-003",
    slug: "factory-pipeline",
    title: "The Factory Pipeline: Process, Contract, Adapter",
    subtitle: "Separating the process of building software from its implementation",
    abstract: "factory-encore introduces a three-layer separation that makes software delivery technology-agnostic at the process level while remaining concrete at the implementation level. The process layer never names a framework; the contract layer defines formal schemas; the adapter layer provides pluggable implementations. This paper explains why this separation matters and how it enables governed, reproducible software delivery.",
    governingSpec: {
      id: "spec-075",
      title: "factory-workflow-engine",
      version: "1.0.0",
      sha256: "c9d5e2f3a6b8c0d2e4f6a8b0c2d4e6f8a0b2c4d6e8f0a2b4c6d8e0f2a4b6c8d0",
    },
    contentHash: "a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7",
    status: "published",
    publishedAt: "2026-06-25T08:00:00Z",
    lastVerifiedAt: "2026-07-04T06:00:00Z",
    authors: ["Factory Engineering Team"],
    tags: ["factory-encore", "pipeline", "adapters", "build-spec"],
    sections: [
      {
        id: "s1",
        heading: "The Coupling Problem in Software Factories",
        content: "Most software factories couple their process to their implementation. The way you gather requirements is tied to the framework you deploy on. The way you design is shaped by the database you chose. The way you test is determined by the language you write in.\n\nThis coupling has a cost: when you change your implementation technology, you must also change your process. When you want to apply the same process to a different stack, you must rebuild it from scratch. The process knowledge, which is the valuable part, is trapped inside implementation-specific tooling.\n\nfactory-encore breaks this coupling with a formal contract between process and implementation.",
        specBinding: "spec-075 § 1.1",
        contentHash: "e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2",
      },
      {
        id: "s2",
        heading: "Three Layers, One Pipeline",
        content: "The factory operates in three distinct layers:\n\n**Process Layer** (universal): Six sequential stages transform business documents into a frozen Build Specification. The stages are: Preflight Validation, Requirements Analysis, Architecture Design, Detailed Specification, Build Specification Freeze, and Adapter Handoff. This layer never names a framework, language, or deployment target.\n\n**Contract Layer** (formal schemas): Three schemas define the interface between process and implementation: the Build Specification (what to build), the Adapter Manifest (what the adapter can do), and the Verification Contract (how to verify the result). These schemas are versioned and validated.\n\n**Adapter Layer** (pluggable): One implementation per target stack. The acme-vue-encore adapter produces Encore.ts + Vue 3 applications. A future adapter could produce Rails + React, or Go + HTMX, or any other combination, without changing the process or contracts.",
        specBinding: "spec-075 § 2.1",
        contentHash: "f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3",
      },
      {
        id: "s3",
        heading: "The Build Specification as Frozen Artifact",
        content: "The Build Specification is the terminal output of the process layer and the primary input to the adapter layer. It is frozen: once produced, it does not change. The adapter reads it; it does not modify it.\n\nThis freezing is load-bearing. It means:\n\n- The same Build Spec, given to the same adapter version, produces the same output (reproducibility)\n- The Build Spec can be audited independently of the implementation (governance)\n- Multiple adapters can consume the same Build Spec (portability)\n- The Build Spec carries a SHA-256 hash that is embedded in the governance certificate (traceability)\n\nThe Build Spec is not a template. It is not a configuration file. It is a complete, self-contained description of what the software must do, expressed in implementation-agnostic terms.",
        specBinding: "spec-075 § 3.2",
        contentHash: "a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4",
      },
      {
        id: "s4",
        heading: "Governance Envelope",
        content: "Every factory run begins with a governance envelope: an admission brief that declares the objective class (greenfield, extension, migration, maintenance) and sets ceilings on scope, complexity, and risk.\n\nThe envelope is not optional. Without it, the factory refuses to start. This ensures that every piece of software produced by the factory has a declared purpose, bounded scope, and known risk profile before a single line of code is written.\n\nThe envelope becomes part of the governance certificate. When tenant-tail verifies a certificate, it can confirm not just that the code matches its spec, but that the spec was produced within declared governance boundaries. The chain is complete: from admission intent through process execution to verified delivery.",
        specBinding: "spec-075 § 4.1 / spec-102 § 6.3",
        contentHash: "b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5",
      },
    ],
    auditTrail: [
      { timestamp: "2026-06-21T08:00:00Z", action: "spec-authored", actor: "factory-team", specRef: "spec-075 v1.0.0", hash: "c5d6e7f8..." },
      { timestamp: "2026-06-23T13:45:00Z", action: "content-drafted", actor: "content-team", specRef: "spec-075 v1.0.0", hash: "d6e7f8a9..." },
      { timestamp: "2026-06-24T15:10:00Z", action: "coupling-gate-pass", actor: "ci-pipeline", specRef: "spec-075 v1.0.0", hash: "e7f8a9b0..." },
      { timestamp: "2026-06-25T08:00:00Z", action: "certificate-emitted", actor: "tenant-emit", specRef: "spec-075 v1.0.0", hash: "f8a9b0c1..." },
      { timestamp: "2026-07-04T06:00:00Z", action: "certificate-verified", actor: "tenant-tail", specRef: "spec-075 v1.0.0", hash: "a9b0c1d2..." },
    ],
    certificate: {
      version: "1.0.0",
      specSpineAttestation: "c9d5e2f3a6b8c0d2e4f6a8b0c2d4e6f8a0b2c4d6e8f0a2b4c6d8e0f2a4b6c8d0",
      sbomHash: "f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7",
      signatureAlgorithm: "Ed25519",
      signerIdentity: "factory-engineering@statecraft.ing",
      issuedAt: "2026-06-25T08:00:00Z",
      expiresAt: "2027-06-25T08:00:00Z",
    },
  },
  {
    id: "wp-004",
    slug: "certificate-verification",
    title: "Certificate Verification: Trust Without Trust",
    subtitle: "How tenant-tail verifies governance certificates without trusting the producer",
    abstract: "The verify/emit boundary is load-bearing. tenant-tail is a verify-only CLI that re-checks the run-side artifacts the factory asserted about its build, with no trust in the producer. It is offline-capable, identity-free, and read-only. This paper explains the verification model, the separation from the emitter, and why this architecture makes governance certificates trustworthy.",
    governingSpec: {
      id: "spec-219",
      title: "tenant-tail-verify-cli",
      version: "0.4.0",
      sha256: "d0e6f3a4b7c9d1e3f5a7b9c1d3e5f7a9b1c3d5e7f9a1b3c5d7e9f1a3b5c7d9e1",
    },
    contentHash: "b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8",
    status: "published",
    publishedAt: "2026-06-30T11:00:00Z",
    lastVerifiedAt: "2026-07-04T06:00:00Z",
    authors: ["Trust & Verification Team"],
    tags: ["tenant-tail", "verification", "certificates", "zero-trust"],
    sections: [
      {
        id: "s1",
        heading: "The Trust Problem",
        content: "When a producer says \"this artifact is governed,\" why should you believe them? The producer has every incentive to claim compliance. The certificate they emit is only as trustworthy as the verification that can be performed independently.\n\nThis is the fundamental insight behind the emit/verify separation: the entity that produces a governance claim must be structurally distinct from the entity that verifies it. Not just organisationally distinct, architecturally distinct. Different binaries. Different dependency trees. Different trust assumptions.\n\ntenant-emit produces claims. tenant-tail verifies them. They share no code, no dependencies, and no trust relationship.",
        specBinding: "spec-219 § 1.1",
        contentHash: "c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9",
      },
      {
        id: "s2",
        heading: "Verification Without Identity",
        content: "tenant-tail does not know who you are. It does not ask. It does not care. Verification is identity-free by design.\n\nThis matters because identity requirements create barriers to verification. If you need an account, a token, or a network connection to verify a governance certificate, then verification is gated by access control. Access-controlled verification is not independent verification, it is permission-granted verification.\n\ntenant-tail needs only two things: the certificate file and the artifacts it claims to govern. Given those, it can verify:\n\n- Signature validity (Ed25519)\n- Corpus binding (spec-spine attestation hash matches)\n- SBOM binding (CycloneDX content hash matches)\n- Artifact integrity (file hashes match certificate claims)\n\nAll of this works offline. No API calls. No network. No identity provider. Just cryptographic verification of mathematical claims.",
        specBinding: "spec-219 § 2.3",
        contentHash: "d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0",
      },
      {
        id: "s3",
        heading: "The Staged Verification Model",
        content: "tenant-tail implements three verification verbs, each checking a different layer of the governance claim:\n\n1. **verify-certificate**: Checks the certificate's structural validity, signature, and internal consistency. This is the fastest check and answers: \"Is this certificate well-formed and authentically signed?\"\n\n2. **verify-provenance**: Checks that the certificate's corpus binding matches the current spec-spine registry. This answers: \"Was this artifact built against the spec corpus it claims?\"\n\n3. **verify-sbom**: Checks that the SBOM hash in the certificate matches the actual CycloneDX BOM. This answers: \"Does the supply chain match what was declared?\"\n\nEach verb can be run independently. A CI pipeline might run all three; a quick spot-check might run only verify-certificate. The staged model allows verification depth to match the trust requirement of the context.",
        specBinding: "spec-219 § 3.1",
        contentHash: "e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1",
      },
      {
        id: "s4",
        heading: "Why Separation is Load-Bearing",
        content: "The separation between tenant-emit and tenant-tail is not a convenience, it is a security property. If the emitter and verifier share code, a bug in shared code compromises both production and verification. If they share dependencies, a supply-chain attack on a shared dependency compromises the entire trust chain.\n\nBy keeping them as distinct distributables with no shared code:\n\n- A compromised emitter cannot produce certificates that pass an uncompromised verifier\n- A bug in the emitter's signing logic does not affect the verifier's signature checking\n- The verifier can be audited independently of the emitter\n- Different teams can maintain each tool without coordination beyond the certificate schema\n\nThis is the same principle that separates a compiler from a decompiler, or a lock from a key. The tools are complementary, not coupled.",
        specBinding: "spec-219 § 4.2 / spec-220 § 2.1",
        contentHash: "f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2",
      },
    ],
    auditTrail: [
      { timestamp: "2026-06-26T09:00:00Z", action: "spec-authored", actor: "trust-team", specRef: "spec-219 v0.4.0", hash: "a2b3c4d5..." },
      { timestamp: "2026-06-28T11:30:00Z", action: "content-drafted", actor: "trust-team", specRef: "spec-219 v0.4.0", hash: "b3c4d5e6..." },
      { timestamp: "2026-06-29T14:00:00Z", action: "coupling-gate-pass", actor: "ci-pipeline", specRef: "spec-219 v0.4.0", hash: "c4d5e6f7..." },
      { timestamp: "2026-06-30T11:00:00Z", action: "certificate-emitted", actor: "tenant-emit", specRef: "spec-219 v0.4.0", hash: "d5e6f7a8..." },
      { timestamp: "2026-07-04T06:00:00Z", action: "certificate-verified", actor: "tenant-tail", specRef: "spec-219 v0.4.0", hash: "e6f7a8b9..." },
    ],
    certificate: {
      version: "1.0.0",
      specSpineAttestation: "d0e6f3a4b7c9d1e3f5a7b9c1d3e5f7a9b1c3d5e7f9a1b3c5d7e9f1a3b5c7d9e1",
      sbomHash: "a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8",
      signatureAlgorithm: "Ed25519",
      signerIdentity: "trust-verification@statecraft.ing",
      issuedAt: "2026-06-30T11:00:00Z",
      expiresAt: "2027-06-30T11:00:00Z",
    },
  },
  {
    id: "wp-005",
    slug: "bootstrap-provisioning",
    title: "From Zero to Governed: The Bootstrap Path",
    subtitle: "Standing up an OAP instance with one resumable CLI",
    abstract: "oap-bootstrap eliminates the multi-hour manual choreography of standing up a governed platform instance. One CLI, eight idempotent phases, from an empty GitHub org to a verified K3s cluster running the full OAP stack. This paper documents the provisioning architecture, the idempotency model, and the verification step that proves the instance is correctly governed.",
    governingSpec: {
      id: "spec-001",
      title: "oap-instance-bootstrap-cli",
      version: "1.1.0",
      sha256: "e1f7a4b5c8d0e2f4a6b8c0d2e4f6a8b0c2d4e6f8a0b2c4d6e8f0a2b4c6d8e0f2",
    },
    contentHash: "c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9",
    status: "published",
    publishedAt: "2026-07-02T14:00:00Z",
    lastVerifiedAt: "2026-07-04T06:00:00Z",
    authors: ["Infrastructure Team"],
    tags: ["oap-bootstrap", "provisioning", "k3s", "idempotent"],
    sections: [
      {
        id: "s1",
        heading: "The Choreography Problem",
        content: "Standing up a governed platform instance involves dozens of coordinated steps: forking repositories, registering GitHub Apps, generating secrets, provisioning infrastructure, configuring DNS, setting up identity providers, deploying services, and verifying the result. Each step depends on outputs from previous steps. Each step can fail. Each failure requires diagnosis and retry.\n\nDone manually, this takes hours. Done repeatedly (for staging, production, disaster recovery), it becomes a significant operational burden. Done inconsistently, it produces instances that differ in subtle ways, defeating the governance guarantees the platform is designed to provide.\n\noap-bootstrap replaces this choreography with a single resumable CLI that encodes the entire provisioning sequence as eight idempotent phases.",
        specBinding: "spec-001 § 1.1",
        contentHash: "d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0",
      },
      {
        id: "s2",
        heading: "Eight Idempotent Phases",
        content: "The bootstrap process consists of eight phases, each idempotent (detect-or-create):\n\n1. **init**: Generate configuration from user inputs, create the state directory\n2. **doctor**: Validate all required tools (gh, kubectl, helm, sops, age) are present and configured\n3. **github**: Fork OAP repos into the target org, register the GitHub App, wire webhooks\n4. **cluster**: Provision Hetzner K3s nodes, install base infrastructure (cert-manager, ingress)\n5. **dns**: Configure DNS records for the platform domain\n6. **identity**: Deploy Rauthy OIDC, create initial admin user, configure clients\n7. **platform**: Deploy the OAP platform services (deployd-api, statecraft, spec-spine CI)\n8. **verify**: Run tenant-tail against the deployed instance to confirm governance integrity\n\nEach phase checks whether its work has already been done before attempting it. Re-running a phase is how you resume after a fix. There is no \"rollback\", only \"re-run with the problem fixed.\"",
        specBinding: "spec-001 § 2.1",
        contentHash: "e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1",
      },
      {
        id: "s3",
        heading: "Secrets Architecture",
        content: "Secrets are encrypted at rest using SOPS with age keys. The bootstrap state directory contains encrypted secret files that can be safely committed to a private repository.\n\nThe secrets lifecycle:\n\n1. **Generation**: oap-bootstrap generates secrets (GitHub App private keys, OIDC client secrets, database passwords) during the relevant phase\n2. **Encryption**: Secrets are immediately encrypted with the operator's age public key\n3. **Storage**: Encrypted secrets are written to the state directory\n4. **Deployment**: During cluster provisioning, secrets are decrypted in memory and injected as Kubernetes secrets\n5. **Rotation**: Re-running a phase with --rotate-secrets generates new secrets without disrupting the running instance\n\nThe operator's age private key never leaves their machine. The state directory can be stored in version control without exposing secrets. Recovery requires only the age private key and the state directory.",
        specBinding: "spec-001 § 3.2",
        contentHash: "f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2",
      },
      {
        id: "s4",
        heading: "The Verify Phase",
        content: "The final phase, verify, is not optional. It runs tenant-tail against the deployed instance to confirm that:\n\n- The deployed spec-spine registry matches the expected attestation hash\n- The deployed services match their governance certificates\n- The OIDC configuration is correctly bound to the platform identity\n- The CI pipeline is correctly configured to enforce the coupling gate\n\nIf verification fails, the bootstrap reports exactly which check failed and what the expected vs. actual values are. The operator fixes the issue and re-runs the verify phase.\n\nThis verification step closes the loop: the instance is not just provisioned, it is proven governed. The same tenant-tail that verifies individual artifacts also verifies the platform instance itself.",
        specBinding: "spec-001 § 4.1 / spec-219 § 5.2",
        contentHash: "a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3",
      },
    ],
    auditTrail: [
      { timestamp: "2026-06-28T10:00:00Z", action: "spec-authored", actor: "infra-team", specRef: "spec-001 v1.1.0", hash: "b3c4d5e6..." },
      { timestamp: "2026-07-01T09:30:00Z", action: "content-drafted", actor: "infra-team", specRef: "spec-001 v1.1.0", hash: "c4d5e6f7..." },
      { timestamp: "2026-07-01T16:00:00Z", action: "coupling-gate-pass", actor: "ci-pipeline", specRef: "spec-001 v1.1.0", hash: "d5e6f7a8..." },
      { timestamp: "2026-07-02T14:00:00Z", action: "certificate-emitted", actor: "tenant-emit", specRef: "spec-001 v1.1.0", hash: "e6f7a8b9..." },
      { timestamp: "2026-07-04T06:00:00Z", action: "certificate-verified", actor: "tenant-tail", specRef: "spec-001 v1.1.0", hash: "f7a8b9c0..." },
    ],
    certificate: {
      version: "1.0.0",
      specSpineAttestation: "e1f7a4b5c8d0e2f4a6b8c0d2e4f6a8b0c2d4e6f8a0b2c4d6e8f0a2b4c6d8e0f2",
      sbomHash: "b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9",
      signatureAlgorithm: "Ed25519",
      signerIdentity: "infrastructure-team@statecraft.ing",
      issuedAt: "2026-07-02T14:00:00Z",
      expiresAt: "2027-07-02T14:00:00Z",
    },
  },
];

export function getPaperBySlug(slug: string): Paper | undefined {
  return papers.find((p) => p.slug === slug);
}

export function getAllPapers(): Paper[] {
  return papers;
}

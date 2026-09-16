export interface Section {
  id: string;
  number: string;
  title: string;
  subsections: Subsection[];
}

export interface Subsection {
  id: string;
  title: string;
  content: string[];
}

export const paperMeta = {
  title: "Open Agentic Platform Ecosystem",
  subtitle: "A Comprehensive White Paper",
  author: "Bartek Kus",
  date: "July 4, 2026",
  abstract:
    "The Open Agentic Platform (OAP) represents a paradigm shift in how artificial intelligence is deployed within software delivery pipelines. Moving beyond simple AI assistance, OAP establishes a governed operating system for AI-native delivery. This white paper explores the architecture, governance model, and execution mechanisms that make OAP a secure, scalable, and verifiable platform.",
};

export const sections: Section[] = [
  {
    id: "spec-spine",
    number: "01",
    title: "The Spec Spine: The Unit of Governance",
    subsections: [
      {
        id: "graph-of-authority",
        title: "The Graph of Authority",
        content: [
          "The foundation of the Open Agentic Platform is the \"spec spine.\" Unlike traditional documentation that often drifts from the actual codebase, the spec spine serves as the authoritative design record. Every feature, refactor, or infrastructure change is anchored to a specific markdown document that explicitly declares its territory. [ref:2]",
          "Every piece of work in the repository is bound to a small markdown document that declares its territory. This territory is not a vague description; it is an explicit list of code paths combined with a set of typed relationships to the other documents that have touched those paths before. Together, these documents form a graph, and this graph is the absolute source of truth regarding who is allowed to change what.",
          "A document declares its relationship to others using typed edges: **establishes** (the document that first brought this code into being), **extends** (adds surface to a predecessor's territory without disturbing it), **refines** (tightens behavior on a specific aspect), **supersedes** (replaces a predecessor, partially or fully), **amends** (patches a predecessor in place), **co_authority** (shares a path with another document on a named section), and **constrains** (asserts an invariant that everyone else must respect).",
          "These edges turn the corpus from a flat pile of claims into a directed graph. Authority over any given path is derived by walking the graph, rather than being declared directly. [ref:1]",
        ],
      },
      {
        id: "safe-parallel-work",
        title: "Enabling Safe Parallel Work",
        content: [
          "This design enables safe parallel work across multiple agents. Disjoint territory is provably disjoint. Two agents working on documents that establish or refine non-overlapping paths cannot collide by construction. The graph informs them of their boundaries before either agent edits a single line of code.",
          "When two documents must touch the same path, they declare co-authority section-by-section, utilizing named anchors. The potential collision becomes a structured merge rather than a free-for-all. Furthermore, history remains queryable. An amendment does not overwrite its predecessor; it patches it in place, and consumers view the patched version.",
        ],
      },
      {
        id: "mechanical-enforcement",
        title: "Mechanical Enforcement",
        content: [
          "Three distinct guardrails sit on top of the graph to ensure compliance. First, a **deterministic compiler** reads the markdown corpus and emits a frozen JSON registry. Second, a **coupling gate** at pull request time cross-references every modified code path against the graph. If an agent modifies a path without also updating the document that holds authority over it, continuous integration refuses the merge. Third, a **refusal rule** at prompt time prevents an agent from resolving a coupling-gate failure by quietly editing the contract to match the newly written code.",
          "The spec spine is what makes managing many agents working in parallel tractable. The contract is the substrate, the compiler enforces its shape, the consumer binaries enforce its reads, the gates enforce its truthfulness at pull request time, and the refusal rule enforces its truthfulness at prompt time.",
        ],
      },
    ],
  },
  {
    id: "governed-execution",
    number: "02",
    title: "Governed Agent Execution",
    subsections: [
      {
        id: "off-platform-compute",
        title: "The Off-Platform Compute Plane",
        content: [
          "Agent execution within the Open Agentic Platform is heavily governed. Agents do not operate with unbound autonomy; instead, they act strictly through scoped tools, policy gates, and permission tiers.",
          "The off-platform compute plane (OPC) is the local desktop cockpit where humans and agents share a single execution surface. It hosts a governed Model Context Protocol (MCP) server named `axiomregent`, which sits at the centre of every agent session. [ref:8]",
          "`axiomregent` dispatches tools under defined safety tiers and acquires distributed worktree locks on mutating tools. A duplex bus links the OPC to the platform, providing frame-integrity guarantees.",
        ],
      },
      {
        id: "policy-permissions",
        title: "Policy and Permissions",
        content: [
          "Agent actions are executed through scoped, tiered tools registered in the tool registry and enforced by the `policy-kernel`. Every action remains traceable back to the specific spec that authorized it.",
          "The runtime governance model relies on tiered tools, distributed locks, and policy-kernel scopes that constrain what an agent can do precisely as it does it. This architecture ensures that agents operate within defined boundaries, preventing unexpected or unauthorized modifications to the system state, directly addressing risks such as Agent Goal Hijack and Tool Misuse. [ref:3]",
        ],
      },
    ],
  },
  {
    id: "governance-certificate",
    number: "03",
    title: "The Governance Certificate",
    subsections: [
      {
        id: "artifact-of-truth",
        title: "The Artifact of Truth",
        content: [
          "Compliance in an agentic system requires verifiable proof, not merely promises. The Open Agentic Platform delivers this proof through the Governance Certificate, a single artifact that captures the entire audit chain.",
          "Every factory run emits a self-authenticating `governance-certificate.json`. This document cryptographically binds the requirements hash, the frozen Build Spec hash, per-stage artifact hashes, and the certificate's own SHA-256 into one auditable JSON file.",
          "The certificate is the load-bearing artifact for compliance. It provides a structured, deterministic, and reproducible record of the execution pipeline, mapping directly to OWASP ASI 2026 controls. [ref:6]",
        ],
      },
      {
        id: "independent-verification",
        title: "Independent Verification",
        content: [
          "Crucially, the companion verifier does not trust the system that produced the certificate. An auditor can run the verification tool entirely independently. It reads the certificate and the artifact directory, recalculates all hashes, and verifies the signatures.",
          "If any artifact has been tampered with, the verifier rejects the certificate with a specific diagnostic indicating the exact hash mismatch. This cryptographic proof ensures that the execution record remains immutable and trustworthy.",
        ],
      },
    ],
  },
  {
    id: "identity-collaboration",
    number: "04",
    title: "Identity-Bounded Collaboration",
    subsections: [
      {
        id: "federated-identity",
        title: "Federated Identity",
        content: [
          "Collaboration between humans and agents requires a unified and robust trust fabric. The Open Agentic Platform implements identity-bounded collaboration to secure the control plane.",
          "Identity management uses Rauthy as the sole OpenID Connect (OIDC) session signer. GitHub acts as an upstream identity provider for Rauthy. A developer's GitHub login is federated through Rauthy, ensuring a single, centralized source of identity truth. [ref:5]",
          "Rauthy issues OIDC tokens that carry specific scopes. These scopes define the precise permissions granted to the user or agent within the platform.",
        ],
      },
      {
        id: "scope-enforcement",
        title: "Scope Enforcement",
        content: [
          "The `deployd-api` service enforces scope at every request against the Rauthy-issued JSON Web Tokens (JWTs). The spec spine defines exactly what each scope is allowed to authorize.",
          "Stakeholder access to a deployed application is strictly gated. The platform provides passwordless OIDC over an admin-managed email allowlist, ensuring that only explicitly authorized individuals can interact with the deployed environments.",
        ],
      },
    ],
  },
  {
    id: "factory-pipeline",
    number: "05",
    title: "The Factory Pipeline",
    subsections: [
      {
        id: "phase-process",
        title: "Phase 1: Process",
        content: [
          "The Factory delivery engine is the mechanism that transforms business requirements into production code. It operates through a deterministic, two-phase pipeline. [ref:4]",
          "The process phase consists of six sequential stages, each driven by a specialized AI agent: **Preflight** validates documents, adapters, and dependencies. **Business Requirements** extracts entities, use cases, and audiences. **Service Requirements** designs services, rules, and integrations. **Data Model** generates the data model from the extracted entities. **API Spec** specifies API operations. **UI Spec** specifies UI pages and produces the final Build Spec.",
          "This phase produces the Build Spec. After human approval, the Build Spec is frozen, hashed, and becomes the immutable input for the subsequent phase.",
        ],
      },
      {
        id: "phase-scaffolding",
        title: "Phase 2: Scaffolding",
        content: [
          "The scaffolding phase is a dynamic fan-out generated directly from the Build Spec content. It begins with **Scaffold Init**, which copies the adapter base and verifies compilation. Then **Data Entities** generates data entities (one step per entity). **API Operations** generates API operations (one step per resource). **UI Pages** generates UI pages (one step per page). **Configure** wires configuration, authentication, and environment variables. **Trim** removes unused scaffold files. **Final Validation** performs a full build, test, lint, and type-check.",
          "Each step runs post-verification commands and retries on failure, ensuring a robust and reliable code generation process. The entire pipeline is deterministic: given the same Build Spec, the same code is produced every time.",
        ],
      },
    ],
  },
  {
    id: "owasp-asi-compliance",
    number: "06",
    title: "OWASP ASI 2026 Compliance Mapping",
    subsections: [
      {
        id: "asi-framework-overview",
        title: "The ASI Framework",
        content: [
          "The OWASP Agentic Security Initiative (ASI) 2026 defines a comprehensive set of controls for securing AI agent systems. The framework addresses the unique risks introduced when autonomous agents interact with tools, data, and external services. The Open Agentic Platform was designed with these controls as first-class architectural constraints, not retrofitted compliance checkboxes. [ref:6]",
          "ASI 2026 organizes its controls into several categories: **Agent Identity and Authentication**, **Tool and Action Authorization**, **Data Boundary Enforcement**, **Audit and Observability**, **Supply Chain Integrity**, and **Human Oversight Mechanisms**. Each category maps directly to specific OAP subsystems.",
        ],
      },
      {
        id: "control-mapping",
        title: "Control-to-Architecture Mapping",
        content: [
          "**ASI-AUTH-01 (Agent Identity)** maps to OAP's Rauthy OIDC federation. Every agent session carries a scoped JWT issued by a centralized identity provider. There is no anonymous agent execution.",
          "**ASI-AUTH-02 (Tool Authorization)** maps to the tiered tool registry and `policy-kernel` enforcement. Each tool declares its safety tier, and the kernel validates scope before dispatch. This directly prevents Tool Misuse (ASI-TOOL-03).",
          "**ASI-DATA-01 (Data Boundary)** maps to the spec spine's territory declarations. An agent cannot read or write code paths outside its declared territory. The coupling gate enforces this at merge time, and the refusal rule enforces it at prompt time.",
          "**ASI-AUDIT-01 (Execution Traceability)** maps to the governance certificate. Every factory run produces a SHA-256 hash chain binding requirements to artifacts. The independent verifier satisfies the \"third-party audit\" requirement without trusting the producing system.",
          "**ASI-SUPPLY-01 (Supply Chain Integrity)** maps to the deterministic compiler and frozen JSON registry. The spec corpus is compiled into an immutable artifact before any code generation begins. Tampering with upstream specifications is detectable by hash comparison.",
          "**ASI-HUMAN-01 (Human Oversight)** maps to the two-phase factory pipeline. Phase 1 produces the Build Spec, which requires explicit human approval before Phase 2 (code generation) begins. No code is produced without a human-approved, frozen specification.",
        ],
      },
      {
        id: "continuous-compliance",
        title: "Continuous Compliance",
        content: [
          "OAP does not treat compliance as a periodic audit event. The governance certificate is emitted on every factory run, creating a continuous compliance record. Each certificate is independently verifiable, meaning an auditor can validate any historical run without access to the live system.",
          "The coupling gate runs on every pull request, ensuring that no code change bypasses the governance model. The refusal rule operates at prompt time, preventing agents from circumventing controls in real-time. Together, these mechanisms provide **continuous, mechanical compliance** rather than point-in-time assessments.",
          "This architecture positions OAP to satisfy not only OWASP ASI 2026 but also emerging regulatory frameworks that require demonstrable AI governance, including the EU AI Act's requirements for high-risk AI system documentation [ref:9] and the NIST AI Risk Management Framework's emphasis on traceable decision-making. [ref:10]",
        ],
      },
    ],
  },
];

export const tableOfContents = sections.map((s) => ({
  id: s.id,
  number: s.number,
  title: s.title,
  subsections: s.subsections.map((sub) => ({
    id: sub.id,
    title: sub.title,
  })),
}));

export const complianceTable = [
  {
    control: "ASI-AUTH-01",
    name: "Agent Identity",
    oapSubsystem: "Rauthy OIDC Federation",
    mechanism: "Scoped JWT per agent session; no anonymous execution",
    status: "full",
  },
  {
    control: "ASI-AUTH-02",
    name: "Tool Authorization",
    oapSubsystem: "Policy Kernel + Tool Registry",
    mechanism: "Tiered tools with scope validation before dispatch",
    status: "full",
  },
  {
    control: "ASI-TOOL-03",
    name: "Tool Misuse Prevention",
    oapSubsystem: "Policy Kernel",
    mechanism: "Safety tiers + distributed worktree locks",
    status: "full",
  },
  {
    control: "ASI-DATA-01",
    name: "Data Boundary",
    oapSubsystem: "Spec Spine Territory",
    mechanism: "Coupling gate at CI + refusal rule at prompt time",
    status: "full",
  },
  {
    control: "ASI-AUDIT-01",
    name: "Execution Traceability",
    oapSubsystem: "Governance Certificate",
    mechanism: "SHA-256 hash chain binding requirements to artifacts",
    status: "full",
  },
  {
    control: "ASI-SUPPLY-01",
    name: "Supply Chain Integrity",
    oapSubsystem: "Deterministic Compiler",
    mechanism: "Frozen JSON registry; hash-detectable tampering",
    status: "full",
  },
  {
    control: "ASI-HUMAN-01",
    name: "Human Oversight",
    oapSubsystem: "Factory Pipeline (Phase 1)",
    mechanism: "Build Spec requires human approval before code generation",
    status: "full",
  },
  {
    control: "ASI-LOG-01",
    name: "Audit Logging",
    oapSubsystem: "Governance Certificate + Verifier",
    mechanism: "Independent verification without trusting producing system",
    status: "full",
  },
];

export interface Reference {
  id: number;
  label: string;
  title: string;
  url: string;
  accessed: string;
}

export const references: Reference[] = [
  {
    id: 1,
    label: "OAP-ARCH",
    title: "Open Agentic Platform: Architecture Overview",
    url: "https://github.com/statecrafting/open-agentic-platform/blob/main/docs/ARCHITECTURE.md",
    accessed: "July 2026",
  },
  {
    id: 2,
    label: "OAP-SPINE",
    title: "The Spec Spine in Detail",
    url: "https://github.com/statecrafting/open-agentic-platform/blob/main/docs/spec-spine-in-detail.md",
    accessed: "July 2026",
  },
  {
    id: 3,
    label: "OAP-GOV",
    title: "Spec 102: Governance Model",
    url: "https://github.com/statecrafting/open-agentic-platform/blob/main/specs/102-governance-model/",
    accessed: "July 2026",
  },
  {
    id: 4,
    label: "OAP-FACTORY",
    title: "Spec 103: Factory Pipeline",
    url: "https://github.com/statecrafting/open-agentic-platform/blob/main/specs/103-factory-pipeline/",
    accessed: "July 2026",
  },
  {
    id: 5,
    label: "OAP-IDENTITY",
    title: "Spec 104: Identity and Access (Rauthy OIDC)",
    url: "https://github.com/statecrafting/open-agentic-platform/blob/main/specs/104-identity-access/",
    accessed: "July 2026",
  },
  {
    id: 6,
    label: "OWASP-ASI",
    title: "OWASP Agentic Security Initiative (ASI) 2026",
    url: "https://owasp.org/www-project-agentic-security-initiative/",
    accessed: "July 2026",
  },
  {
    id: 7,
    label: "OAP-OVERVIEW",
    title: "Open Agentic Platform: Project Overview",
    url: "https://github.com/statecrafting/open-agentic-platform/blob/main/docs/OVERVIEW.md",
    accessed: "July 2026",
  },
  {
    id: 8,
    label: "MCP-SPEC",
    title: "Model Context Protocol Specification",
    url: "https://modelcontextprotocol.io/specification",
    accessed: "July 2026",
  },
  {
    id: 9,
    label: "EU-AI-ACT",
    title: "EU Artificial Intelligence Act: High-Risk AI Systems",
    url: "https://artificialintelligenceact.eu/",
    accessed: "July 2026",
  },
  {
    id: 10,
    label: "NIST-RMF",
    title: "NIST AI Risk Management Framework (AI RMF 1.0)",
    url: "https://www.nist.gov/artificial-intelligence/ai-risk-management-framework",
    accessed: "July 2026",
  },
];

export interface ChangelogEntry {
  version: string;
  date: string;
  changes: string[];
}

export const changelog: ChangelogEntry[] = [
  {
    version: "1.0.0",
    date: "July 4, 2026",
    changes: [
      "Initial publication covering six core sections",
      "Architecture diagrams for spec spine, factory pipeline, and identity flow",
      "OWASP ASI 2026 compliance mapping with full control table",
    ],
  },
  {
    version: "0.9.0",
    date: "June 28, 2026",
    changes: [
      "Added Section 06: OWASP ASI 2026 Compliance Mapping",
      "Inline footnote citations linking to references",
      "Print-optimized stylesheet for paper output",
    ],
  },
  {
    version: "0.8.0",
    date: "June 21, 2026",
    changes: [
      "Expanded governance certificate section with verification details",
      "Added factory pipeline two-phase breakdown",
      "Identity-bounded collaboration section with Rauthy OIDC details",
    ],
  },
  {
    version: "0.5.0",
    date: "June 7, 2026",
    changes: [
      "Initial draft: spec spine architecture and governed execution model",
      "Abstract and core terminology established",
      "Internal review cycle begun",
    ],
  },
];

export interface CodeSnippet {
  id: string;
  sectionId: string;
  title: string;
  language: string;
  code: string;
  caption: string;
}

export const codeSnippets: CodeSnippet[] = [
  {
    id: "spec-spine-yaml",
    sectionId: "spec-spine",
    title: "Spec Document Declaration",
    language: "yaml",
    code: `# specs/103-factory-pipeline/SPEC.md (frontmatter)
id: "103-factory-pipeline"
title: "Factory Pipeline"
status: active
territory:
  - crates/factory-engine/**
  - crates/factory-stages/**
  - specs/103-factory-pipeline/**
edges:
  establishes:
    - crates/factory-engine/src/lib.rs
    - crates/factory-stages/src/lib.rs
  extends:
    - ref: "101-spec-spine"
      paths: [crates/spine-compiler/src/registry.rs]
  constrains:
    - ref: "102-governance-model"
      invariant: "certificate_emission_required"`,
    caption: "Each spec declares its territory (code paths) and typed edges to other specs, forming the governance graph.",
  },
  {
    id: "governance-cert-json",
    sectionId: "governance-certificate",
    title: "Governance Certificate Structure",
    language: "json",
    code: `{
  "certificate_version": "1.0.0",
  "run_id": "factory-run-2026-07-04T14:32:00Z",
  "requirements_hash": "sha256:a3f8c9...",
  "build_spec_hash": "sha256:7b2e41...",
  "stages": [
    {
      "name": "preflight",
      "status": "passed",
      "artifact_hash": "sha256:d4c1f2...",
      "duration_ms": 1240
    },
    {
      "name": "business_requirements",
      "status": "passed",
      "artifact_hash": "sha256:e8a3b7...",
      "duration_ms": 3420
    },
    {
      "name": "scaffold_init",
      "status": "passed",
      "artifact_hash": "sha256:f1d9c4...",
      "duration_ms": 8910
    }
  ],
  "certificate_hash": "sha256:9c7a2d...",
  "signature": "ed25519:Kx8mP2..."
}`,
    caption: "The governance certificate cryptographically binds every stage artifact to the original requirements, creating an immutable audit chain.",
  },
  {
    id: "policy-kernel-config",
    sectionId: "governed-execution",
    title: "Policy Kernel Tool Registry",
    language: "toml",
    code: `# config/policy-kernel.toml
[tool_registry]
version = "2.1.0"

[[tools]]
name = "file_write"
safety_tier = "mutating"
requires_lock = true
scope = "territory_bound"
max_concurrent = 1

[[tools]]
name = "file_read"
safety_tier = "readonly"
requires_lock = false
scope = "territory_bound"

[[tools]]
name = "shell_exec"
safety_tier = "restricted"
requires_lock = true
scope = "explicit_allowlist"
approval_required = true

[locks]
backend = "distributed"
ttl_seconds = 300
retry_attempts = 3`,
    caption: "The policy kernel enforces tiered tool access. Mutating tools require distributed locks; restricted tools need explicit approval.",
  },
  {
    id: "identity-oidc-flow",
    sectionId: "identity-collaboration",
    title: "OIDC Token Scope Example",
    language: "json",
    code: `{
  "iss": "https://auth.oap.internal/rauthy",
  "sub": "agent:factory-stage-preflight",
  "aud": "deployd-api",
  "exp": 1720108800,
  "iat": 1720105200,
  "scope": "spec:read artifact:write certificate:emit",
  "territory": ["crates/factory-stages/preflight/**"],
  "session_id": "sess_7f3a2b9c",
  "upstream_idp": "github",
  "upstream_sub": "user:12345"
}`,
    caption: "Rauthy-issued JWTs carry territory-scoped permissions. The deployd-api validates these claims on every request.",
  },
];

export interface RelatedLink {
  sectionId: string;
  title: string;
  url: string;
  source: string;
}

export const relatedReading: RelatedLink[] = [
  {
    sectionId: "spec-spine",
    title: "Spec Spine in Detail",
    url: "https://github.com/statecrafting/open-agentic-platform/blob/main/docs/spec-spine-in-detail.md",
    source: "OAP Docs",
  },
  {
    sectionId: "spec-spine",
    title: "Architecture Overview",
    url: "https://github.com/statecrafting/open-agentic-platform/blob/main/docs/ARCHITECTURE.md",
    source: "OAP Docs",
  },
  {
    sectionId: "governed-execution",
    title: "Model Context Protocol",
    url: "https://modelcontextprotocol.io/specification",
    source: "MCP Spec",
  },
  {
    sectionId: "governed-execution",
    title: "OPC Desktop Cockpit",
    url: "https://github.com/statecrafting/open-agentic-platform/blob/main/product/apps/opc/README.md",
    source: "OAP Product",
  },
  {
    sectionId: "governance-certificate",
    title: "Governance Model Spec",
    url: "https://github.com/statecrafting/open-agentic-platform/blob/main/specs/102-governance-model/",
    source: "OAP Specs",
  },
  {
    sectionId: "governance-certificate",
    title: "OWASP ASI Initiative",
    url: "https://owasp.org/www-project-agentic-security-initiative/",
    source: "OWASP",
  },
  {
    sectionId: "identity-collaboration",
    title: "Identity & Access Spec",
    url: "https://github.com/statecrafting/open-agentic-platform/blob/main/specs/104-identity-access/",
    source: "OAP Specs",
  },
  {
    sectionId: "identity-collaboration",
    title: "Rauthy OIDC Provider",
    url: "https://github.com/sebadob/rauthy",
    source: "GitHub",
  },
  {
    sectionId: "factory-pipeline",
    title: "Factory Pipeline Spec",
    url: "https://github.com/statecrafting/open-agentic-platform/blob/main/specs/103-factory-pipeline/",
    source: "OAP Specs",
  },
  {
    sectionId: "factory-pipeline",
    title: "Project Overview",
    url: "https://github.com/statecrafting/open-agentic-platform/blob/main/docs/OVERVIEW.md",
    source: "OAP Docs",
  },
  {
    sectionId: "owasp-asi-compliance",
    title: "OWASP ASI 2026 Controls",
    url: "https://owasp.org/www-project-agentic-security-initiative/",
    source: "OWASP",
  },
  {
    sectionId: "owasp-asi-compliance",
    title: "EU AI Act Requirements",
    url: "https://artificialintelligenceact.eu/",
    source: "EU AI Act",
  },
  {
    sectionId: "owasp-asi-compliance",
    title: "NIST AI RMF",
    url: "https://www.nist.gov/artificial-intelligence/ai-risk-management-framework",
    source: "NIST",
  },
];

/* ─── Comparison Table: OAP vs Traditional Approaches ─── */
export const comparisonTable = {
  title: "OAP vs. Traditional Delivery Approaches",
  description: "How the Open Agentic Platform compares to established software delivery paradigms across key governance and execution dimensions.",
  dimensions: [
    "Governance Model",
    "Change Authorization",
    "Audit Trail",
    "AI Agent Role",
    "Compliance Verification",
    "Parallel Work Safety",
    "Deployment Confidence",
  ] as const,
  approaches: [
    {
      name: "Traditional CI/CD",
      values: [
        "Branch protection rules + code owners",
        "Human PR approval",
        "Git log + pipeline history",
        "None or ad-hoc copilot",
        "Manual checklist / periodic audit",
        "Merge conflicts resolved manually",
        "Test suite pass/fail",
      ],
    },
    {
      name: "GitOps",
      values: [
        "Declarative desired-state in repo",
        "PR merge triggers reconciliation",
        "Git history + reconciler logs",
        "None (human-authored manifests)",
        "Policy-as-code (OPA/Kyverno)",
        "Separate repos per team/env",
        "Drift detection + auto-reconcile",
      ],
    },
    {
      name: "AI-Assisted (Copilot-era)",
      values: [
        "Same as CI/CD (unchanged)",
        "Human reviews AI suggestions",
        "Standard git log",
        "Code suggestion / completion",
        "No additional mechanism",
        "No structural guarantee",
        "Same test suite (no AI-aware checks)",
      ],
    },
    {
      name: "OAP (Governed Agentic)",
      values: [
        "Spec spine graph + typed edges",
        "Coupling gate + refusal rule",
        "Governance certificate (signed JSON)",
        "First-class autonomous executor",
        "Continuous (compiler + gate + cert)",
        "Provably disjoint territory",
        "Cryptographic certificate per artifact",
      ],
      highlight: true,
    },
  ],
};

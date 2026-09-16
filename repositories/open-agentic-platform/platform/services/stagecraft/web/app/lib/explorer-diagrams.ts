export const specSpineExplorer = {
  title: "Figure 1: Spec Spine: The Graph of Authority",
  caption: "Click any node to explore its role. The spec spine forms a directed graph where typed edges connect specs to code paths, enforced by the deterministic compiler and coupling gate.",
  viewBox: "0 0 700 320",
  nodes: [
    { id: "spec-doc", label: "Spec Document", x: 20, y: 130, width: 120, height: 52, description: "A markdown document declaring territory (code paths) and typed edges to other specs. Each spec is the authoritative design record for its territory.", color: "oklch(0.20 0.04 195)" },
    { id: "territory", label: "Territory", x: 180, y: 50, width: 100, height: 46, description: "Explicit list of code paths owned by this spec. Territory is provably disjoint across specs, enabling safe parallel work by multiple agents.", color: "oklch(0.18 0.03 260)" },
    { id: "typed-edges", label: "Typed Edges", x: 180, y: 210, width: 100, height: 46, description: "Relationships like establishes, extends, refines, supersedes, amends, co_authority, and constrains. These edges form the directed graph of authority.", color: "oklch(0.18 0.03 260)" },
    { id: "compiler", label: "Deterministic Compiler", x: 330, y: 125, width: 140, height: 52, description: "Reads the entire markdown corpus and emits a frozen JSON registry. This registry is the machine-readable representation of the governance graph.", color: "oklch(0.22 0.06 195)" },
    { id: "json-registry", label: "JSON Registry", x: 530, y: 55, width: 120, height: 46, description: "The frozen output of the compiler: a complete, deterministic snapshot of all specs, territories, and edges. Used by the coupling gate at CI time.", color: "oklch(0.18 0.03 260)" },
    { id: "coupling-gate", label: "Coupling Gate", x: 530, y: 135, width: 120, height: 52, description: "Runs at pull-request time. Cross-references every modified code path against the graph. Refuses the merge if an agent modifies a path without updating the owning spec.", color: "oklch(0.22 0.06 195)" },
    { id: "refusal-rule", label: "Refusal Rule", x: 530, y: 225, width: 120, height: 46, description: "Prevents agents from resolving coupling-gate failures by editing the contract to match new code. The spec must be updated intentionally, not as an afterthought.", color: "oklch(0.22 0.04 15)" },
  ],
  edges: [
    { from: "spec-doc", to: "territory", label: "declares" },
    { from: "spec-doc", to: "typed-edges", label: "declares" },
    { from: "spec-doc", to: "compiler", label: "feeds" },
    { from: "compiler", to: "json-registry", label: "emits" },
    { from: "compiler", to: "coupling-gate", label: "powers" },
    { from: "coupling-gate", to: "refusal-rule", label: "triggers" },
  ],
};

export const factoryPipelineExplorer = {
  title: "Figure 2: Factory Pipeline: Two-Phase Delivery",
  caption: "Click any node to explore its role. The factory pipeline transforms business requirements into production code through two deterministic phases, emitting a governance certificate at completion.",
  viewBox: "0 0 720 320",
  nodes: [
    { id: "requirements", label: "Business Requirements", x: 10, y: 130, width: 130, height: 52, description: "Natural-language business requirements provided by the human stakeholder. These are the input to Phase 1 and are never modified by agents.", color: "oklch(0.20 0.04 80)" },
    { id: "phase1", label: "Phase 1: Process", x: 180, y: 70, width: 120, height: 52, description: "Transforms business requirements into a structured Build Spec. Involves preflight checks, requirement decomposition, and architecture planning. Output is frozen after human approval.", color: "oklch(0.22 0.06 195)" },
    { id: "build-spec", label: "Build Spec", x: 340, y: 70, width: 110, height: 46, description: "The frozen intermediate artifact produced by Phase 1. Contains structured tasks, architecture decisions, and acceptance criteria. Immutable once approved.", color: "oklch(0.18 0.03 260)" },
    { id: "human-gate", label: "Human Approval", x: 340, y: 145, width: 110, height: 46, description: "A mandatory checkpoint between Phase 1 and Phase 2. The human reviews the Build Spec and either approves (freezing it) or requests changes. No code is written until approval.", color: "oklch(0.22 0.04 15)" },
    { id: "phase2", label: "Phase 2: Scaffold", x: 180, y: 220, width: 120, height: 52, description: "Executes the frozen Build Spec to produce actual code. Agents scaffold, implement, and test according to the spec. Each stage emits a hash-verifiable artifact.", color: "oklch(0.22 0.06 195)" },
    { id: "code-output", label: "Production Code", x: 340, y: 230, width: 110, height: 46, description: "The final code output, fully traceable back to the original requirements through the Build Spec. Every file can be linked to a specific requirement.", color: "oklch(0.18 0.03 260)" },
    { id: "certificate", label: "Governance Certificate", x: 530, y: 135, width: 150, height: 52, description: "Cryptographic proof binding requirements → Build Spec → code. Contains SHA-256 hashes of every stage artifact, creating an immutable audit chain.", color: "oklch(0.22 0.06 150)" },
  ],
  edges: [
    { from: "requirements", to: "phase1", label: "input" },
    { from: "phase1", to: "build-spec", label: "produces" },
    { from: "build-spec", to: "human-gate", label: "reviewed" },
    { from: "human-gate", to: "phase2", label: "approved" },
    { from: "phase2", to: "code-output", label: "produces" },
    { from: "phase2", to: "certificate", label: "emits" },
    { from: "build-spec", to: "certificate", label: "hashed into" },
  ],
};

export const identityFlowExplorer = {
  title: "Figure 3: Identity-Bounded Collaboration",
  caption: "Click any node to explore its role. Identity flows from GitHub through Rauthy (OIDC signer) to scoped JWT tokens. The deployd-api enforces scope against the spec spine before authorizing agents.",
  viewBox: "0 0 720 280",
  nodes: [
    { id: "github", label: "GitHub IdP", x: 10, y: 110, width: 100, height: 52, description: "The upstream identity provider. Developers authenticate via GitHub OAuth. Their identity is federated into the OAP system through Rauthy.", color: "oklch(0.18 0.03 260)" },
    { id: "rauthy", label: "Rauthy OIDC", x: 155, y: 110, width: 115, height: 52, description: "The platform's OIDC signer. Rauthy federates upstream identities and issues territory-scoped JWTs. It maps GitHub users to OAP agent identities with specific permissions.", color: "oklch(0.22 0.06 195)" },
    { id: "jwt", label: "Scoped JWT", x: 320, y: 40, width: 110, height: 46, description: "JSON Web Tokens carrying territory-scoped permissions. Include fields like scope (spec:read, artifact:write), territory paths, session_id, and upstream identity reference.", color: "oklch(0.20 0.04 80)" },
    { id: "agent", label: "Agent Process", x: 320, y: 185, width: 110, height: 46, description: "An AI agent operating within the platform. Each agent receives a scoped JWT limiting its actions to specific territories. Cannot exceed its granted permissions.", color: "oklch(0.18 0.03 260)" },
    { id: "deployd", label: "deployd-api", x: 490, y: 110, width: 115, height: 52, description: "The enforcement gateway. Validates JWT claims on every request, cross-references scope against the spec spine, and rejects any action outside the agent's territory.", color: "oklch(0.22 0.06 195)" },
    { id: "spec-spine", label: "Spec Spine", x: 640, y: 45, width: 100, height: 46, description: "The source of truth for territory ownership. deployd-api checks JWT territory claims against the live spec spine to ensure the agent has authority over the requested paths.", color: "oklch(0.22 0.04 15)" },
    { id: "resources", label: "Protected Resources", x: 630, y: 185, width: 120, height: 46, description: "Code repositories, deployment targets, and infrastructure that agents interact with. Access is granted only after deployd-api validates the JWT against the spec spine.", color: "oklch(0.18 0.03 260)" },
  ],
  edges: [
    { from: "github", to: "rauthy", label: "federates" },
    { from: "rauthy", to: "jwt", label: "issues" },
    { from: "rauthy", to: "agent", label: "assigns" },
    { from: "jwt", to: "deployd", label: "presented" },
    { from: "agent", to: "deployd", label: "requests" },
    { from: "deployd", to: "spec-spine", label: "validates" },
    { from: "deployd", to: "resources", label: "grants" },
  ],
};

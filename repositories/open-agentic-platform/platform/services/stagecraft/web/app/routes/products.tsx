import {
  ArrowDown,
  Cpu,
  ExternalLink,
  GitBranch,
  Layers,
  Package,
  Server,
  Shield,
  Terminal,
  Wrench,
} from "lucide-react";

export function meta() {
  return [
    { title: "Products & Architecture: Open Agentic Platform" },
    {
      name: "description",
      content:
        "Five layers, seven repositories. The Open Agentic Platform ecosystem: spec-spine, factory-encore, template-encore, tenant-emit, tenant-tail, oap-bootstrap.",
    },
  ];
}

const PROPERTIES = [
  { property: "State Management", approach: "spec-spine registry (deterministic, hash-verifiable JSON)" },
  { property: "Build System", approach: "Vite bundler, Encore.ts service graph, npm workspaces" },
  { property: "Authentication", approach: "Rauthy OIDC + deployd-api scope enforcement (RS256 JWT)" },
  { property: "Content Governance", approach: "Spec-governed: every change bound to a governing spec" },
  { property: "Supply Chain", approach: "Bundled deps + CycloneDX SBOM + tenant-emit certificate binding" },
  { property: "Audit Trail", approach: "Governance certificate (SHA-256 proof chain, Ed25519 signed)" },
  { property: "AI Integration", approach: "Adapter layer (contract-first, provider-agnostic)" },
  { property: "Deployment", approach: "Hetzner K3s + GitOps via oap-bootstrap (idempotent)" },
  { property: "Security Model", approach: "Security invariants INV-1 to INV-11 (framework-level enforcement)" },
  { property: "Persistence", approach: "PostgreSQL + Encore SQLDatabase + typed migrations" },
];

const FLOW = [
  { label: "spec-spine compile", detail: "specs/ to .derived/spec-registry/" },
  { label: "factory-encore process", detail: "business docs to frozen Build Spec (SHA-256)" },
  { label: "adapter scaffold", detail: "Build Spec to template-encore baseline + modules" },
  { label: "tenant-emit build-certificate", detail: "run artifacts to signed governance-certificate.json" },
  { label: "tenant-tail verify-certificate", detail: "certificate to pass/fail (offline, identity-free)" },
  { label: "oap-bootstrap apply", detail: "config to live K3s instance (idempotent)" },
];

const PRODUCTS = [
  {
    id: "open-agentic-platform",
    name: "Open Agentic Platform",
    tagline: "The governed operating system for AI-native delivery",
    icon: Cpu,
    license: "AGPL-3.0",
    status: "pre-alpha",
    language: "Rust | TypeScript",
    url: "https://github.com/statecrafting/open-agentic-platform",
    docsUrl: "https://statecrafting.github.io/open-agentic-platform/",
    specCount: 228,
    description:
      "OAP is a governed control plane for AI-native software delivery. Three layers: OPC Desktop (Tauri v2 + React cockpit), Spec Spine (canonical contract system), and Platform (organisational control plane with Rauthy OIDC, deployd-api, and statecraft). Every change is bound to a spec; every spec compiles to a deterministic JSON registry; every agent action is reconcilable to the spec that authorised it.",
    highlights: [
      "228 markdown specs compiled to deterministic registry",
      "SHA-256 proof chains and JSONL audit logs",
      "OWASP ASI 2026 control coverage (ASI01 to ASI10)",
      "Per-target CycloneDX SBOMs for every release",
      "Governance certificate: single JSON artifact proving full chain",
    ],
    installCmd: null,
  },
  {
    id: "spec-spine",
    name: "spec-spine",
    tagline: "Typed, hash-verifiable authority ledger over a markdown spec corpus",
    icon: GitBranch,
    license: "Apache-2.0",
    status: "stable",
    language: "Rust",
    url: "https://github.com/statecrafting/spec-spine",
    docsUrl: "https://statecrafting.github.io/spec-spine/",
    specCount: null,
    description:
      "spec-spine turns a markdown spec corpus into a governed, hash-verifiable authority ledger and refuses code that drifts from its owning spec at PR time. Two deterministic views are emitted: the registry (spec-as-source) and the index (code-as-source), joined by a coupling gate. Every artifact-producing function is a pure function of (config, file contents): same inputs, byte-identical output, on every platform.",
    highlights: [
      "Five capabilities: compile, index, lint, couple, registry",
      "Per-unit shard trees (by-spec, by-package): PRs never conflict",
      "Available as cargo crate, npm package, Python wheel",
      "Coupling gate refuses drift at PR time (exit code 1)",
      "Staleness detection with index check",
    ],
    installCmd: "cargo install spec-spine-cli",
  },
  {
    id: "factory-encore",
    name: "factory-encore",
    tagline: "Technology-agnostic software factory framework",
    icon: Package,
    license: "Apache-2.0",
    status: "active",
    language: "TypeScript",
    url: "https://github.com/statecrafting/factory-encore",
    docsUrl: "https://statecrafting.github.io/factory-encore",
    specCount: null,
    description:
      "factory-encore separates the process of building software (requirements, design, specification) from the implementation (frameworks, languages, code patterns) by placing a formal contract between the two. The process turns business documents into a structured, frozen Build Specification; an adapter turns that specification into a running application.",
    highlights: [
      "Three layers: Process (universal), Contract (schemas), Adapter (pluggable)",
      "Six pipeline stages: preflight through adapter handoff",
      "Contract schemas: Build Spec, Adapter Manifest, Verification Contract",
      "Governance envelope with objective class and ceilings",
      "Docusaurus documentation website",
    ],
    installCmd: null,
  },
  {
    id: "template-encore",
    name: "template-encore",
    tagline: "Runnable reference application: Encore.ts + Vue 3 + PrimeVue",
    icon: Server,
    license: "Apache-2.0",
    status: "active",
    language: "TypeScript",
    url: "https://github.com/statecrafting/template-encore",
    docsUrl: "https://statecrafting.github.io/template-encore",
    specCount: 16,
    description:
      "The runnable reference application produced by factory-encore's acme-vue-encore adapter. A public-facing SPA and a staff-facing SPA, both backed by a single Encore.ts service cluster. The backend provides a BFF API gateway, stateless RS256 JWT auth, and Postgres persistence. Both Vue 3 frontends are built on PrimeVue with pluggable authentication (Rauthy OIDC or Mock).",
    highlights: [
      "Dual-SPA topology: public + staff with shared Encore.ts backend",
      "Security invariants INV-1 through INV-11",
      "Spec-spine governed (specs 000 to 016)",
      "BFF API gateway + stateless RS256 JWT auth",
      "TypeScript throughout, Node 24, PostgreSQL",
    ],
    installCmd: "npm install && cd apps/api && npm install",
  },
  {
    id: "tenant-emit",
    name: "tenant-emit",
    tagline: "Emit-only CLI for signed governance certificates",
    icon: Shield,
    license: "Apache-2.0",
    status: "scaffold",
    language: "TypeScript",
    url: "https://github.com/statecrafting/tenant-emit",
    docsUrl: "https://statecrafting.github.io/tenant-emit",
    specCount: null,
    description:
      "tenant-emit is an emit-only CLI that builds a signed governance-certificate.json from a finished run directory. It is the emit-side counterpart of tenant-tail: post-hoc (no pipeline orchestration), identity-bearing (an attributable signer and an operator-supplied key), and offline. The emitted certificate carries no platform countersign.",
    highlights: [
      "Ed25519 signing with operator-supplied keys",
      "Corpus binding via spec-spine attestation hash",
      "SBOM artifact binding (CycloneDX, spec 203 FR-003)",
      "--require-operator-key refuses ephemeral dev fallback",
      "Emit-only by construction (no verify verb, no verifier dependency)",
    ],
    installCmd: "npm i -D tenant-emit",
  },
  {
    id: "tenant-tail",
    name: "tenant-tail",
    tagline: "Verify-only CLI for governance certificate validation",
    icon: Terminal,
    license: "Apache-2.0",
    status: "scaffold",
    language: "Rust",
    url: "https://github.com/statecrafting/tenant-tail",
    docsUrl: "https://statecrafting.github.io/tenant-tail/",
    specCount: null,
    description:
      "tenant-tail is a verify-only CLI that re-checks the run-side artifacts the factory asserted about its build, with no trust in the producer. It is offline-capable, identity-free, and read-only all the way down to the package boundary. The verify/emit boundary is load-bearing.",
    highlights: [
      "Verbs: verify-certificate, verify-provenance, verify-sbom (staged)",
      "Offline-capable, identity-free, read-only",
      "Do-not-trust-the-producer posture (spec 102)",
      "Verify-only by construction (no emitter verb, no emitter dependency)",
      "Apache-2.0 (relicensed from AGPL-3.0 factory-engine extraction)",
    ],
    installCmd: "npm i -D tenant-tail",
  },
  {
    id: "oap-bootstrap",
    name: "oap-bootstrap",
    tagline: "Stand up an OAP instance in one resumable CLI",
    icon: Wrench,
    license: "Apache-2.0",
    status: "implemented",
    language: "Go",
    url: "https://github.com/statecrafting/oap-bootstrap",
    docsUrl: null,
    specCount: 1,
    description:
      "Stand up an open-agentic-platform instance in a new GitHub org and bring its Hetzner K3s estate online, in one resumable CLI. Fork the platform into your org, register the GitHub App, wire every secret, provision the cluster, and verify, without the multi-hour manual choreography.",
    highlights: [
      "Phases: init, doctor, github, cluster, dns, identity, platform, verify",
      "Every phase is idempotent (detect-or-create)",
      "SOPS + age encryption for secrets at rest",
      "Unattended mode: apply --yes",
      "Doctor preflight validates all required tools",
    ],
    installCmd: "go build -o oap-bootstrap ./cmd/oap-bootstrap",
  },
];

const STATUS_COLORS: Record<string, string> = {
  "pre-alpha": "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  stable: "bg-green-500/10 text-green-400 border-green-500/30",
  active: "bg-primary/10 text-primary border-primary/30",
  scaffold: "bg-purple-500/10 text-purple-400 border-purple-500/30",
  implemented: "bg-blue-500/10 text-blue-400 border-blue-500/30",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${
        STATUS_COLORS[status] ?? STATUS_COLORS.active
      }`}
    >
      {status}
    </span>
  );
}

export default function Products() {
  return (
    <>
      <section className="container mx-auto max-w-6xl px-4 py-16">
        <div className="max-w-3xl">
          <div className="mb-4 flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Products &amp; Architecture
            </span>
          </div>
          <h1 className="mb-4 font-mono text-3xl font-bold leading-tight md:text-4xl">
            The ecosystem, unpacked.
          </h1>
          <p className="leading-relaxed text-muted-foreground">
            Five architectural layers, seven repositories, one governance chain.
            Each owns a specific surface in the governed delivery pipeline. All
            open-source, all spec-governed, all independently installable.
          </p>
        </div>
      </section>

      {/* Architecture properties table */}
      <section className="container mx-auto max-w-6xl px-4 pb-16">
        <div className="overflow-hidden rounded-lg border border-border/60">
          <div className="border-b border-border/40 bg-card/80 px-5 py-3">
            <h2 className="flex items-center gap-2 font-mono text-sm font-medium">
              <Shield className="h-3.5 w-3.5 text-primary" />
              Platform Architecture Properties
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40 bg-muted/30">
                  <th className="w-1/4 px-4 py-2.5 text-left font-mono text-xs font-medium text-muted-foreground">
                    Property
                  </th>
                  <th className="w-3/4 px-4 py-2.5 text-left font-mono text-xs font-medium text-primary">
                    Implementation
                  </th>
                </tr>
              </thead>
              <tbody>
                {PROPERTIES.map((row) => (
                  <tr
                    key={row.property}
                    className="border-b border-border/20 transition-colors hover:bg-accent/30"
                  >
                    <td className="px-4 py-2.5 font-mono text-xs font-medium">
                      {row.property}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-foreground/80">
                      {row.approach}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Governed delivery flow */}
      <section className="container mx-auto max-w-6xl px-4 pb-16">
        <div className="rounded-lg border border-border/60 bg-card/50 p-6">
          <h2 className="mb-6 flex items-center gap-2 font-mono text-sm font-medium">
            <Cpu className="h-3.5 w-3.5 text-primary" />
            Governed Delivery Flow
          </h2>
          <div className="flex flex-col items-center gap-2">
            {FLOW.map((step, i) => (
              <div key={step.label} className="w-full max-w-lg">
                <div className="flex items-center gap-3 rounded border border-border/40 bg-muted/20 p-3 transition-all hover:border-primary/30">
                  <span className="w-5 shrink-0 font-mono text-[10px] text-primary">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="block font-mono text-xs font-medium">
                      {step.label}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {step.detail}
                    </span>
                  </div>
                </div>
                {i < FLOW.length - 1 && (
                  <div className="flex justify-center py-1">
                    <ArrowDown className="h-3 w-3 text-primary/40" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Repository catalog */}
      <section className="container mx-auto max-w-6xl px-4 pb-20">
        <div className="mb-8">
          <div className="mb-2 flex items-center gap-2">
            <Package className="h-4 w-4 text-primary" />
            <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Repositories
            </span>
          </div>
          <h2 className="font-mono text-2xl font-bold">Seven repositories, unpacked.</h2>
        </div>
        <div className="space-y-6">
          {PRODUCTS.map((product) => (
            <div
              key={product.id}
              id={product.id}
              className="overflow-hidden rounded-lg border border-border/60 bg-card p-6 transition-all hover:border-primary/20"
            >
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary/30 bg-primary/5">
                    <product.icon className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-mono text-base font-bold">{product.name}</h3>
                    <p className="text-xs text-muted-foreground">{product.tagline}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={product.status} />
                  <span className="rounded border border-border/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {product.license}
                  </span>
                </div>
              </div>

              <p className="mb-4 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                {product.description}
              </p>

              <div className="mb-4 grid gap-x-6 gap-y-1.5 md:grid-cols-2">
                {product.highlights.map((h) => (
                  <div key={h} className="flex items-start gap-2 text-xs">
                    <span className="mt-0.5 font-mono text-primary">&#9656;</span>
                    <span className="text-foreground/80">{h}</span>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-3 border-t border-border/30 pt-4">
                <span className="font-mono text-[10px] text-muted-foreground">
                  {product.language}
                </span>
                {product.specCount && (
                  <span className="spec-chip">{product.specCount} specs</span>
                )}
                {product.installCmd && (
                  <code className="rounded bg-muted/50 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {product.installCmd}
                  </code>
                )}
                <div className="flex-1" />
                <div className="flex items-center gap-3">
                  <a
                    href={product.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-medium transition-colors hover:text-primary"
                  >
                    GitHub <ExternalLink className="h-3 w-3" />
                  </a>
                  {product.docsUrl && (
                    <a
                      href={product.docsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-medium transition-colors hover:text-primary"
                    >
                      Docs <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

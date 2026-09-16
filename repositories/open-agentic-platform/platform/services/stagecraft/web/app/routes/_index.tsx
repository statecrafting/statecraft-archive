import { Link } from "react-router";
import {
  ArrowRight,
  CheckCircle2,
  GitBranch,
  Layers,
  Lock,
  Shield,
  Zap,
} from "lucide-react";
import { SignInLink } from "../components/sign-in-link";

export function meta() {
  return [
    { title: "Open Agentic Platform: Governed OS for AI-Native Software Delivery" },
    {
      name: "description",
      content:
        "OAP turns intent into machine-verifiable software. Spec-driven contracts, governed agents, policy-enforced pipelines, unified per project.",
    },
  ];
}

const PRINCIPLES = [
  {
    id: "P-001",
    title: "Governance as Execution",
    description:
      "Every state transition requires authorisation from a governing spec. Ungoverned transitions are structurally impossible.",
    spec: "spec 102",
  },
  {
    id: "P-002",
    title: "Deterministic Compilation",
    description:
      "Same inputs produce byte-identical output on every platform. The spec registry is a pure function of (config, file contents).",
    spec: "spec 127",
  },
  {
    id: "P-003",
    title: "Coupling Gate Enforcement",
    description:
      "Code that drifts from its owning spec fails CI before merge. Drift is prevented, not detected after the fact.",
    spec: "spec 127",
  },
  {
    id: "P-004",
    title: "Emit/Verify Separation",
    description:
      "The entity that produces governance claims is structurally distinct from the entity that verifies them. Different binaries, different trust.",
    spec: "spec 219",
  },
  {
    id: "P-005",
    title: "Supply Chain Integrity",
    description:
      "CycloneDX SBOMs bound to governance certificates. Every dependency traceable, every artifact hash-verified.",
    spec: "spec 203",
  },
  {
    id: "P-006",
    title: "Identity-Bounded Collaboration",
    description:
      "Rauthy OIDC issues tokens, deployd-api enforces scope at every request. No action without attributable identity.",
    spec: "spec 001",
  },
];

const DIFFERENTIATORS = [
  {
    title: "Spec Spine",
    body: "Human-written specifications compile into a machine-verifiable registry. Every feature is traceable from intent to contract to code. No more drift between design and delivery.",
  },
  {
    title: "Two-plane architecture",
    body: "A web governance plane for approvals, policy, and audit. A desktop execution plane for generation, git, and local tooling. Govern from the cloud, execute where the code lives.",
  },
  {
    title: "Project as the unit of governance",
    body: "Identity, knowledge, policy, repos, and factories converge on one atom: the project. Not a Jira project, a Drive folder, and a pile of runners held together with YAML.",
  },
  {
    title: "Policy kernel, not policy theatre",
    body: "A 5-tier settings merge produces a compiled bundle with proof chains. Every agent call, every gate, every deploy evaluates against the same kernel. Governance is a runtime property.",
  },
  {
    title: "Knowledge as a first-class domain",
    body: "Pluggable connectors (SharePoint, S3, Azure Blob, GCS, upload) normalise documents into a canonical object store. Provenance is preserved; factories consume knowledge, they don't scrape it.",
  },
  {
    title: "Factories with adapters",
    body: "Deterministic multi-stage pipelines for real stacks. Consume project knowledge, produce build artifacts, ship through governed gates with a signed certificate at the end.",
  },
];

const STEPS = [
  {
    n: "01",
    title: "Define",
    body: "Write specs in markdown with machine-readable frontmatter. The spec compiler emits a signed registry that every tool in the system reads from.",
  },
  {
    n: "02",
    title: "Ingest",
    body: "Connect SharePoint, S3, Azure Blob, GCS, or upload directly. Documents normalise into the project's canonical object store with full provenance.",
  },
  {
    n: "03",
    title: "Execute",
    body: "Factories run governed pipelines on the desktop plane. Every stage is typed, every artifact is hashed, every agent call passes through the policy kernel.",
  },
  {
    n: "04",
    title: "Promote",
    body: "Approvals, gates, and deploys flow through the web plane. Reviewers see proof chains, audit sees every action, production never receives ungoverned bytes.",
  },
];

const ECOSYSTEM = [
  {
    name: "open-agentic-platform",
    role: "Control Plane",
    description:
      "The governed operating system. 228 specs, SHA-256 proof chains, OWASP ASI 2026 compliance.",
    url: "https://github.com/statecrafting/open-agentic-platform",
  },
  {
    name: "spec-spine",
    role: "Authority Ledger",
    description:
      "Typed, hash-verifiable authority over the spec corpus. The single source of truth.",
    url: "https://github.com/statecrafting/spec-spine",
  },
  {
    name: "factory-encore",
    role: "Build Pipeline",
    description:
      "Technology-agnostic software factory. Process, Contract, and Adapter separation.",
    url: "https://github.com/statecrafting/factory-encore",
  },
  {
    name: "template-encore",
    role: "Reference App",
    description:
      "Runnable reference: Encore.ts + Vue 3 + PrimeVue + PostgreSQL + Rauthy OIDC.",
    url: "https://github.com/statecrafting/template-encore",
  },
  {
    name: "tenant-emit",
    role: "Certificate Emitter",
    description:
      "Emit-only CLI. Ed25519-signed governance certificates with corpus and SBOM binding.",
    url: "https://github.com/statecrafting/tenant-emit",
  },
  {
    name: "tenant-tail",
    role: "Certificate Verifier",
    description:
      "Verify-only CLI. Offline-capable, identity-free, read-only certificate verification.",
    url: "https://github.com/statecrafting/tenant-tail",
  },
  {
    name: "oap-bootstrap",
    role: "Instance Provisioner",
    description:
      "One resumable CLI to stand up an OAP instance. Fork, register, wire, provision, verify.",
    url: "https://github.com/statecrafting/oap-bootstrap",
  },
];

const TRUST_FABRIC = [
  { icon: Lock, label: "OIDC Login", sub: "Rauthy" },
  { icon: Shield, label: "Scope Gate", sub: "deployd-api" },
  { icon: Zap, label: "Policy Kernel", sub: "factory-engine" },
  { icon: GitBranch, label: "Spec-to-Code Map", sub: "codebase-index" },
  { icon: CheckCircle2, label: "Certificate", sub: "governance-cert" },
];

export default function Landing() {
  return (
    <>
      <Hero />
      <CorePrinciples />
      <Differentiators />
      <HowItWorks />
      <Ecosystem />
      <TrustFabric />
      <FinalCta />
    </>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-border/50">
      <div aria-hidden className="blueprint-grid absolute inset-0 opacity-60" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-24 h-[28rem] bg-gradient-to-b from-primary/10 via-transparent to-transparent"
      />
      <div className="container relative mx-auto max-w-6xl px-4 py-24 sm:py-32">
        <div className="max-w-3xl">
          <span className="spec-chip">
            <span className="pulse-dot" />
            Open Agentic Platform
          </span>
          <h1 className="mt-6 font-mono text-4xl font-bold leading-[1.08] tracking-tight sm:text-6xl">
            The governed operating system for{" "}
            <span className="text-primary text-glow">
              AI-native software delivery
            </span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            OAP turns intent into machine-verifiable software. Compile specs into
            contracts, run agents under a policy kernel, and promote work through
            governed pipelines: every project, end to end.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              to="/get-started"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-all hover:glow-cyan active:scale-[0.97]"
            >
              Get started <ArrowRight className="h-4 w-4" />
            </Link>
            <SignInLink className="inline-flex items-center rounded-md border border-border px-5 py-2.5 text-sm font-medium text-foreground transition-all hover:border-primary/50 hover:bg-primary/5">
              Sign in
            </SignInLink>
          </div>
          <dl className="mt-12 grid max-w-2xl grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-3">
            <Metric label="Spec-driven" value="Every feature is a compiled contract" />
            <Metric label="Policy-enforced" value="Gates with proof chains, not vibes" />
            <Metric label="Audit-complete" value="Every agent action, recorded" />
          </dl>
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-l border-border pl-4">
      <dt className="font-mono text-xs font-semibold uppercase tracking-wider text-primary">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-muted-foreground">{value}</dd>
    </div>
  );
}

function SectionEyebrow({
  icon: Icon,
  label,
}: {
  icon: typeof Layers;
  label: string;
}) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <Icon className="h-4 w-4 text-primary" />
      <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

function CorePrinciples() {
  return (
    <section className="container mx-auto max-w-6xl px-4 py-20">
      <div className="mb-10 max-w-2xl">
        <SectionEyebrow icon={Layers} label="Core Principles" />
        <h2 className="mb-3 font-mono text-3xl font-bold tracking-tight">
          Governance is the execution model.
        </h2>
        <p className="text-muted-foreground">
          Six architectural principles that define how the platform operates. Each
          is enforced by the platform itself, not by policy documents.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {PRINCIPLES.map((p) => (
          <div
            key={p.id}
            className="rounded-lg border border-border/60 bg-card p-5 transition-all hover:border-primary/30"
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="font-mono text-xs text-muted-foreground">{p.id}</span>
              <span className="spec-chip">{p.spec}</span>
            </div>
            <h3 className="mb-2 font-mono text-sm font-medium">{p.title}</h3>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {p.description}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Differentiators() {
  return (
    <section className="border-t border-border/50">
      <div className="container mx-auto max-w-6xl px-4 py-20">
        <div className="mb-10 max-w-3xl">
          <SectionEyebrow icon={Zap} label="Only one of its class" />
          <h2 className="mb-3 font-mono text-3xl font-bold tracking-tight">
            Codegen tools ship diffs. OAP ships governed delivery.
          </h2>
          <p className="text-muted-foreground">
            IDE assistants live inside editors. Agent frameworks live in notebooks.
            CI systems live in YAML. OAP is the first platform that binds them
            together under one spec, one policy kernel, and one audit trail, so
            AI-written software is as governed as anything a human would ship.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {DIFFERENTIATORS.map((item) => (
            <div
              key={item.title}
              className="rounded-lg border border-border/60 bg-card p-6 transition-all hover:border-primary/30"
            >
              <h3 className="text-base font-semibold">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {item.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section className="border-t border-border/50 bg-card/30">
      <div className="container mx-auto max-w-6xl px-4 py-20">
        <div className="mb-10 max-w-3xl">
          <SectionEyebrow icon={ArrowRight} label="How it works" />
          <h2 className="font-mono text-3xl font-bold tracking-tight">
            Intent to contract to artifact to deployment.
          </h2>
        </div>
        <ol className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <li
              key={s.n}
              className="rounded-lg border border-border/60 bg-card p-6"
            >
              <div className="font-mono text-xs text-primary">{s.n}</div>
              <h3 className="mt-2 text-base font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {s.body}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Ecosystem() {
  return (
    <section className="border-t border-border/50">
      <div className="container mx-auto max-w-6xl px-4 py-20">
        <div className="mb-10 max-w-2xl">
          <SectionEyebrow icon={GitBranch} label="Ecosystem" />
          <h2 className="mb-3 font-mono text-3xl font-bold tracking-tight">
            Seven repositories. One governance chain.
          </h2>
          <p className="text-muted-foreground">
            Each repository owns a specific surface in the governed delivery
            pipeline. Together they form a complete, auditable, self-authenticating
            system.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {ECOSYSTEM.map((repo) => (
            <a
              key={repo.name}
              href={repo.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group rounded-lg border border-border/60 bg-card p-4 transition-all hover:border-primary/40 hover:glow-cyan-sm"
            >
              <div className="mb-2 flex items-center gap-2">
                <span className="pulse-dot" />
                <span className="font-mono text-[10px] uppercase tracking-wider text-primary">
                  {repo.role}
                </span>
              </div>
              <h3 className="mb-1 font-mono text-sm font-medium transition-colors group-hover:text-primary">
                {repo.name}
              </h3>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {repo.description}
              </p>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

function TrustFabric() {
  return (
    <section className="border-t border-border/50">
      <div className="container mx-auto max-w-6xl px-4 py-20">
        <div className="relative overflow-hidden rounded-xl border border-border/60 bg-card/50 p-8">
          <SectionEyebrow icon={Shield} label="Trust Fabric" />
          <h2 className="mb-6 font-mono text-2xl font-bold tracking-tight">
            One continuous path from identity to audit.
          </h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-3 md:grid-cols-5">
            {TRUST_FABRIC.map((step) => (
              <div
                key={step.label}
                className="flex flex-col items-center gap-2 text-center"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-primary/30 bg-primary/5">
                  <step.icon className="h-4 w-4 text-primary" />
                </div>
                <span className="font-mono text-xs font-medium">{step.label}</span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {step.sub}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-6 max-w-xl text-sm text-muted-foreground">
            You operate every node in the path. There is no SaaS in the trust path
            unless you put it there.
          </p>
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="border-t border-border/50">
      <div className="container mx-auto max-w-6xl px-4 py-20">
        <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-primary/10 via-card to-card p-10">
          <div className="max-w-2xl">
            <h2 className="font-mono text-3xl font-bold tracking-tight">
              Govern your agents. Ship verified software.
            </h2>
            <p className="mt-4 text-muted-foreground">
              Create a project, connect your knowledge sources, and run your first
              governed factory pipeline today.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link
                to="/get-started"
                className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-all hover:glow-cyan active:scale-[0.97]"
              >
                Get started <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

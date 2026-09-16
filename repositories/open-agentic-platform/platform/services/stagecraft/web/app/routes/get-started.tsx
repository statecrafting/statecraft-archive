import { useState } from "react";
import { Link } from "react-router";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Cpu,
  Eye,
  GitBranch,
  Globe,
  Key,
  Rocket,
  Server,
  Shield,
  Terminal,
} from "lucide-react";

export function meta() {
  return [
    { title: "Get Started: Self-host the Open Agentic Platform" },
    {
      name: "description",
      content:
        "Stand up a complete Open Agentic Platform instance with the oap-bootstrap CLI: eight idempotent phases from an empty GitHub org to a verified K3s cluster.",
    },
  ];
}

interface BootstrapPhase {
  id: string;
  number: number;
  title: string;
  command: string;
  description: string;
  governingSpec: { id: string; title: string };
  relatedPaper?: { slug: string; title: string };
  details: string[];
  icon: typeof Terminal;
}

const PHASES: BootstrapPhase[] = [
  {
    id: "init",
    number: 1,
    title: "Initialize Configuration",
    command: "oap-bootstrap init --org my-org --domain my-platform.dev",
    description:
      "Creates the bootstrap state directory with encrypted configuration. Generates the master config file, sets the target GitHub org, and prepares the SOPS + age encryption envelope for secrets at rest.",
    governingSpec: { id: "000-bootstrap-spec-system", title: "Bootstrap spec system" },
    relatedPaper: { slug: "governance-model", title: "The Governance Execution Model" },
    details: [
      "Creates .oap-bootstrap/ state directory",
      "Generates age keypair for SOPS encryption",
      "Writes initial config.yaml with org and domain",
      "All secrets encrypted at rest from this point forward",
    ],
    icon: Terminal,
  },
  {
    id: "doctor",
    number: 2,
    title: "Preflight Validation",
    command: "oap-bootstrap doctor",
    description:
      "Validates that all required tools are installed and accessible: gh CLI, kubectl, helm, sops, age, jq. Reports versions and exits non-zero if any dependency is missing or below minimum version.",
    governingSpec: {
      id: "005-verification-reconciliation-mvp",
      title: "Verification and reconciliation",
    },
    details: [
      "Checks: gh, kubectl, helm, sops, age, jq, curl",
      "Validates minimum versions for each tool",
      "Reports GitHub CLI authentication status",
      "Exits non-zero on any missing dependency",
    ],
    icon: CheckCircle2,
  },
  {
    id: "github",
    number: 3,
    title: "GitHub Organization Setup",
    command: "oap-bootstrap github --fork-platform --register-app",
    description:
      "Forks the open-agentic-platform repository into your org, registers the GitHub App for CI/CD authentication, and wires all required repository secrets. Every secret is encrypted via SOPS before storage.",
    governingSpec: {
      id: "004-spec-to-execution-bridge-mvp",
      title: "Spec-to-execution bridge",
    },
    relatedPaper: { slug: "spec-spine-architecture", title: "Spec Spine: The Authority Ledger" },
    details: [
      "Forks open-agentic-platform into target org",
      "Registers GitHub App with required permissions",
      "Generates and encrypts app private key",
      "Wires repository secrets for CI workflows",
      "Configures branch protection rules",
    ],
    icon: GitBranch,
  },
  {
    id: "cluster",
    number: 4,
    title: "Provision K3s Cluster",
    command: "oap-bootstrap cluster --provider hetzner --nodes 3",
    description:
      "Provisions a K3s cluster on Hetzner Cloud with the specified node count. Configures the cluster with the platform's required namespaces, RBAC policies, and network policies. Outputs kubeconfig encrypted via SOPS.",
    governingSpec: {
      id: "003-feature-lifecycle-mvp",
      title: "Feature lifecycle and status semantics",
    },
    details: [
      "Provisions Hetzner Cloud servers via API",
      "Installs K3s with hardened configuration",
      "Creates platform namespaces (oap-system, oap-apps)",
      "Applies RBAC and NetworkPolicy manifests",
      "Encrypts kubeconfig into state directory",
    ],
    icon: Server,
  },
  {
    id: "dns",
    number: 5,
    title: "Configure DNS",
    command: "oap-bootstrap dns --provider cloudflare",
    description:
      "Configures DNS records for the platform domain. Creates A records pointing to the cluster's ingress IP, wildcard records for tenant subdomains, and TXT records for domain verification.",
    governingSpec: {
      id: "003-feature-lifecycle-mvp",
      title: "Feature lifecycle and status semantics",
    },
    details: [
      "Creates A record for platform domain",
      "Creates wildcard *.apps record for tenants",
      "Adds TXT verification records",
      "Configures cert-manager ClusterIssuer for Let's Encrypt",
    ],
    icon: Globe,
  },
  {
    id: "identity",
    number: 6,
    title: "Deploy Identity Provider",
    command: "oap-bootstrap identity --provider rauthy",
    description:
      "Deploys Rauthy as the OIDC identity provider. Configures the admin user, client registrations for platform services, and RS256 signing keys. All credentials are encrypted and stored in the state directory.",
    governingSpec: { id: "102-governed-excellence", title: "Governed excellence" },
    relatedPaper: {
      slug: "certificate-verification",
      title: "Certificate Verification: Trust Without Trust",
    },
    details: [
      "Deploys Rauthy via Helm chart",
      "Creates admin user with encrypted credentials",
      "Registers OIDC clients for deployd-api and statecraft",
      "Generates RS256 signing keypair",
      "Configures token lifetimes and scopes",
    ],
    icon: Key,
  },
  {
    id: "platform",
    number: 7,
    title: "Deploy Platform Services",
    command: "oap-bootstrap platform --deploy-all",
    description:
      "Deploys the full platform stack: deployd-api (scope enforcement), statecraft (orchestration), and the OPC desktop distribution. Each service is configured with its OIDC client and connected to the spec-spine registry.",
    governingSpec: { id: "102-governed-excellence", title: "Governed excellence" },
    relatedPaper: { slug: "factory-pipeline", title: "The Factory Pipeline" },
    details: [
      "Deploys deployd-api with scope enforcement",
      "Deploys statecraft orchestration service",
      "Configures service-to-service authentication",
      "Binds each service to its governing spec",
      "Runs spec-spine compile to verify registry integrity",
    ],
    icon: Cpu,
  },
  {
    id: "verify",
    number: 8,
    title: "Verify Installation",
    command: "oap-bootstrap verify --full",
    description:
      "Runs the full verification suite: checks every service is healthy, validates the spec-spine registry is compiled and consistent, verifies OIDC token flow, and emits a governance certificate for the bootstrap run.",
    governingSpec: {
      id: "005-verification-reconciliation-mvp",
      title: "Verification and reconciliation",
    },
    relatedPaper: { slug: "governance-model", title: "The Governance Execution Model" },
    details: [
      "Health-checks all deployed services",
      "Validates spec-spine registry compilation",
      "Tests OIDC token issuance and verification",
      "Runs tenant-emit to produce governance certificate",
      "Runs tenant-tail verify-certificate on the result",
      "Prints final status report with all checks",
    ],
    icon: Eye,
  },
];

const PREREQUISITES = [
  "Go 1.22+ installed",
  "GitHub CLI (gh) authenticated",
  "kubectl configured",
  "Helm 3.x installed",
  "SOPS + age installed",
  "Hetzner Cloud API token",
  "Cloudflare API token (for DNS)",
  "A registered domain name",
];

export default function GetStarted() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-16">
      {/* Header */}
      <div className="mb-4 flex items-center gap-2">
        <Rocket className="h-4 w-4 text-primary" />
        <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
          Get Started
        </span>
      </div>
      <h1 className="mb-4 font-mono text-3xl font-bold leading-tight md:text-4xl">
        From zero to governed in eight phases.
      </h1>
      <p className="mb-6 leading-relaxed text-muted-foreground">
        Stand up a complete Open Agentic Platform instance using{" "}
        <code className="font-mono text-sm text-primary">oap-bootstrap</code>. Every
        phase is idempotent: re-running a phase detects existing state and skips
        completed work. Each step links to its governing spec and relevant
        whitepaper.
      </p>

      {/* Prerequisites */}
      <div className="mb-8 rounded-lg border border-border/60 bg-card p-5">
        <h2 className="mb-3 font-mono text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Prerequisites
        </h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {PREREQUISITES.map((req) => (
            <div key={req} className="flex items-center gap-2 text-xs text-foreground/80">
              <CheckCircle2 className="h-3 w-3 shrink-0 text-green-400" />
              <span>{req}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Install */}
      <div className="mb-10 rounded-md border border-border/30 bg-muted/40 px-4 py-3">
        <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Install
        </span>
        <code className="font-mono text-sm text-primary">
          $ go install github.com/statecrafting/oap-bootstrap/cmd/oap-bootstrap@latest
        </code>
      </div>

      {/* Lifecycle state machine */}
      <div className="mb-10 rounded-lg border border-border/60 bg-card p-6">
        <h2 className="mb-2 flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <GitBranch className="h-3.5 w-3.5 text-primary" />
          Spec Lifecycle State Machine
        </h2>
        <p className="mb-5 text-xs text-muted-foreground">
          Every specification follows a deterministic lifecycle. Transitions are
          enforced by spec-spine, with no manual overrides.
        </p>
        <div className="mb-6 flex items-center justify-between gap-2">
          <StateBox color="blue" label="DRAFT" sub="Initial state" />
          <Arrow from="blue" to="green" label="approve()" />
          <StateBox color="green" label="APPROVED" sub="Active state" />
          <Arrow from="green" to="yellow" label="supersede()" />
          <StateBox color="yellow" label="SUPERSEDED" sub="Terminal state" />
        </div>
        <div className="mb-4 flex justify-center">
          <div className="flex items-center gap-3 rounded-lg border border-dashed border-primary/30 bg-primary/5 px-4 py-2">
            <span className="font-mono text-[9px] text-primary/80">amend()</span>
            <span className="font-mono text-[9px] text-muted-foreground">
              Creates a new spec that amends the current one (approved to approved)
            </span>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Rule color="text-blue-400" title="Draft to Approved">
            Requires: spec-spine compile passes, all required fields present, no
            conflicting active spec
          </Rule>
          <Rule color="text-green-400" title="Approved to Superseded">
            Requires: successor spec approved, explicit supersedes[] reference,
            governance certificate
          </Rule>
          <Rule color="text-primary" title="Amend (self-loop)">
            Creates a new spec with amends[] pointing to parent. Parent stays
            approved until explicitly superseded.
          </Rule>
        </div>
      </div>

      {/* Phases */}
      <div>
        {PHASES.map((phase, i) => (
          <PhaseCard key={phase.id} phase={phase} isLast={i === PHASES.length - 1} />
        ))}
      </div>

      {/* Post-bootstrap */}
      <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-6">
        <h2 className="mb-3 font-mono text-base font-bold text-primary">
          What happens next?
        </h2>
        <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
          After verification passes, your OAP instance is live. The governance
          certificate produced in phase 8 proves the entire bootstrap was
          spec-governed. From here:
        </p>
        <div className="space-y-2">
          {[
            "Write your first spec in specs/ and run spec-spine compile",
            "Use factory-encore to produce your first governed application",
            "Sign your first release with tenant-emit",
            "Verify the certificate chain with tenant-tail",
          ].map((step, i) => (
            <div key={step} className="flex items-start gap-2 text-xs text-foreground/80">
              <span className="font-mono font-bold text-primary">{i + 1}.</span>
              <span>{step}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 flex gap-3">
          <Link
            to="/papers"
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Read the papers <ArrowRight className="h-3 w-3" />
          </Link>
          <Link
            to="/registry"
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
          >
            Browse the spec registry
          </Link>
        </div>
      </div>
    </div>
  );
}

function PhaseCard({ phase, isLast }: { phase: BootstrapPhase; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = phase.icon;
  return (
    <div className="relative">
      {!isLast && (
        <div className="absolute bottom-0 left-[23px] top-[56px] w-px bg-gradient-to-b from-primary/40 to-border/20" />
      )}
      <div className="flex gap-4">
        <div className="relative z-10 flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-primary/40 bg-primary/5">
          <span className="font-mono text-xs font-bold text-primary">
            {String(phase.number).padStart(2, "0")}
          </span>
        </div>
        <div className="flex-1 pb-8">
          <div className="overflow-hidden rounded-lg border border-border/60 bg-card p-5 transition-colors hover:border-primary/20">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-primary" />
                <h3 className="font-mono text-sm font-bold">{phase.title}</h3>
              </div>
              <Link to={`/registry/${phase.governingSpec.id}`} className="spec-chip text-[9px]">
                {phase.governingSpec.id.slice(0, 3)}
              </Link>
            </div>
            <div className="mb-3 overflow-x-auto rounded-md border border-border/30 bg-muted/40 px-3 py-2">
              <code className="whitespace-nowrap font-mono text-xs text-primary">
                $ {phase.command}
              </code>
            </div>
            <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
              {phase.description}
            </p>
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground transition-colors hover:text-primary"
            >
              <ChevronDown
                className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`}
              />
              {expanded ? "Hide details" : "Show details"}
            </button>
            {expanded && (
              <div className="mt-3 border-t border-border/30 pt-3">
                <ul className="space-y-1.5">
                  {phase.details.map((d) => (
                    <li key={d} className="flex items-start gap-2 text-xs text-foreground/70">
                      <span className="mt-0.5 font-mono text-primary">&#9656;</span>
                      <span>{d}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-4 flex flex-wrap gap-3">
                  <Link
                    to={`/registry/${phase.governingSpec.id}`}
                    className="inline-flex items-center gap-1 font-mono text-[10px] text-primary hover:underline"
                  >
                    <Shield className="h-3 w-3" />
                    {phase.governingSpec.title}
                  </Link>
                  {phase.relatedPaper && (
                    <Link
                      to={`/papers/${phase.relatedPaper.slug}`}
                      className="inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground hover:text-primary hover:underline"
                    >
                      <ArrowRight className="h-3 w-3" />
                      {phase.relatedPaper.title}
                    </Link>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const STATE_STYLES: Record<string, string> = {
  blue: "border-blue-500/50 bg-blue-500/10 text-blue-400",
  green: "border-green-500/50 bg-green-500/10 text-green-400",
  yellow: "border-yellow-500/50 bg-yellow-500/10 text-yellow-400",
};

function StateBox({ color, label, sub }: { color: string; label: string; sub: string }) {
  return (
    <div className="flex flex-col items-center">
      <div
        className={`flex h-24 w-24 flex-col items-center justify-center rounded-lg border-2 ${STATE_STYLES[color]}`}
      >
        <span className="mb-1 h-3 w-3 rounded-full bg-current opacity-80" />
        <span className="font-mono text-[10px] font-bold">{label}</span>
      </div>
      <span className="mt-2 text-center font-mono text-[9px] text-muted-foreground">{sub}</span>
    </div>
  );
}

function Arrow({ from, to, label }: { from: string; to: string; label: string }) {
  const gradient =
    from === "blue" ? "from-blue-500/50 to-green-500/50" : "from-green-500/50 to-yellow-500/50";
  return (
    <div className="flex flex-1 flex-col items-center">
      <div className={`relative h-px w-full bg-gradient-to-r ${gradient}`}>
        <div className="absolute right-0 top-1/2 h-0 w-0 -translate-y-1/2 border-y-[4px] border-l-[6px] border-y-transparent border-l-current opacity-60" />
      </div>
      <span className="mt-1 font-mono text-[8px] text-muted-foreground/70">{label}</span>
    </div>
  );
}

function Rule({
  color,
  title,
  children,
}: {
  color: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded border border-border/40 bg-muted/20 px-3 py-2">
      <span className={`mb-1 block font-mono text-[9px] uppercase ${color}`}>{title}</span>
      <span className="text-[9px] text-muted-foreground">{children}</span>
    </div>
  );
}

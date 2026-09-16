import { Link } from "react-router";
import type { Route } from "./+types/_index";
import { loadRegistry } from "~/lib/registry.server";
import { findSpec, formatAsOf, implementationChip, specNum } from "~/lib/registry";
import {
  implToState,
  milestoneStateChip,
  milestoneStateLabel,
  rollupAll,
  type MilestoneRollup,
  type MilestoneState,
} from "~/lib/milestones";
import { ORG_URL, PRODUCT_FAMILY } from "~/lib/product-family";

// The launch index (spec 002). Positioning in the builder's own register:
// present tense for what works, future tense marked for what is planned, no
// theater (spec 002 §1). Every capability claim carries its receipt, a link
// into the governed registry, and a live maturity chip rolled up from the spec
// that governs it, so nothing on this page can read louder than the source
// (spec 002 §6). The status ladder and the per-block chips are all derived at
// build time from the baked payload; they cannot outrun the specs.

export function meta(_: Route.MetaArgs): Route.MetaDescriptors {
  return [
    { title: "Statecraft: governed agentic delivery control plane" },
    {
      name: "description",
      content:
        "Intent becomes a governed spec, a factory stamps a complete app from an open template, a fleet operates the result, and your code stays in your GitHub org. Spec-governed, open source, static by construction.",
    },
  ];
}

type LoopRef = { repo: string; id: string } | null;

// The delivery loop (spec 002 §2). Each turn carries a receipt (the spec that
// governs it) and a representative spec whose live state decides the block's
// maturity chip. Specify has no single spec: spec-spine governs the whole
// family and demonstrably runs today (this site is built by it), so it is
// resolved as shipped.
const LOOP: Array<{
  verb: string;
  title: string;
  body: string;
  href: string;
  receipt: string;
  ref: LoopRef;
}> = [
  {
    verb: "Specify",
    title: "Markdown is the source of truth",
    body: "spec-spine compiles specs into typed registries and gates drift in CI. Every repo in this family is governed by it today, including this site.",
    href: "/registry",
    receipt: "the governed registry",
    ref: null,
  },
  {
    verb: "Stamp",
    title: "A contract stamps a whole app",
    body: "A versioned template contract stamps a complete application from an open template, with a born-with certificate that binds an explicit agentic posture.",
    href: "/registry/enrahitu/009-template-contract",
    receipt: "the template contract",
    ref: { repo: "enrahitu", id: "009-template-contract" },
  },
  {
    verb: "Operate",
    title: "Update and backup are verbs",
    body: "One container and one volume per app. Governed verbs carry an audit trail, instead of a runbook you hope someone followed.",
    href: "/registry/statecraft/006-fleet",
    receipt: "the fleet spec",
    ref: { repo: "statecraft", id: "006-fleet" },
  },
  {
    verb: "Verify",
    title: "The record is checkable",
    body: "A tamper-evident attestation ledger records what the plane did, and an independent verifier can check it without trusting the plane.",
    href: "/registry/statecraft/008-governance-attestation",
    receipt: "the governance spine",
    ref: { repo: "statecraft", id: "008-governance-attestation" },
  },
];

// The for-agents block resolves its maturity from the MCP server spec.
const AGENT_REF = { repo: "statecraft-cli", id: "105-mcp-server" };

// Runs in Node during prerender (ssr: false). Rolls the milestone ladder and
// the per-block maturity chips up from the baked registry and passes only the
// compact result to the client; the full payload stays on disk. Fails the build
// loud if any referenced spec has fallen out of the registry (mirrors
// scripts/bake-registry.mjs: no silent partial truth).
export function loader() {
  const payload = loadRegistry();
  const milestones = rollupAll(payload);

  const loop = LOOP.map((step) => {
    const hit = step.ref ? findSpec(payload, step.ref.repo, step.ref.id) : null;
    const impl =
      hit && typeof hit.spec.implementation === "string"
        ? hit.spec.implementation
        : "";
    const state: MilestoneState = step.ref ? implToState(impl) : "done";
    const missing = step.ref && !hit ? `${step.ref.repo}/${step.ref.id}` : null;
    return { ...step, state, missing };
  });

  const agentHit = findSpec(payload, AGENT_REF.repo, AGENT_REF.id);
  const agentState: MilestoneState = implToState(
    agentHit && typeof agentHit.spec.implementation === "string"
      ? agentHit.spec.implementation
      : ""
  );

  const missing = [
    ...milestones.flatMap((m) =>
      m.specs.filter((s) => !s.found).map((s) => `${s.repo}/${s.id}`)
    ),
    ...loop.map((s) => s.missing).filter((m): m is string => Boolean(m)),
    agentHit ? null : `${AGENT_REF.repo}/${AGENT_REF.id}`,
  ].filter((m): m is string => Boolean(m));
  if (missing.length > 0) {
    throw new Error(
      `launch page references specs missing from the baked registry: ${missing.join(
        ", "
      )}. Update app/lib/milestones.ts or app/routes/_index.tsx, or re-bake (npm run bake:registry).`
    );
  }

  return {
    milestones,
    loop: loop.map(({ missing: _drop, ref: _ref, ...rest }) => rest),
    agentState,
    asOf: payload.generatedAt,
    totalSpecs: payload.totalSpecs,
    repoCount: payload.repos.length,
  };
}

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="spec-chip mb-4">
      <span className="pulse-dot" />
      {children}
    </p>
  );
}

function MaturityChip({ state }: { state: MilestoneState }) {
  return (
    <span className={milestoneStateChip(state)}>{milestoneStateLabel(state)}</span>
  );
}

function Hero() {
  return (
    <section className="blueprint-grid rounded-2xl border border-border/60 px-6 py-12 sm:px-10 sm:py-16">
      <p className="spec-chip mb-4">
        <span className="pulse-dot" />
        governed agentic delivery control plane
      </p>
      <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">Statecraft</h1>
      <p className="mt-5 max-w-2xl text-lg leading-relaxed text-foreground/90 sm:text-xl">
        Statecraft is built around one governed loop: intent becomes a governed
        spec, a factory stamps a complete application from an open template, a
        fleet operates the result, and your code stays in your GitHub org the
        whole time.
      </p>
      <p className="mt-4 max-w-2xl text-sm text-muted-foreground">
        That is the design. What runs today is the status section below, rolled
        up live from the specs, not a roadmap you have to take on faith. The
        substrate already ships: EnRaHiTu is Encore.ts, rauthy, hiqlite, and
        Turso in a single container, with zero managed dependencies.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          to="/registry"
          className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          Browse the registry
        </Link>
        <a
          href={`${ORG_URL}/statecraft`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center rounded-md border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
        >
          Read the source
        </a>
      </div>
    </section>
  );
}

function TheLoop({
  loop,
}: {
  loop: Array<{
    verb: string;
    title: string;
    body: string;
    href: string;
    receipt: string;
    state: MilestoneState;
  }>;
}) {
  return (
    <section className="mt-16">
      <SectionEyebrow>the loop</SectionEyebrow>
      <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
        One governed loop, and where each turn stands
      </h2>
      <p className="mt-3 max-w-2xl text-muted-foreground">
        Each block describes a turn of the loop and carries the state of the
        spec that governs it. Present tense is the design; the chip is the
        truth.
      </p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {loop.map((step) => (
          <div
            key={step.verb}
            className="flex flex-col rounded-xl border border-border/70 bg-card/40 p-5"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-xs font-semibold uppercase tracking-wide text-primary">
                {step.verb}
              </span>
              <MaturityChip state={step.state} />
            </div>
            <h3 className="mt-2 font-semibold">{step.title}</h3>
            <p className="mt-2 flex-1 text-sm text-muted-foreground">{step.body}</p>
            <Link
              to={step.href}
              className="mt-4 inline-flex items-center gap-1 font-mono text-xs text-muted-foreground transition-colors hover:text-primary"
            >
              {step.receipt}
              <span aria-hidden>&rarr;</span>
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}

function ProductFamily() {
  return (
    <section className="mt-16">
      <SectionEyebrow>product family</SectionEyebrow>
      <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
        {PRODUCT_FAMILY.length} repos, one stack
      </h2>
      <p className="mt-3 max-w-2xl text-muted-foreground">
        Everything is open source and governed the same way. Apps the factory
        stamps are not on this list: they belong to their owners, in their own
        orgs, under their own licenses.
      </p>
      <ul className="mt-6 divide-y divide-border/40 overflow-hidden rounded-xl border border-border/70">
        {PRODUCT_FAMILY.map((repo) => (
          <li key={repo.repo}>
            <a
              href={repo.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex flex-col gap-2 px-5 py-4 transition-colors hover:bg-accent/50 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 flex-col">
                <span className="font-mono text-sm font-semibold group-hover:text-primary">
                  {repo.repo}
                </span>
                <span className="text-sm text-muted-foreground">{repo.role}</span>
              </div>
              <span className="spec-chip shrink-0 self-start sm:self-auto">
                {repo.license}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ForAgents({ state }: { state: MilestoneState }) {
  return (
    <section className="mt-16">
      <div className="rounded-2xl border border-border/60 bg-card/30 p-6 sm:p-8">
        <div className="flex items-center justify-between gap-3">
          <SectionEyebrow>for agents</SectionEyebrow>
          <MaturityChip state={state} />
        </div>
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Agents run through the same controls as people
        </h2>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          The model is deliberate: same verbs, same guards, an explicit posture,
          no side doors. The MCP face exposes the governed verbs to coding agents
          directly, so an agent driving the plane passes through the exact
          controls a person does. What it cannot show you is whether a provider
          reported every tool call it made: no driver proves that, so it is
          recorded as unknown rather than as coverage.
        </p>
        <Link
          to={`/registry/${AGENT_REF.repo}/${AGENT_REF.id}`}
          className="mt-5 inline-flex items-center gap-1 font-mono text-sm text-primary transition-colors hover:underline"
        >
          the MCP server spec
          <span aria-hidden>&rarr;</span>
        </Link>
      </div>
    </section>
  );
}

function LiveRegistry({
  totalSpecs,
  repoCount,
}: {
  totalSpecs: number;
  repoCount: number;
}) {
  return (
    <section className="mt-16">
      <SectionEyebrow>read the source</SectionEyebrow>
      <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
        Every claim here is a spec you can open
      </h2>
      <p className="mt-3 max-w-2xl text-muted-foreground">
        The registry bakes the family's spec corpora at build time, {totalSpecs}{" "}
        specs across {repoCount} repos, each page stamped with the commit it was
        baked from. Nothing on this page asks you to take it on faith.
      </p>
      <Link
        to="/registry"
        className="mt-5 inline-flex items-center rounded-md border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
      >
        Open the registry
      </Link>
    </section>
  );
}

function StatusRung({ rung }: { rung: MilestoneRollup }) {
  const { milestone, state, complete, total, specs } = rung;
  return (
    <li className="rounded-xl border border-border/70 bg-card/40 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm font-bold text-primary">
            {milestone.key}
          </span>
          <span className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
            {milestone.phase}
          </span>
        </div>
        <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
          <span>
            {complete}/{total} complete
          </span>
          <MaturityChip state={state} />
        </div>
      </div>
      <h3 className="mt-3 font-semibold">{milestone.title}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{milestone.blurb}</p>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {specs.map((spec) => (
          <Link
            key={`${spec.repo}/${spec.id}`}
            to={`/registry/${spec.repo}/${spec.id}`}
            title={`${spec.repo}/${spec.id}: ${spec.title}`}
            className={`${implementationChip(spec.implementation || undefined)} transition-transform hover:-translate-y-px`}
          >
            {spec.repo}/{specNum(spec.id)}
          </Link>
        ))}
      </div>
    </li>
  );
}

function Status({
  milestones,
  asOf,
}: {
  milestones: MilestoneRollup[];
  asOf: string;
}) {
  return (
    <section className="mt-16">
      <SectionEyebrow>status</SectionEyebrow>
      <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
        Where it actually is
      </h2>
      <p className="mt-3 max-w-2xl text-muted-foreground">
        Each rung rolls up the implementation state of the specs that make it
        up, read from the baked registry. When the specs move, this moves.
      </p>
      <ol className="mt-6 flex flex-col gap-3">
        {milestones.map((rung) => (
          <StatusRung key={rung.milestone.key} rung={rung} />
        ))}
      </ol>
      <p className="mt-4 font-mono text-xs text-muted-foreground">
        rolled up from the registry baked {formatAsOf(asOf)}
      </p>
    </section>
  );
}

export default function Index({ loaderData }: Route.ComponentProps) {
  const { milestones, loop, agentState, asOf, totalSpecs, repoCount } =
    loaderData;
  return (
    <div className="container mx-auto max-w-4xl px-4 py-16 sm:py-20">
      <Hero />
      <TheLoop loop={loop} />
      <ProductFamily />
      <ForAgents state={agentState} />
      <LiveRegistry totalSpecs={totalSpecs} repoCount={repoCount} />
      <Status milestones={milestones} asOf={asOf} />
    </div>
  );
}

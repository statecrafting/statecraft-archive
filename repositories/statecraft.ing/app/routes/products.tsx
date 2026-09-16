import { Link } from "react-router";
import type { Route } from "./+types/products";
import { ORG_URL, PRODUCT_FAMILY } from "~/lib/product-family";
import { loadRegistry } from "~/lib/registry.server";
import { findSpec } from "~/lib/registry";
import {
  implToState,
  milestoneStateChip,
  milestoneStateLabel,
  type MilestoneState,
} from "~/lib/milestones";
import {
  ARCHITECTURE_LAYERS,
  DELIVERY_FLOW,
  productEntries,
  type IconKey,
} from "~/lib/products";
import {
  ArrowDown,
  Cpu,
  ExternalLink,
  GitBranch,
  Layers,
  Server,
  ShieldCheck,
  Terminal,
} from "~/components/icons";

// Products / architecture (spec 004 section 3.3). The roster is owned by spec
// 003 and imported, never re-listed here; this page adds the architectural
// framing. The loader runs in Node at prerender and fails the build loud if the
// layer grouping and the roster ever disagree, so the page cannot silently drop
// or double-count a repo.

export function meta(_: Route.MetaArgs): Route.MetaDescriptors {
  return [
    { title: "Products & architecture: Statecraft" },
    {
      name: "description",
      content:
        "The Statecraft family as layers: a governance toolchain, a runnable substrate, the control plane, the interface, and the verification primitives. Ten open repos, one governed stack.",
    },
  ];
}

export function loader() {
  const rosterRepos = new Set(PRODUCT_FAMILY.map((r) => r.repo));
  const seen = new Set<string>();
  for (const layer of ARCHITECTURE_LAYERS) {
    for (const repo of layer.repos) {
      if (!rosterRepos.has(repo)) {
        throw new Error(
          `products page: layer "${layer.id}" names "${repo}", which is not in the spec-003 roster.`
        );
      }
      if (seen.has(repo)) {
        throw new Error(`products page: "${repo}" appears in more than one layer.`);
      }
      seen.add(repo);
    }
  }
  const missing = [...rosterRepos].filter((r) => !seen.has(r));
  if (missing.length > 0) {
    throw new Error(
      `products page: roster repos not placed in any layer: ${missing.join(", ")}. Update ARCHITECTURE_LAYERS in app/lib/products.ts.`
    );
  }

  // Roll each delivery-flow step's maturity up from the baked registry so the
  // page and the home page status ladder agree; fail the build if a referenced
  // spec has fallen out of the registry (no silent stale status).
  const payload = loadRegistry();
  const flow = DELIVERY_FLOW.map((step) => {
    const hit = step.ref ? findSpec(payload, step.ref.repo, step.ref.id) : null;
    const impl =
      hit && typeof hit.spec.implementation === "string"
        ? hit.spec.implementation
        : "";
    const state: MilestoneState = step.ref ? implToState(impl) : "done";
    const missingRef = step.ref && !hit ? `${step.ref.repo}/${step.ref.id}` : null;
    return { verb: step.verb, tool: step.tool, detail: step.detail, state, missingRef };
  });
  const missingRefs = flow
    .map((f) => f.missingRef)
    .filter((m): m is string => Boolean(m));
  if (missingRefs.length > 0) {
    throw new Error(
      `products delivery flow references specs missing from the baked registry: ${missingRefs.join(", ")}. Update DELIVERY_FLOW in app/lib/products.ts or re-bake.`
    );
  }

  return {
    entries: productEntries(),
    flow: flow.map(({ missingRef: _drop, ...rest }) => rest),
  };
}

const LAYER_ICON: Record<IconKey, (p: { className?: string }) => React.ReactNode> = {
  governance: GitBranch,
  substrate: Server,
  "control-plane": Cpu,
  interface: Terminal,
  verification: ShieldCheck,
};

function Hero() {
  return (
    <section className="max-w-3xl">
      <div className="mb-4 flex items-center gap-2">
        <Layers className="h-4 w-4 text-primary" />
        <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
          Products &amp; architecture
        </span>
      </div>
      <h1 className="mb-4 font-mono text-3xl font-bold leading-tight md:text-4xl">
        The ecosystem, in layers.
      </h1>
      <p className="leading-relaxed text-muted-foreground">
        {PRODUCT_FAMILY.length} public repositories, one governed stack. Each
        owns a specific surface: the toolchain everything is checked against, the
        substrate an app is born from, the control plane, the interface people
        and agents drive, and the small primitives that make the record
        checkable. All open source, all spec-governed.
      </p>
    </section>
  );
}

function ArchitectureLayers() {
  return (
    <section className="mt-14">
      <h2 className="mb-6 flex items-center gap-2 font-mono text-sm font-medium">
        <Layers className="h-3.5 w-3.5 text-primary" /> Architecture layers
      </h2>
      <div className="space-y-4">
        {ARCHITECTURE_LAYERS.map((layer) => {
          const Icon = LAYER_ICON[layer.icon];
          return (
            <div
              key={layer.id}
              className="rounded-lg border border-border/60 bg-card/50 p-5"
            >
              <div className="mb-2 flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-primary/30 bg-primary/5">
                  <Icon className="h-4 w-4 text-primary" />
                </div>
                <h3 className="font-mono text-sm font-bold">{layer.name}</h3>
              </div>
              <p className="mb-3 max-w-3xl text-sm text-muted-foreground">
                {layer.blurb}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {layer.repos.map((repo) => (
                  <a
                    key={repo}
                    href={`${ORG_URL}/${repo}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="spec-chip transition-transform hover:-translate-y-px"
                  >
                    {repo}
                  </a>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function DeliveryFlow({
  flow,
}: {
  flow: Array<{ verb: string; tool: string; detail: string; state: MilestoneState }>;
}) {
  return (
    <section className="mt-14">
      <div className="rounded-lg border border-border/60 bg-card/50 p-6">
        <h2 className="mb-6 flex items-center gap-2 font-mono text-sm font-medium">
          <Cpu className="h-3.5 w-3.5 text-primary" /> The governed delivery flow
        </h2>
        <div className="flex flex-col items-center gap-2">
          {flow.map((step, i) => (
            <div key={step.verb} className="w-full max-w-lg">
              <div className="flex items-center gap-3 rounded border border-border/40 bg-muted/20 p-3 transition-all hover:border-primary/30">
                <span className="w-5 shrink-0 font-mono text-[10px] text-primary">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2 font-mono text-xs font-medium">
                    {step.verb}
                    <span className="text-muted-foreground/70">/ {step.tool}</span>
                    <span className={milestoneStateChip(step.state)}>
                      {milestoneStateLabel(step.state)}
                    </span>
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {step.detail}
                  </span>
                </div>
              </div>
              {i < flow.length - 1 && (
                <div className="flex justify-center py-1">
                  <ArrowDown className="h-3 w-3 text-primary/40" />
                </div>
              )}
            </div>
          ))}
        </div>
        <p className="mt-5 text-center text-[11px] text-muted-foreground">
          Each chip is rolled up from the spec that governs it. The{" "}
          <Link to="/" className="text-primary hover:underline">
            status ladder
          </Link>{" "}
          on the home page tracks the same truth.
        </p>
      </div>
    </section>
  );
}

function Catalog({ entries }: { entries: Route.ComponentProps["loaderData"]["entries"] }) {
  return (
    <section className="mt-14">
      <h2 className="mb-6 font-mono text-2xl font-bold">The repositories.</h2>
      <div className="space-y-5">
        {entries.map(({ meta, detail, baked }) => (
          <div
            key={meta.repo}
            id={meta.repo}
            className="scroll-mt-20 overflow-hidden rounded-lg border border-border/60 bg-card p-6 transition-all hover:border-primary/20"
          >
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-mono text-base font-bold">{meta.name}</h3>
                <p className="text-xs text-muted-foreground">{meta.role}</p>
              </div>
              <span className="rounded border border-border/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                {meta.license}
              </span>
            </div>

            <p className="mb-4 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              {detail.blurb}
            </p>

            <div className="mb-4 grid gap-x-6 gap-y-1.5 md:grid-cols-2">
              {detail.highlights.map((h) => (
                <div key={h} className="flex items-start gap-2 text-xs">
                  <span className="mt-0.5 font-mono text-primary">&#9656;</span>
                  <span className="text-foreground/80">{h}</span>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-4 border-t border-border/30 pt-4">
              <a
                href={meta.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium transition-colors hover:text-primary"
              >
                GitHub <ExternalLink className="h-3 w-3" />
              </a>
              {baked && (
                <Link
                  to="/registry"
                  className="inline-flex items-center gap-1.5 text-xs font-medium transition-colors hover:text-primary"
                >
                  Spec corpus
                </Link>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function Products({ loaderData }: Route.ComponentProps) {
  return (
    <div className="container mx-auto max-w-4xl px-4 py-16">
      <Hero />
      <ArchitectureLayers />
      <DeliveryFlow flow={loaderData.flow} />
      <Catalog entries={loaderData.entries} />
    </div>
  );
}

import { Link } from "react-router";
import type { Route } from "./+types/get-started";
import { ORG_URL } from "~/lib/product-family";
import {
  INSTALL_COMMAND,
  NEXT_LINKS,
  PLANNED_STEPS,
  TODAY_STEPS,
  type Step,
} from "~/lib/get-started";
import { ArrowRight, ExternalLink, ShieldCheck, Terminal } from "~/components/icons";

// Get started (spec 004 section 3.5). Two honest halves: what runs today, and
// what is a milestone. Each step links to the governing spec (a /registry page)
// or the real repo, so nothing claims a path that does not exist.

export function meta(_: Route.MetaArgs): Route.MetaDescriptors {
  return [
    { title: "Get started: Statecraft" },
    {
      name: "description",
      content:
        "What you can run today: govern a corpus with spec-spine, run the enrahitu substrate. And what is a milestone: stamping apps and self-hosting the control plane.",
    },
  ];
}

function StepCard({ step, index, planned }: { step: Step; index: number; planned: boolean }) {
  return (
    <div className="relative flex gap-4">
      <div className="relative z-10 flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-primary/40 bg-primary/5">
        <span className="font-mono text-xs font-bold text-primary">
          {String(index).padStart(2, "0")}
        </span>
      </div>
      <div className="flex-1 pb-8">
        <div className="rounded-lg border border-border/60 bg-card p-5 transition-colors hover:border-primary/20">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h3 className="font-mono text-sm font-bold">{step.title}</h3>
            {planned && (
              <span className="rounded border border-border/50 px-1.5 py-0.5 font-mono text-[9px] uppercase text-muted-foreground">
                planned
              </span>
            )}
          </div>
          <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
            {step.body}
          </p>
          {step.command && (
            <div className="mb-3 overflow-x-auto rounded-md border border-border/30 bg-muted/40 px-3 py-2">
              <code className="whitespace-nowrap font-mono text-xs text-primary">
                $ {step.command}
              </code>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-4 border-t border-border/30 pt-3">
            {step.repo && (
              <a
                href={`${ORG_URL}/${step.repo}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium transition-colors hover:text-primary"
              >
                {step.repo} <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {step.spec && (
              <Link
                to={`/registry/${step.spec.repo}/${step.spec.id}`}
                className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground transition-colors hover:text-primary"
              >
                <ShieldCheck className="h-3 w-3" /> governing spec
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function GetStarted() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-16">
      <div className="mb-4 flex items-center gap-2">
        <Terminal className="h-4 w-4 text-primary" />
        <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
          Get started
        </span>
      </div>
      <h1 className="mb-4 font-mono text-3xl font-bold leading-tight md:text-4xl">
        Run what ships. Watch what is landing.
      </h1>
      <p className="mb-8 leading-relaxed text-muted-foreground">
        Statecraft is built in the open, one milestone at a time. Two things run
        today on their own: the governance toolchain and the substrate. The
        control plane that ties them into one loop is landing rung by rung, and
        every step below links to the spec that governs it.
      </p>

      <div className="mb-10 rounded-md border border-border/30 bg-muted/40 px-4 py-3">
        <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Install the toolchain
        </span>
        <code className="font-mono text-sm text-primary">$ {INSTALL_COMMAND}</code>
      </div>

      <h2 className="mb-6 font-mono text-xs font-bold uppercase tracking-wider text-primary">
        Runnable today
      </h2>
      <div>
        {TODAY_STEPS.map((step, i) => (
          <StepCard key={step.id} step={step} index={i + 1} planned={false} />
        ))}
      </div>

      <h2 className="mb-6 mt-6 font-mono text-xs font-bold uppercase tracking-wider text-muted-foreground">
        On the ladder
      </h2>
      <div>
        {PLANNED_STEPS.map((step, i) => (
          <StepCard
            key={step.id}
            step={step}
            index={TODAY_STEPS.length + i + 1}
            planned
          />
        ))}
      </div>

      <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-6">
        <h2 className="mb-3 font-mono text-base font-bold text-primary">Where next?</h2>
        <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
          The status ladder on the home page is authoritative for how far each
          rung has come; it rolls up straight from the specs on every deploy.
        </p>
        <div className="flex flex-wrap gap-3">
          {NEXT_LINKS.map((l) => (
            <Link
              key={l.href}
              to={l.href}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
            >
              {l.label} <ArrowRight className="h-3 w-3" />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

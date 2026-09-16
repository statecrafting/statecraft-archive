import { Link } from "react-router";
import { ArrowRight, Clock, FileText, ShieldCheck } from "lucide-react";
import { readerPapers } from "../lib/papers";

export function meta() {
  return [
    { title: "White Papers: Open Agentic Platform" },
    {
      name: "description",
      content:
        "Governed publications. Each paper is bound to a governing spec, every section carries a content hash, every publication has a verifiable governance certificate.",
    },
  ];
}

export default function Papers() {
  const flagship = readerPapers.find((p) => p.featured);
  const focused = readerPapers.filter((p) => !p.featured);

  return (
    <div className="container mx-auto max-w-6xl px-4 py-16">
      <div className="mb-8 max-w-3xl">
        <div className="mb-4 flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            White Papers
          </span>
        </div>
        <h1 className="mb-4 font-mono text-3xl font-bold leading-tight md:text-4xl">
          Governed publications.
        </h1>
        <p className="leading-relaxed text-muted-foreground">
          Each paper is bound to a governing spec. Every section carries a content
          hash. Every publication has a verifiable governance certificate. This is
          what spec-governed content looks like in practice.
        </p>
      </div>

      <div className="mb-10 inline-flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-4 py-2 font-mono text-xs text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5 text-primary" />
        All papers verified by tenant-tail at 2026-07-04T06:00:00Z &middot;
        coupling-gate: pass
      </div>

      {/* Flagship */}
      {flagship && (
        <Link
          to={`/papers/${flagship.slug}`}
          className="group mb-8 block overflow-hidden rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card p-8 transition-all hover:border-primary/50 hover:glow-cyan-sm"
        >
          <span className="spec-chip mb-4">
            <span className="pulse-dot" /> Featured whitepaper
          </span>
          <h2 className="font-mono text-2xl font-bold tracking-tight transition-colors group-hover:text-primary md:text-3xl">
            {flagship.title}
          </h2>
          <p className="mt-2 text-lg text-muted-foreground">{flagship.subtitle}</p>
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {flagship.abstract}
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-xs text-muted-foreground">
            <span>{flagship.date}</span>
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" /> {flagship.readingTime} min read
            </span>
            <span>{flagship.sections.length} sections</span>
            <span className="inline-flex items-center gap-1 text-primary">
              Read the whitepaper <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </div>
        </Link>
      )}

      {/* Focused papers */}
      <div className="space-y-4">
        {focused.map((paper, i) => (
          <Link
            key={paper.slug}
            to={`/papers/${paper.slug}`}
            className="group flex gap-5 rounded-lg border border-border/60 bg-card p-6 transition-all hover:border-primary/30"
          >
            <div className="hidden shrink-0 font-mono text-sm text-muted-foreground/60 sm:block">
              {String(i + 1).padStart(2, "0")}
            </div>
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-green-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-400" /> Published
                </span>
                {paper.governingSpec && (
                  <span className="spec-chip">{paper.governingSpec.id}</span>
                )}
              </div>
              <h3 className="font-mono text-lg font-bold transition-colors group-hover:text-primary">
                {paper.title}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">{paper.subtitle}</p>
              <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-muted-foreground/80">
                {paper.abstract}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-muted-foreground">
                <span>{paper.date}</span>
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" /> {paper.readingTime} min read
                </span>
                <span>{paper.sections.length} sections</span>
                {paper.auditTrail && <span>{paper.auditTrail.length} audit entries</span>}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

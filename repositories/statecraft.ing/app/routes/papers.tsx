import { Link } from "react-router";
import type { Route } from "./+types/papers";
import { readerPapers } from "~/lib/papers";
import { ArrowRight, Clock, FileText } from "~/components/icons";

// The papers index (spec 004 section 3.4). One flagship whitepaper ships,
// re-authored to be checkable against the real family; the OAP-era focused
// papers (whose substance was fabricated certificates) are out of scope.

export function meta(_: Route.MetaArgs): Route.MetaDescriptors {
  return [
    { title: "Papers: Statecraft" },
    {
      name: "description",
      content:
        "The Statecraft whitepaper: how a governed agentic delivery control plane is built in the open, with an in-page reader and interactive architecture diagrams.",
    },
  ];
}

export default function Papers() {
  const flagship = readerPapers.find((p) => p.featured) ?? readerPapers[0];
  const rest = readerPapers.filter((p) => p !== flagship);

  return (
    <div className="container mx-auto max-w-4xl px-4 py-16">
      <div className="mb-8 max-w-3xl">
        <div className="mb-4 flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            Papers
          </span>
        </div>
        <h1 className="mb-4 font-mono text-3xl font-bold leading-tight md:text-4xl">
          Writing, checkable against source.
        </h1>
        <p className="leading-relaxed text-muted-foreground">
          The same rule that governs the code governs the words: every claim
          links to a public repo or is marked forward-looking. Read the source,
          then read the paper.
        </p>
      </div>

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

      {rest.length > 0 && (
        <div className="space-y-4">
          {rest.map((paper) => (
            <Link
              key={paper.slug}
              to={`/papers/${paper.slug}`}
              className="group flex gap-5 rounded-lg border border-border/60 bg-card p-6 transition-all hover:border-primary/30"
            >
              <div className="min-w-0">
                <h3 className="font-mono text-lg font-bold transition-colors group-hover:text-primary">
                  {paper.title}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">{paper.subtitle}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

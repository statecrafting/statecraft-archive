import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ArrowLeft, Clock, Printer } from "./icons";
import { ArchitectureExplorer } from "./architecture-explorer";
import type { ReaderPaper } from "~/lib/papers";

// The whitepaper reader (spec 004 section 3.4): sticky TOC, reading-progress,
// scroll-spy, inline **bold** and [ref:N] markers, a positioning table, an
// interactive architecture diagram per section, and a references list. All
// client behaviour is confined to effects, so the article prerenders fully.

// Renders `**bold**` and `[ref:N]` footnote markers inline.
function InlineText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\[ref:\d+\])/g);
  return (
    <>
      {parts.map((part, i) => {
        if (/^\*\*[^*]+\*\*$/.test(part)) {
          return (
            <strong key={i} className="font-semibold text-foreground">
              {part.slice(2, -2)}
            </strong>
          );
        }
        const ref = /^\[ref:(\d+)\]$/.exec(part);
        if (ref) {
          return (
            <sup key={i}>
              <a
                href={`#ref-${ref[1]}`}
                className="ml-0.5 font-mono text-[10px] text-primary hover:underline"
              >
                {ref[1]}
              </a>
            </sup>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

function useReadingProgress() {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    function onScroll() {
      const h = document.documentElement;
      const max = h.scrollHeight - h.clientHeight;
      setProgress(max > 0 ? (h.scrollTop / max) * 100 : 0);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return progress;
}

function useScrollSpy(ids: string[]) {
  const [activeId, setActiveId] = useState(ids[0] ?? "");
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-80px 0px -70% 0px", threshold: 0 }
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [ids.join(",")]);
  return activeId;
}

export function PaperReader({ paper }: { paper: ReaderPaper }) {
  const progress = useReadingProgress();
  const sectionIds = paper.sections.map((s) => s.id);
  const activeId = useScrollSpy(sectionIds);

  return (
    <div className="relative">
      {/* Reading progress */}
      <div className="fixed left-0 right-0 top-14 z-40 h-0.5 bg-transparent">
        <div
          className="h-full bg-primary transition-[width] duration-150 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="container mx-auto max-w-6xl px-4 py-12">
        <Link
          to="/papers"
          className="mb-8 inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground transition-colors hover:text-primary"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> All papers
        </Link>

        <div className="lg:grid lg:grid-cols-[220px_1fr] lg:gap-12">
          {/* TOC */}
          <aside className="hidden lg:block">
            <div className="sticky top-20 self-start">
              <div className="mb-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Contents
              </div>
              <nav className="space-y-1 border-l border-border/60">
                {paper.sections.map((s) => (
                  <a
                    key={s.id}
                    href={`#${s.id}`}
                    className={`-ml-px block border-l-2 py-1 pl-3 text-xs transition-colors ${
                      activeId === s.id
                        ? "border-primary font-medium text-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <span className="font-mono text-[10px] text-muted-foreground/70">
                      {s.number}
                    </span>{" "}
                    {s.title}
                  </a>
                ))}
              </nav>
              <button
                type="button"
                onClick={() => window.print()}
                className="mt-6 inline-flex items-center gap-1.5 rounded-md border border-border/60 px-3 py-1.5 font-mono text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
              >
                <Printer className="h-3.5 w-3.5" /> Print / PDF
              </button>
            </div>
          </aside>

          {/* Article */}
          <article className="min-w-0">
            {/* Header */}
            <header className="mb-10">
              {paper.featured && (
                <span className="spec-chip mb-4">
                  <span className="pulse-dot" /> Featured whitepaper
                </span>
              )}
              <h1 className="font-mono text-3xl font-bold leading-tight tracking-tight md:text-4xl">
                {paper.title}
              </h1>
              <p className="mt-3 text-lg text-muted-foreground">{paper.subtitle}</p>
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground">
                <span>{paper.author}</span>
                <span>{paper.date}</span>
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" /> {paper.readingTime} min read
                </span>
              </div>
            </header>

            {/* Abstract */}
            <div className="mb-10 border-l-2 border-primary/40 pl-5">
              <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-primary">
                Abstract
              </div>
              <p className="text-base leading-relaxed text-muted-foreground">
                {paper.abstract}
              </p>
            </div>

            {/* Stats */}
            {paper.stats && (
              <div className="mb-10 grid grid-cols-1 gap-4 sm:grid-cols-3">
                {paper.stats.map((stat) => (
                  <div
                    key={stat.label}
                    className="rounded-lg border border-border/60 bg-card p-4"
                  >
                    <div className="font-mono text-2xl font-bold text-primary">
                      {stat.value}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {stat.label}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Sections */}
            {paper.sections.map((section) => (
              <section key={section.id} id={section.id} className="mb-12 scroll-mt-24">
                <div className="mb-4 flex flex-wrap items-center gap-3">
                  <span className="font-mono text-3xl font-bold text-primary/30">
                    {section.number}
                  </span>
                  <h2 className="font-mono text-2xl font-bold tracking-tight">
                    {section.title}
                  </h2>
                </div>
                {section.blocks.map((block, bi) => (
                  <div key={bi} className="mb-6">
                    {block.heading && (
                      <h3 className="mb-3 font-semibold">{block.heading}</h3>
                    )}
                    {block.paragraphs.map((p, pi) => (
                      <p
                        key={pi}
                        className="mb-4 text-[15px] leading-[1.75] text-foreground/90"
                      >
                        <InlineText text={p} />
                      </p>
                    ))}
                  </div>
                ))}
                {section.explorer && <ArchitectureExplorer {...section.explorer} />}
              </section>
            ))}

            {/* Positioning table */}
            {paper.comparisonTable && (
              <section className="mb-12">
                <h2 className="mb-2 font-mono text-xl font-bold">
                  {paper.comparisonTable.title}
                </h2>
                <p className="mb-4 text-sm text-muted-foreground">
                  {paper.comparisonTable.description}
                </p>
                <div className="overflow-x-auto rounded-lg border border-border/60">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border/40 bg-muted/30 text-left font-mono">
                        <th className="px-3 py-2 font-medium text-muted-foreground">
                          Dimension
                        </th>
                        {paper.comparisonTable.approaches.map((a) => (
                          <th
                            key={a.name}
                            className={`px-3 py-2 font-medium ${
                              a.highlight ? "text-primary" : "text-muted-foreground"
                            }`}
                          >
                            {a.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {paper.comparisonTable.dimensions.map((dim, di) => (
                        <tr key={dim} className="border-b border-border/20">
                          <td className="px-3 py-2 font-mono text-muted-foreground">
                            {dim}
                          </td>
                          {paper.comparisonTable!.approaches.map((a) => (
                            <td
                              key={a.name}
                              className={`px-3 py-2 ${
                                a.highlight
                                  ? "bg-primary/5 text-foreground"
                                  : "text-muted-foreground"
                              }`}
                            >
                              {a.values[di]}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* References */}
            {paper.references && (
              <section className="mb-12 border-t border-border/50 pt-8">
                <h2 className="mb-4 font-mono text-xl font-bold">References</h2>
                <ol className="space-y-2">
                  {paper.references.map((ref) => (
                    <li
                      key={ref.id}
                      id={`ref-${ref.id}`}
                      className="scroll-mt-24 text-xs text-muted-foreground"
                    >
                      <span className="font-mono text-primary">[{ref.id}]</span>{" "}
                      <span className="font-mono text-foreground/70">{ref.label}</span>{" "}
                      <a
                        href={ref.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-primary hover:underline"
                      >
                        {ref.title}
                      </a>{" "}
                      <span className="text-muted-foreground/60">
                        (accessed {ref.accessed})
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </article>
        </div>
      </div>
    </div>
  );
}

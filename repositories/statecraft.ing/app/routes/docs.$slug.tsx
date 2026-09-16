import { Link } from "react-router";
import type { Route } from "./+types/docs.$slug";
import { findDoc, type DocStub } from "~/lib/docs";
import { repoMeta } from "~/lib/product-family";

// A single docs stub (spec 002 §3), rendered from app/lib/docs.ts. Prerendered:
// react-router.config.ts enumerates one /docs/:slug path per stub.

export function meta({ data }: Route.MetaArgs): Route.MetaDescriptors {
  if (!data) return [{ title: "Doc not found: Statecraft" }];
  return [
    { title: `${data.doc.title}: Statecraft docs` },
    { name: "description", content: data.doc.summary },
  ];
}

export function loader({ params }: Route.LoaderArgs) {
  const doc = findDoc(params.slug);
  if (!doc) {
    throw new Response("Doc not found", { status: 404 });
  }
  return { doc };
}

const MATURITY: Record<DocStub["maturity"], { label: string; className: string }> = {
  shipping: {
    label: "shipping",
    className:
      "border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  "in-progress": {
    label: "in progress",
    className:
      "border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  planned: {
    label: "planned",
    className: "border border-border bg-muted text-muted-foreground",
  },
};

function DocLinkItem({ label, href }: { label: string; href: string }) {
  const internal = href.startsWith("/");
  const className =
    "inline-flex items-center rounded-md border border-border px-3 py-1.5 font-mono text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground";
  if (internal) {
    return (
      <Link to={href} className={className}>
        {label}
      </Link>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {label} &rarr;
    </a>
  );
}

export default function DocDetail({ loaderData }: Route.ComponentProps) {
  const { doc } = loaderData;
  const meta = repoMeta(doc.repo);
  const maturity = MATURITY[doc.maturity];

  return (
    <article className="container mx-auto max-w-3xl px-4 py-12">
      <nav className="mb-6 font-mono text-xs text-muted-foreground">
        <Link to="/docs" className="transition-colors hover:text-primary">
          docs
        </Link>
        <span className="px-1.5">/</span>
        <span className="text-foreground">{doc.slug}</span>
      </nav>

      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[0.7rem] leading-none ${maturity.className}`}
        >
          {maturity.label}
        </span>
        {meta ? (
          <a
            href={meta.url}
            target="_blank"
            rel="noopener noreferrer"
            className="spec-chip transition-colors hover:text-primary"
          >
            {meta.repo}
            {meta.license ? ` · ${meta.license}` : ""}
          </a>
        ) : null}
      </div>

      <h1 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">
        {doc.title}
      </h1>
      <p className="mt-2 text-lg text-muted-foreground">{doc.summary}</p>

      <div className="mt-8 flex flex-col gap-8">
        {doc.sections.map((section) => (
          <section key={section.heading}>
            <h2 className="font-mono text-sm font-semibold uppercase tracking-wide text-primary">
              {section.heading}
            </h2>
            <div className="mt-3 flex flex-col gap-3 leading-relaxed">
              {section.body.map((para, i) => (
                <p key={i}>{para}</p>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="mt-10 border-t border-border/50 pt-6">
        <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
          Read the source
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {doc.links.map((link) => (
            <DocLinkItem key={link.href} label={link.label} href={link.href} />
          ))}
        </div>
      </div>
    </article>
  );
}

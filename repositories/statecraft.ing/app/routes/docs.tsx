import { Link } from "react-router";
import type { Route } from "./+types/docs";
import { DOC_STUBS, type DocStub } from "~/lib/docs";
import { repoMeta } from "~/lib/product-family";

// Docs index (spec 002 §3): a short shelf of stubs, each sourced from a repo's
// own README and specs. The stubs link and summarize; the source stays the
// source. Static content module, no loader needed.

export function meta(_: Route.MetaArgs): Route.MetaDescriptors {
  return [
    { title: "Docs: Statecraft" },
    {
      name: "description",
      content:
        "Documentation for the Statecraft product family, sourced from each repo's own specs: what EnRaHiTu is, the template contract, and self-hosting the control plane.",
    },
  ];
}

const MATURITY_LABEL: Record<DocStub["maturity"], string> = {
  shipping: "shipping",
  "in-progress": "in progress",
  planned: "planned",
};

function DocCard({ doc }: { doc: DocStub }) {
  const meta = repoMeta(doc.repo);
  return (
    <Link
      to={`/docs/${doc.slug}`}
      className="group flex flex-col rounded-xl border border-border/70 bg-card/40 p-5 transition-colors hover:border-primary/50"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-sm font-semibold group-hover:text-primary">
          {doc.title}
        </span>
        <span
          aria-hidden
          className="text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
        >
          &rarr;
        </span>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{doc.summary}</p>
      <div className="mt-4 flex flex-wrap items-center gap-2 font-mono text-[0.7rem] text-muted-foreground">
        {meta ? (
          <span>
            {meta.repo}
            {meta.license ? ` · ${meta.license}` : ""}
          </span>
        ) : null}
        <span aria-hidden>·</span>
        <span>{MATURITY_LABEL[doc.maturity]}</span>
      </div>
    </Link>
  );
}

export default function Docs() {
  return (
    <div className="container mx-auto max-w-4xl px-4 py-16">
      <p className="spec-chip mb-4">
        <span className="pulse-dot" />
        docs
      </p>
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Docs</h1>
      <p className="mt-4 max-w-2xl text-muted-foreground">
        Short, honest entry points into the family, each summarizing a repo's
        own specs rather than restating them. For the full picture, the specs
        are the documentation: browse them in the{" "}
        <Link to="/registry" className="text-primary transition-colors hover:underline">
          registry
        </Link>
        .
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {DOC_STUBS.map((doc) => (
          <DocCard key={doc.slug} doc={doc} />
        ))}
      </div>
    </div>
  );
}

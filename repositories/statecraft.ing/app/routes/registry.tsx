import { Link } from "react-router";
import type { Route } from "./+types/registry";
import { loadRegistry } from "~/lib/registry.server";
import {
  formatAsOf,
  implementationChip,
  specNum,
  statusChip,
  type RepoBucket,
} from "~/lib/registry";
import { repoMeta } from "~/lib/product-family";

export function meta(_: Route.MetaArgs): Route.MetaDescriptors {
  return [
    { title: "Spec registry: Statecraft" },
    {
      name: "description",
      content:
        "The governed spec registries of the Statecraft product family, baked at build time from each repo's compiled shards. Every entry links to its source spec.",
    },
  ];
}

// Runs at build time (ssr: false): reads the baked payload from disk and embeds
// it in the prerendered HTML. No runtime fetch.
export function loader() {
  return loadRegistry();
}

function RepoSection({ bucket, org }: { bucket: RepoBucket; org: string }) {
  const meta = repoMeta(bucket.repo);
  return (
    <section className="rounded-xl border border-border/70 bg-card/40">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 px-4 py-3">
        <div className="flex items-center gap-3">
          <h2 className="font-mono text-base font-semibold">{bucket.repo}</h2>
          {meta?.license ? (
            <span className="spec-chip">{meta.license}</span>
          ) : null}
        </div>
        <div className="flex items-center gap-3 font-mono text-xs text-muted-foreground">
          <span>{bucket.specCount} specs</span>
          <a
            href={`https://github.com/${org}/${bucket.repo}/tree/${bucket.sha}`}
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-primary"
            title={bucket.sha}
          >
            as of {bucket.shortSha}
          </a>
          <span>({formatAsOf(bucket.asOf)})</span>
        </div>
      </header>
      <ul className="divide-y divide-border/40">
        {bucket.specs.map((spec) => (
          <li key={spec.id}>
            <Link
              to={`/registry/${bucket.repo}/${spec.id}`}
              className="flex flex-col gap-1 px-4 py-3 transition-colors hover:bg-accent/50"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">
                  {specNum(spec.id)}
                </span>
                <span className="font-medium">{spec.title}</span>
                <span className={statusChip(spec.status)}>{spec.status}</span>
                {spec.implementation ? (
                  <span className={implementationChip(spec.implementation)}>
                    {spec.implementation}
                  </span>
                ) : null}
              </div>
              {spec.summary ? (
                <p className="line-clamp-2 text-sm text-muted-foreground">
                  {spec.summary}
                </p>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function RegistryIndex({ loaderData }: Route.ComponentProps) {
  const { repos, totalSpecs, generatedAt, org } = loaderData;
  return (
    <div className="container mx-auto max-w-4xl px-4 py-12">
      <div className="blueprint-grid rounded-xl border border-border/60 p-6">
        <p className="spec-chip mb-3">
          <span className="pulse-dot" />
          governed registry
        </p>
        <h1 className="font-mono text-2xl font-bold tracking-tight sm:text-3xl">
          Spec registry
        </h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Every repo in the family is governed by spec-spine: markdown specs
          compile to typed JSON shards. This page bakes those shards at build
          time straight from each public repo, so every entry is checkable
          against its source. {totalSpecs} specs across {repos.length} repos.
        </p>
        <p className="mt-2 font-mono text-xs text-muted-foreground">
          baked {formatAsOf(generatedAt)}
        </p>
      </div>

      <div className="mt-8 flex flex-col gap-6">
        {repos.map((bucket) => (
          <RepoSection key={bucket.repo} bucket={bucket} org={org} />
        ))}
      </div>
    </div>
  );
}

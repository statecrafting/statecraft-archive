import { Link } from "react-router";
import type { Route } from "./+types/registry.$repo.$specId";
import { loadRegistry } from "~/lib/registry.server";
import {
  establishesLabel,
  findSpec,
  formatAsOf,
  githubSpecUrl,
  implementationChip,
  specNum,
  statusChip,
} from "~/lib/registry";
import { repoMeta } from "~/lib/product-family";

export function meta({ data }: Route.MetaArgs): Route.MetaDescriptors {
  if (!data) return [{ title: "Spec not found: Statecraft" }];
  return [
    { title: `${data.spec.id}: ${data.spec.title}` },
    {
      name: "description",
      content: data.spec.summary?.slice(0, 200) ?? data.spec.title,
    },
  ];
}

export function loader({ params }: Route.LoaderArgs) {
  const payload = loadRegistry();
  const hit = findSpec(payload, params.repo, params.specId);
  if (!hit) {
    throw new Response("Spec not found", { status: 404 });
  }
  return {
    org: payload.org,
    repo: hit.bucket.repo,
    sha: hit.bucket.sha,
    shortSha: hit.bucket.shortSha,
    asOf: hit.bucket.asOf,
    spec: hit.spec,
  };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-border/50 py-4">
      <dt className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-2">{children}</dd>
    </div>
  );
}

export default function SpecDetail({ loaderData }: Route.ComponentProps) {
  const { org, repo, sha, shortSha, asOf, spec } = loaderData;
  const meta = repoMeta(repo);
  const sourceUrl = githubSpecUrl(org, repo, sha, spec.specPath);

  return (
    <article className="container mx-auto max-w-3xl px-4 py-12">
      <nav className="mb-6 font-mono text-xs text-muted-foreground">
        <Link to="/registry" className="transition-colors hover:text-primary">
          registry
        </Link>
        <span className="px-1.5">/</span>
        <span>{repo}</span>
        <span className="px-1.5">/</span>
        <span className="text-foreground">{specNum(spec.id)}</span>
      </nav>

      <div className="flex flex-wrap items-center gap-2">
        <span className={statusChip(spec.status)}>{spec.status}</span>
        {spec.implementation ? (
          <span className={implementationChip(spec.implementation)}>
            {spec.implementation}
          </span>
        ) : null}
        {meta?.license ? <span className="spec-chip">{meta.license}</span> : null}
      </div>

      <h1 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">
        {spec.title}
      </h1>
      <p className="mt-1 font-mono text-sm text-muted-foreground">{spec.id}</p>

      {spec.summary ? (
        <p className="mt-6 whitespace-pre-line leading-relaxed">{spec.summary}</p>
      ) : null}

      <dl className="mt-8">
        {spec.dependsOn && spec.dependsOn.length > 0 ? (
          <Field label="Depends on">
            <ul className="flex flex-wrap gap-2 font-mono text-sm">
              {spec.dependsOn.map((dep) => (
                <li key={dep}>
                  <Link
                    to={`/registry/${repo}/${dep}`}
                    className="rounded border border-border bg-muted px-2 py-0.5 transition-colors hover:border-primary/50 hover:text-primary"
                  >
                    {dep}
                  </Link>
                </li>
              ))}
            </ul>
          </Field>
        ) : null}

        {spec.establishes && spec.establishes.length > 0 ? (
          <Field label="Establishes">
            <ul className="flex flex-col gap-1 font-mono text-sm">
              {spec.establishes.map((u, i) => (
                <li key={i} className="text-muted-foreground">
                  {establishesLabel(u)}
                </li>
              ))}
            </ul>
          </Field>
        ) : null}

        {spec.sectionHeadings && spec.sectionHeadings.length > 0 ? (
          <Field label="Sections">
            <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
              {spec.sectionHeadings.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          </Field>
        ) : null}

        {spec.unamendable && spec.unamendable.length > 0 ? (
          <Field label="Unamendable invariants">
            <ul className="flex flex-wrap gap-2 font-mono text-xs">
              {spec.unamendable.map((u) => (
                <li
                  key={u}
                  className="rounded border border-border bg-muted px-2 py-0.5 text-muted-foreground"
                >
                  {u}
                </li>
              ))}
            </ul>
          </Field>
        ) : null}

        <Field label="Source">
          <div className="flex flex-col gap-2 text-sm">
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-primary transition-colors hover:underline"
            >
              {spec.specPath ?? repo} @ {shortSha}
            </a>
            <span className="font-mono text-xs text-muted-foreground">
              as of {formatAsOf(asOf)}
              {spec.shardHash ? ` · shard ${spec.shardHash.slice(0, 12)}` : ""}
            </span>
          </div>
        </Field>
      </dl>
    </article>
  );
}

import { Link } from "react-router";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertTriangle,
  ArrowLeft,
  ExternalLink,
  FileText,
  GitBranch,
  ListTree,
  Network,
  Tag,
  User,
} from "lucide-react";
import type { Route } from "./+types/registry.$specId";
import { getSpecDetail, type SpecDetailRecord, type SpecRef } from "../lib/spec-details";
import { DOMAIN_COLORS } from "../lib/domain-colors";

const GITHUB_BLOB =
  "https://github.com/statecrafting/open-agentic-platform/blob/main";

export async function loader({ params }: Route.LoaderArgs) {
  return { detail: getSpecDetail(params.specId) ?? null };
}

export function meta({ loaderData }: Route.MetaArgs) {
  const t = loaderData?.detail?.title;
  return [{ title: t ? `${t} | OAP Registry` : "Spec | OAP Registry" }];
}

const RISK_BADGE: Record<string, string> = {
  high: "text-red-400 border-red-500/30 bg-red-500/10",
  medium: "text-amber-400 border-amber-500/30 bg-amber-500/10",
  low: "text-green-400 border-green-500/30 bg-green-500/10",
};

const STATUS_PILL: Record<string, string> = {
  approved: "border-green-500/30 text-green-400",
  superseded: "border-yellow-500/30 text-yellow-400",
  draft: "border-blue-500/30 text-blue-400",
};

export default function SpecDetail({ loaderData }: Route.ComponentProps) {
  const detail = loaderData.detail;

  if (!detail) {
    return (
      <div className="container mx-auto max-w-6xl px-4 py-16 text-center">
        <h2 className="font-mono text-xl font-bold">Spec not found</h2>
        <Link
          to="/registry"
          className="mt-4 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Back to registry
        </Link>
      </div>
    );
  }

  const domainColor = DOMAIN_COLORS[detail.domain] ?? DOMAIN_COLORS.unknown;

  return (
    <div className="container mx-auto max-w-6xl px-4 py-12">
      <Link
        to="/registry"
        className="mb-6 inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground transition-colors hover:text-primary"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Registry
      </Link>

      {/* Header */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm text-muted-foreground">{detail.num}</span>
        <Badge>{detail.status}</Badge>
        <Badge>{detail.implementation}</Badge>
        <span
          className="inline-flex items-center gap-1 font-mono text-[11px]"
          style={{ color: domainColor }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: domainColor }} />
          {detail.domain}
        </span>
        <span className="spec-chip">{detail.kind}</span>
        {detail.risk && (
          <span
            className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase ${
              RISK_BADGE[detail.risk] ?? "text-muted-foreground border-border/40"
            }`}
          >
            <AlertTriangle className="h-3 w-3" /> {detail.risk} risk
          </span>
        )}
      </div>

      <h2 className="font-mono text-2xl font-bold tracking-tight">{detail.title}</h2>
      <div className="mt-2 flex flex-wrap items-center gap-4 font-mono text-xs text-muted-foreground">
        <span>{detail.id}</span>
        <span>created {detail.created}</span>
        {detail.owner && (
          <span className="inline-flex items-center gap-1">
            <User className="h-3 w-3" /> {detail.owner}
          </span>
        )}
        {detail.specPath && (
          <a
            href={`${GITHUB_BLOB}/${detail.specPath}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 hover:text-primary"
          >
            View on GitHub <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      {detail.summary && (
        <p className="mt-6 max-w-3xl text-sm leading-relaxed text-foreground/85">
          {detail.summary}
        </p>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_300px]">
        {/* Main column */}
        <div className="min-w-0 space-y-8">
          {detail.body && (
            <section>
              <SectionTitle icon={FileText}>Specification</SectionTitle>
              <div className="relative rounded-lg border border-border/60 bg-card p-5">
                <div className="space-y-3 text-sm leading-relaxed text-foreground/85 [&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-muted/50 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-primary [&_h2]:mt-5 [&_h2]:font-mono [&_h2]:text-base [&_h2]:font-bold [&_h3]:mt-4 [&_h3]:font-semibold [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:font-semibold [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:pl-5">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{detail.body}</ReactMarkdown>
                </div>
                {detail.bodyTruncated && detail.specPath && (
                  <div className="mt-4 border-t border-border/40 pt-3">
                    <a
                      href={`${GITHUB_BLOB}/${detail.specPath}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline"
                    >
                      Continue reading on GitHub <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                )}
              </div>
            </section>
          )}

          {detail.sectionHeadings.length > 0 && (
            <section>
              <SectionTitle icon={ListTree}>Outline</SectionTitle>
              <ul className="rounded-lg border border-border/60 bg-card p-4 font-mono text-xs">
                {detail.sectionHeadings.map((h, i) => (
                  <li
                    key={`${h}-${i}`}
                    className={`py-0.5 ${/^\d/.test(h.trim()) ? "text-foreground/80" : "text-muted-foreground pl-3"}`}
                  >
                    {h}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Relationships */}
          <section>
            <SectionTitle icon={GitBranch}>Relationships</SectionTitle>
            <div className="grid gap-4 md:grid-cols-2">
              <Panel title="Outgoing">
                <RefGroup label="supersedes" refs={detail.supersedesSpecs} />
                <RefGroup label="amends" refs={detail.amendsSpecs} />
                <RefGroup
                  label="extends"
                  refs={detail.extendsSpecs.map((e) => ({ id: e.id, title: e.title }))}
                />
                <RefGroup label="depends on" refs={detail.dependsOnSpecs} />
                {detail.supersededBy && (
                  <RefGroup label="superseded by" refs={[detail.supersededBy]} />
                )}
                {detail.amendedBy && <RefGroup label="amended by" refs={[detail.amendedBy]} />}
                {detail.constrains.map((c, i) => (
                  <RefGroup key={i} label={`constrains (${c.kind})`} refs={c.targets} />
                ))}
                {detail.refines.length > 0 && (
                  <div className="mb-2">
                    <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      refines
                    </div>
                    <ul className="space-y-1">
                      {detail.refines.map((r, i) => (
                        <li key={i} className="font-mono text-[11px] text-foreground/70">
                          {r.aspect}
                          {r.unit ? ` (${r.unit})` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {isOutgoingEmpty(detail) && <Empty />}
              </Panel>
              <Panel title="Incoming">
                {detail.incoming.length === 0 ? (
                  <Empty />
                ) : (
                  <ul className="space-y-1.5">
                    {detail.incoming.map((it, i) => (
                      <li key={`${it.id}-${i}`} className="flex items-center gap-2 text-xs">
                        <span className="spec-chip shrink-0">{it.type}</span>
                        <Link to={`/registry/${it.id}`} className="truncate hover:text-primary">
                          {it.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>
          </section>

          {detail.establishes.length > 0 && (
            <section>
              <SectionTitle icon={FileText}>Establishes code paths</SectionTitle>
              <ul className="grid gap-1.5 rounded-lg border border-border/60 bg-card p-4 sm:grid-cols-2">
                {detail.establishes.map((e, i) => (
                  <li key={`${e.path}-${i}`} className="flex items-start gap-2 font-mono text-[11px]">
                    <span className="mt-0.5 rounded bg-primary/10 px-1 text-[9px] text-primary">
                      {e.kind}
                    </span>
                    <span className="break-all text-foreground/75">{e.path}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {detail.references.length > 0 && (
            <section>
              <SectionTitle icon={FileText}>References</SectionTitle>
              <ul className="space-y-1.5 rounded-lg border border-border/60 bg-card p-4">
                {detail.references.map((r, i) => (
                  <li key={i} className="flex items-center gap-2 font-mono text-[11px]">
                    <span className="rounded bg-muted/50 px-1.5 py-0.5 text-[9px] text-muted-foreground">
                      {r.role}
                    </span>
                    <span className="break-all text-foreground/70">{r.unit}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <Panel title="Frontmatter">
            <dl className="space-y-1.5 text-xs">
              <Row label="Kind" value={detail.kind} />
              <Row label="Domain" value={detail.domain} />
              <Row label="Owner" value={detail.owner || "-"} />
              <Row label="Risk" value={detail.risk || "-"} />
              <Row label="Created" value={detail.created} />
              {detail.dates.amended && <Row label="Amended" value={detail.dates.amended} />}
              {detail.dates.closed && <Row label="Closed" value={detail.dates.closed} />}
              {detail.slug && <Row label="Slug" value={detail.slug} mono />}
              {detail.codeAliases.length > 0 && (
                <Row label="Alias" value={detail.codeAliases.join(", ")} mono />
              )}
            </dl>
          </Panel>

          {detail.timeline.length > 0 && (
            <Panel title="Lifecycle">
              <ol className="space-y-3">
                {detail.timeline.map((ev, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
                    <div className="min-w-0">
                      <div className="text-xs">{ev.label}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">{ev.date}</div>
                    </div>
                  </li>
                ))}
              </ol>
            </Panel>
          )}

          <Panel title="Impact analysis">
            <div className="flex items-center gap-2">
              <Network className="h-4 w-4 text-primary" />
              <span className="font-mono text-2xl font-bold text-primary">
                {detail.directDependents.length}
              </span>
              <span className="text-xs text-muted-foreground">direct dependents</span>
            </div>
            <div className="mt-1 font-mono text-[11px] text-muted-foreground">
              {detail.transitiveDependentCount} transitive
            </div>
            {detail.directDependents.length > 0 && (
              <ul className="mt-3 space-y-1">
                {detail.directDependents.slice(0, 12).map((d) => (
                  <li key={d.id} className="truncate text-xs">
                    <Link to={`/registry/${d.id}`} className="hover:text-primary">
                      {d.title}
                    </Link>
                  </li>
                ))}
                {detail.directDependents.length > 12 && (
                  <li className="font-mono text-[10px] text-muted-foreground">
                    +{detail.directDependents.length - 12} more
                  </li>
                )}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      {detail.related.length > 0 && (
        <div className="mt-10">
          <h3 className="mb-4 flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
            <Tag className="h-3.5 w-3.5 text-primary" />
            Related specifications
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {detail.related.map((s) => (
              <Link
                key={s.id}
                to={`/registry/${s.id}`}
                className="group rounded-lg border border-border/60 bg-card p-4 transition-all hover:border-primary/30"
              >
                <div className="mb-2 flex items-center gap-2">
                  <span className="spec-chip text-[9px]">{s.num}</span>
                  <span
                    className={`rounded border px-1.5 py-0.5 font-mono text-[9px] ${
                      STATUS_PILL[s.status] ?? "border-border/40 text-muted-foreground"
                    }`}
                  >
                    {s.status}
                  </span>
                </div>
                <h4 className="mb-2 line-clamp-2 font-mono text-xs font-bold transition-colors group-hover:text-primary">
                  {s.title}
                </h4>
                <div className="flex flex-wrap gap-1">
                  {s.sharedTags.slice(0, 3).map((tag) => (
                    <span
                      key={tag}
                      className="rounded border border-primary/20 bg-primary/10 px-1.5 py-0.5 font-mono text-[9px] text-primary/80"
                    >
                      {tag}
                    </span>
                  ))}
                  {s.sharedTags.length > 3 && (
                    <span className="font-mono text-[9px] text-muted-foreground">
                      +{s.sharedTags.length - 3}
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function isOutgoingEmpty(d: SpecDetailRecord): boolean {
  return (
    d.supersedesSpecs.length === 0 &&
    d.amendsSpecs.length === 0 &&
    d.extendsSpecs.length === 0 &&
    d.dependsOnSpecs.length === 0 &&
    d.refines.length === 0 &&
    d.constrains.length === 0 &&
    !d.supersededBy &&
    !d.amendedBy
  );
}

function SectionTitle({ icon: Icon, children }: { icon: typeof FileText; children: React.ReactNode }) {
  return (
    <h3 className="mb-3 flex items-center gap-2 font-mono text-sm font-bold">
      <Icon className="h-4 w-4 text-primary" />
      {children}
    </h3>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card p-4">
      <div className="mb-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded border border-border/40 bg-muted/30 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
      {children}
    </span>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border/20 py-1 last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`text-right text-foreground/80 ${mono ? "font-mono text-[11px]" : ""}`}>
        {value}
      </dd>
    </div>
  );
}

function RefGroup({ label, refs }: { label: string; refs: SpecRef[] }) {
  if (refs.length === 0) return null;
  return (
    <div className="mb-2">
      <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <ul className="space-y-1">
        {refs.map((r) => (
          <li key={r.id} className="text-xs">
            <Link to={`/registry/${r.id}`} className="hover:text-primary">
              {r.title}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Empty() {
  return <p className="font-mono text-xs text-muted-foreground/60">None</p>;
}

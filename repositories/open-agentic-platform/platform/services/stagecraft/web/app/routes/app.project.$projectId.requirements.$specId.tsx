// Spec 163 §2.4 / FR-005 / FR-006 — single-spec detail view.
//
// Renders one spec.md inside the project's statecraft surface:
//   - frontmatter summary (kind, status, implementation, categories)
//   - markdown body
//   - outgoing + incoming relationship lists (spec 130 projection)
//   - provenance badges with clickable resolution to the Knowledge
//     item or xray fingerprint they originated from (spec 161)

import { Link, useLoaderData } from "react-router";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { requireUser } from "../lib/auth.server";
import {
  showProjectSpec,
  showProjectSpecRelationships,
} from "../lib/spec-registry-api.server";
import type {
  SpecDetail,
  SpecEdge,
  SpecReference,
  SpecRelationships,
} from "../../../api/specRegistry/types";

export async function loader({
  request,
  params,
}: {
  request: Request;
  params: { projectId: string; specId: string };
}) {
  await requireUser(request);
  const [{ spec }, { relationships }] = await Promise.all([
    showProjectSpec(request, params.projectId, params.specId),
    showProjectSpecRelationships(
      request,
      params.projectId,
      params.specId
    ).catch(
      () =>
        ({
          relationships: {
            id: params.specId,
            outgoing: [],
            incoming: [],
          },
        }) as { relationships: SpecRelationships }
    ),
  ]);
  return { projectId: params.projectId, spec, relationships };
}

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  approved: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  superseded: "bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
};

const IMPLEMENTATION_STYLES: Record<string, string> = {
  complete: "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300",
  "in-progress": "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300",
  pending: "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300",
  deferred: "bg-slate-50 text-slate-700 dark:bg-slate-800/40 dark:text-slate-300",
  "n/a": "bg-gray-50 text-gray-700 dark:bg-gray-800/40 dark:text-gray-300",
};

const RELATIONSHIP_DESCRIPTIONS: Record<string, string> = {
  establishes: "code paths this spec brought into existence",
  extends: "additive surface extension of a predecessor",
  refines: "behavior tightening of an aspect",
  supersedes: "replacement of a predecessor",
  amends: "non-replacing patch to a predecessor",
  co_authority: "section-scoped shared authority",
  constrains: "meta-authority over how others may shape code",
};

export default function SpecDetailView() {
  const { projectId, spec, relationships } = useLoaderData() as {
    projectId: string;
    spec: SpecDetail;
    relationships: SpecRelationships;
  };
  const base = `/app/project/${projectId}/requirements`;

  return (
    <div className="space-y-6">
      <nav className="text-xs text-gray-500 dark:text-gray-400">
        <Link
          to={base}
          className="hover:text-gray-700 dark:hover:text-gray-300"
        >
          Requirements
        </Link>
        <span className="mx-1">/</span>
        <span className="font-mono text-gray-700 dark:text-gray-300">
          {spec.id}
        </span>
      </nav>

      <header className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            {spec.title}
          </h2>
          {spec.hasDecompositionOrigin && (
            <span
              className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300"
              title="Derived from Knowledge or xray fingerprint (spec 161)"
            >
              decomposition
            </span>
          )}
        </div>
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <DLPair label="Kind" value={spec.kind ?? "—"} />
          <DLPair
            label="Status"
            value={
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                  STATUS_STYLES[spec.status] ??
                  "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300"
                }`}
              >
                {spec.status}
              </span>
            }
          />
          <DLPair
            label="Implementation"
            value={
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                  IMPLEMENTATION_STYLES[spec.implementation] ??
                  "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300"
                }`}
              >
                {spec.implementation}
              </span>
            }
          />
          <DLPair
            label="Categories"
            value={
              spec.categories.length === 0 ? (
                "—"
              ) : (
                <div className="flex flex-wrap gap-1">
                  {spec.categories.map((c) => (
                    <span
                      key={c}
                      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 uppercase tracking-wide"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              )
            }
          />
        </dl>
        <p className="text-xs font-mono text-gray-400 dark:text-gray-500">
          {spec.specPath}
        </p>
      </header>

      <ProvenanceSection
        references={spec.references}
        projectId={projectId}
      />

      <section className="prose-spec">
        {spec.body ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={MARKDOWN_COMPONENTS}
          >
            {spec.body}
          </ReactMarkdown>
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400 italic">
            Spec body is unavailable (spec.md not readable in the project
            registry root).
          </p>
        )}
      </section>

      <RelationshipsSection
        outgoing={relationships.outgoing}
        incoming={relationships.incoming}
        base={base}
      />
    </div>
  );
}

function DLPair({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400">
        {label}
      </dt>
      <dd className="mt-0.5 text-gray-900 dark:text-gray-100">{value}</dd>
    </div>
  );
}

function ProvenanceSection({
  references,
  projectId,
}: {
  references: SpecReference[];
  projectId: string;
}) {
  // Spec 161 emits `role: decomposition-origin` entries that point at
  // the Knowledge object (or xray fingerprint snapshot) the spec was
  // derived from. We render all references here, but the primary
  // affordance is the decomposition-origin row's click-through to the
  // Knowledge detail page (FR-005, SC-004).
  if (references.length === 0) return null;
  return (
    <section>
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wider mb-2">
        Provenance
      </h3>
      <ul className="space-y-2">
        {references.map((ref, i) => (
          <ProvenanceRow
            key={`${ref.role}-${i}`}
            reference={ref}
            projectId={projectId}
          />
        ))}
      </ul>
    </section>
  );
}

function ProvenanceRow({
  reference,
  projectId,
}: {
  reference: SpecReference;
  projectId: string;
}) {
  const path = reference.unit.path ?? reference.unit.file ?? "";
  const link = resolveProvenanceLink(reference, projectId);
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded font-medium ${
          reference.role === "decomposition-origin"
            ? "bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300"
            : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
        }`}
      >
        {reference.role}
      </span>
      <span className="text-gray-500 dark:text-gray-400">
        {reference.unit.kind}:
      </span>
      {link ? (
        <Link
          to={link}
          className="font-mono text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          {path}
        </Link>
      ) : (
        <span className="font-mono text-gray-700 dark:text-gray-300">
          {path}
        </span>
      )}
    </li>
  );
}

/**
 * FR-005 / SC-004 — resolve a provenance entry to a clickable target.
 * Spec 161 (in draft) is the rendering contract; for the MVP we
 * recognise `knowledge/<id>` paths and route to the Knowledge detail
 * page. Other references render as plain text — the future spec 161
 * surface will refine these.
 */
function resolveProvenanceLink(
  reference: SpecReference,
  projectId: string
): string | null {
  if (reference.role !== "decomposition-origin") return null;
  const path = reference.unit.path ?? reference.unit.file ?? "";
  const m = /^knowledge\/([^/]+)/.exec(path);
  if (!m) return null;
  return `/app/project/${projectId}/knowledge/${m[1]}`;
}

function RelationshipsSection({
  outgoing,
  incoming,
  base,
}: {
  outgoing: SpecEdge[];
  incoming: SpecEdge[];
  base: string;
}) {
  if (outgoing.length === 0 && incoming.length === 0) return null;
  return (
    <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <EdgeList
        title="Outgoing"
        edges={outgoing}
        emptyHint="This spec claims no outgoing relationship-graph edges."
        base={base}
      />
      <EdgeList
        title="Incoming"
        edges={incoming}
        emptyHint="No other spec cites this one yet."
        base={base}
      />
    </section>
  );
}

function EdgeList({
  title,
  edges,
  emptyHint,
  base,
}: {
  title: string;
  edges: SpecEdge[];
  emptyHint: string;
  base: string;
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wider mb-2">
        {title}
      </h3>
      {edges.length === 0 ? (
        <p className="text-xs text-gray-500 dark:text-gray-400 italic">
          {emptyHint}
        </p>
      ) : (
        <ul className="space-y-1">
          {edges.map((edge, i) => (
            <li
              key={`${edge.kind}-${edge.otherSpec}-${i}`}
              className="flex items-baseline gap-2 text-xs"
            >
              <span
                className="inline-flex items-center px-2 py-0.5 rounded font-medium bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                title={RELATIONSHIP_DESCRIPTIONS[edge.kind] ?? edge.kind}
              >
                {edge.kind}
              </span>
              <Link
                to={`${base}/${encodeURIComponent(edge.otherSpec)}`}
                className="font-mono text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                {edge.otherSpec}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Markdown component overrides — same shape as artifact-body-viewer's
// MARKDOWN_COMPONENTS, kept local so the spec view doesn't depend on
// the factory-artifact viewer module.
const MARKDOWN_COMPONENTS: Parameters<typeof ReactMarkdown>[0]["components"] = {
  h1: ({ node: _n, ...props }) => (
    <h1
      className="mt-6 mb-3 text-xl font-semibold text-gray-900 dark:text-gray-100"
      {...props}
    />
  ),
  h2: ({ node: _n, ...props }) => (
    <h2
      className="mt-5 mb-2 text-lg font-semibold text-gray-900 dark:text-gray-100"
      {...props}
    />
  ),
  h3: ({ node: _n, ...props }) => (
    <h3
      className="mt-4 mb-2 text-base font-semibold text-gray-900 dark:text-gray-100"
      {...props}
    />
  ),
  h4: ({ node: _n, ...props }) => (
    <h4
      className="mt-3 mb-1.5 text-sm font-semibold text-gray-900 dark:text-gray-100"
      {...props}
    />
  ),
  p: ({ node: _n, ...props }) => (
    <p
      className="my-2 text-sm leading-relaxed text-gray-800 dark:text-gray-200"
      {...props}
    />
  ),
  ul: ({ node: _n, ...props }) => (
    <ul
      className="my-2 list-disc pl-6 space-y-0.5 text-sm text-gray-800 dark:text-gray-200"
      {...props}
    />
  ),
  ol: ({ node: _n, ...props }) => (
    <ol
      className="my-2 list-decimal pl-6 space-y-0.5 text-sm text-gray-800 dark:text-gray-200"
      {...props}
    />
  ),
  li: ({ node: _n, ...props }) => <li className="leading-relaxed" {...props} />,
  a: ({ node: _n, ...props }) => (
    <a
      className="text-indigo-600 dark:text-indigo-400 hover:underline"
      target="_blank"
      rel="noreferrer"
      {...props}
    />
  ),
  blockquote: ({ node: _n, ...props }) => (
    <blockquote
      className="my-2 border-l-4 border-gray-300 dark:border-gray-600 pl-3 text-gray-600 dark:text-gray-400 italic"
      {...props}
    />
  ),
  code: ({ node: _n, className, children, ...props }) => {
    const isBlock =
      typeof className === "string" && className.startsWith("language-");
    if (isBlock) {
      return (
        <code className={`${className ?? ""} font-mono text-[12px]`} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code
        className="rounded bg-gray-100 dark:bg-gray-800 px-1 py-0.5 font-mono text-[12px] text-gray-800 dark:text-gray-200"
        {...props}
      >
        {children}
      </code>
    );
  },
  pre: ({ node: _n, ...props }) => (
    <pre
      className="my-2 overflow-x-auto rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 p-3 text-[12px] leading-relaxed text-gray-800 dark:text-gray-200"
      {...props}
    />
  ),
  table: ({ node: _n, ...props }) => (
    <div className="my-2 overflow-x-auto">
      <table
        className="w-full border-collapse text-left text-[13px]"
        {...props}
      />
    </div>
  ),
  thead: ({ node: _n, ...props }) => (
    <thead
      className="border-b border-gray-300 dark:border-gray-600"
      {...props}
    />
  ),
  th: ({ node: _n, ...props }) => (
    <th
      className="px-2 py-1 font-semibold text-gray-900 dark:text-gray-100"
      {...props}
    />
  ),
  td: ({ node: _n, ...props }) => (
    <td
      className="border-t border-gray-200 dark:border-gray-800 px-2 py-1 align-top"
      {...props}
    />
  ),
  hr: ({ node: _n, ...props }) => (
    <hr className="my-3 border-gray-200 dark:border-gray-700" {...props} />
  ),
};

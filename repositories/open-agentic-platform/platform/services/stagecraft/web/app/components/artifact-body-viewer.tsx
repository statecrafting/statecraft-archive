import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// ---------------------------------------------------------------------------
// Spec 108 Phase 4 (UI follow-up). Reusable detail viewer for factory
// adapter manifests, contract schemas, and process definitions. Replaces
// the previous "JSON.stringify the whole thing" right-side panel: bodies
// that arrive as YAML / Markdown strings now render with real line breaks,
// JSON bodies are pretty-printed, and the raw and metadata views stay one
// tab away.
// ---------------------------------------------------------------------------

export type FactoryArtifact = {
  id?: string;
  name?: string;
  path?: string;
  body?: unknown;
  sourceSha?: string;
  sha?: string;
  version?: string;
  syncedAt?: string;
  [key: string]: unknown;
};

export type ArtifactBodyKind = "markdown" | "yaml" | "json" | "text" | "bundle";

// A "bundle" is an object body that's really a collection of markdown
// documents stored in a JSON wrapper — e.g. an adapter manifest's
// `{ orchestrator: { body }, skills: { <id>: { body } } }` or a process
// definition's `{ agents: { <role>: [{ body, name, description }] } }`.
// Each leaf with a multi-line `body` becomes a `BundleEntry`.
export type BundleEntry = {
  key: string;
  path: string[];
  name?: string;
  description?: string;
  body: string;
};

type EnvelopeBody = { path: string; body: string };

function isEnvelopeBody(value: unknown): value is EnvelopeBody {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { path?: unknown }).path === "string" &&
    typeof (value as { body?: unknown }).body === "string"
  );
}

// The translator wraps raw schema files as `{ path, body }` envelopes
// (api/factory/translator.ts). When that's what the API returned we hoist
// path + body to the top level so the viewer treats the inner string as
// the document instead of pretty-printing the wrapper.
export function unwrapArtifactEnvelope(artifact: FactoryArtifact): FactoryArtifact {
  if (isEnvelopeBody(artifact.body)) {
    return {
      ...artifact,
      path: artifact.path ?? artifact.body.path,
      body: artifact.body.body,
    };
  }
  return artifact;
}

// The Source tab only adds value when Preview hides the raw bytes — i.e. for
// JSON or bundles, where Preview pretty-prints / splits-by-entry and Source
// shows the wire form. For YAML, Markdown, and plain text, Preview already
// renders the bytes verbatim, so a Source tab would be a visual duplicate.
export function isSourceTabAvailable(kind: ArtifactBodyKind): boolean {
  return kind === "json" || kind === "bundle";
}

// A body string qualifies as a bundle "document" body only when it contains
// real or escaped line breaks. Short scalar values like `"y"` or `"v1"` don't
// count — those are configuration values, not embedded documents.
function isBundleDocumentBody(value: string): boolean {
  return value.includes("\n") || value.includes("\\n") || value.includes("\\r\\n");
}

// Walk the body looking for `{ body: string, ... }` records. Each match
// becomes a `BundleEntry`. The `path` is the dotted+indexed JSON path
// (e.g. `agents.client_interface[0]`); `key` prefers `id`/`name` on the
// record and falls back to that path so React keys stay stable across
// renders. Body records are not recursed into — the markdown body is the
// leaf.
export function walkBundleEntries(
  value: unknown,
  path: string[] = [],
): BundleEntry[] {
  if (Array.isArray(value)) {
    const out: BundleEntry[] = [];
    for (let i = 0; i < value.length; i++) {
      const childPath =
        path.length === 0
          ? [`[${i}]`]
          : [...path.slice(0, -1), `${path[path.length - 1]}[${i}]`];
      out.push(...walkBundleEntries(value[i], childPath));
    }
    return out;
  }

  if (value === null || typeof value !== "object") return [];

  const obj = value as Record<string, unknown>;

  if (typeof obj.body === "string" && isBundleDocumentBody(obj.body)) {
    const id = typeof obj.id === "string" && obj.id.length > 0 ? obj.id : null;
    const name =
      typeof obj.name === "string" && obj.name.length > 0 ? obj.name : null;
    const fallback = path.length > 0 ? path.join(".") : "root";
    return [
      {
        key: id ?? name ?? fallback,
        path,
        name: typeof obj.name === "string" ? obj.name : undefined,
        description:
          typeof obj.description === "string" ? obj.description : undefined,
        body: obj.body,
      },
    ];
  }

  const out: BundleEntry[] = [];
  for (const [k, v] of Object.entries(obj)) {
    out.push(...walkBundleEntries(v, [...path, k]));
  }
  return out;
}

// Adapter and process bodies arrive with embedded markdown serialised as
// escape sequences (`\n`, `\r\n`) — likely a JSON-string-in-JSON-object
// round trip somewhere in the sync path. Convert those back to real line
// breaks before handing the markdown to the renderer.
export function unescapeBundleBody(body: string): string {
  return body
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n");
}

export function detectArtifactBodyKind(artifact: FactoryArtifact): ArtifactBodyKind {
  const path = String(artifact.path ?? "").toLowerCase();

  if (path.endsWith(".schema.yaml") || path.endsWith(".schema.yml")) return "yaml";
  if (path.endsWith(".yaml") || path.endsWith(".yml")) return "yaml";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".md")) return "markdown";

  // Object / array bodies come from jsonb columns (factory adapters &
  // processes). When they're really collections of markdown documents,
  // render them in bundle mode; otherwise pretty-print as JSON.
  if (artifact.body != null && typeof artifact.body !== "string") {
    if (
      !Array.isArray(artifact.body) &&
      walkBundleEntries(artifact.body).length > 0
    ) {
      return "bundle";
    }
    return "json";
  }

  const body = typeof artifact.body === "string" ? artifact.body : "";
  if (body.startsWith("---\n")) return "markdown";
  const trimmed = body.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json";
  return "text";
}

export function getArtifactDisplayBody(artifact: FactoryArtifact): string {
  const body = artifact.body;
  if (typeof body === "string") return body;
  if (body == null) return "";
  return JSON.stringify(body, null, 2);
}

export function getArtifactMetadata(
  artifact: FactoryArtifact
): Record<string, unknown> {
  const { body: _body, ...metadata } = artifact;
  void _body;
  return metadata;
}

function prettyJson(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

function formatLabel(kind: ArtifactBodyKind): string {
  switch (kind) {
    case "yaml":
      return "YAML";
    case "json":
      return "JSON";
    case "markdown":
      return "Markdown";
    case "text":
      return "Text";
    case "bundle":
      return "Bundle";
  }
}

type Tab = "preview" | "source" | "metadata";

type Props = {
  artifact: FactoryArtifact;
  label?: string;
};

export function ArtifactBodyViewer({ artifact: rawArtifact, label }: Props) {
  const artifact = useMemo(() => unwrapArtifactEnvelope(rawArtifact), [rawArtifact]);
  const kind = useMemo(() => detectArtifactBodyKind(artifact), [artifact]);
  const body = useMemo(() => getArtifactDisplayBody(artifact), [artifact]);
  const metadata = useMemo(() => getArtifactMetadata(artifact), [artifact]);
  const bundleEntries = useMemo(
    () => (kind === "bundle" ? walkBundleEntries(artifact.body) : []),
    [artifact.body, kind],
  );

  const [tab, setTab] = useState<Tab>("preview");
  const [wrap, setWrap] = useState(true);
  const [copied, setCopied] = useState(false);

  const showSourceTab = isSourceTabAvailable(kind);
  // If the user lands on (or was previously on) the Source tab for an artifact
  // whose kind doesn't carry a Source tab, render Preview instead.
  const effectiveTab: Tab = tab === "source" && !showSourceTab ? "preview" : tab;
  const showWrapToggle =
    effectiveTab === "source" || (effectiveTab === "preview" && kind === "yaml");

  const isSchemaPath = typeof artifact.path === "string" && artifact.path.includes(".schema.");
  const headerName = artifact.name ?? label ?? "Artifact";

  const onCopy = async () => {
    if (!body) return;
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked — leave the body visible for manual copy.
    }
  };

  return (
    <div className="artifact-detail flex min-h-0 flex-col rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
      <div className="artifact-detail__header sticky top-0 z-[1] border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <div className="flex min-w-0 items-baseline gap-2">
            {label ? (
              <span className="text-[11px] uppercase tracking-wider font-medium text-gray-500 dark:text-gray-400 shrink-0">
                {label}
              </span>
            ) : null}
            <h3 className="font-mono text-base font-semibold text-gray-900 dark:text-gray-100 break-all">
              {headerName}
            </h3>
            {isSchemaPath ? (
              <span className="shrink-0 rounded bg-indigo-50 dark:bg-indigo-900/30 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
                schema
              </span>
            ) : null}
          </div>
          {typeof artifact.version === "string" ? (
            <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">
              v{artifact.version.slice(0, 12)}
            </span>
          ) : null}
        </div>
        <dl className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs">
          {typeof artifact.path === "string" ? (
            <ProvRow label="path" value={artifact.path} mono />
          ) : null}
          <ProvRow label="format" value={formatLabel(kind)} />
          {typeof artifact.sourceSha === "string" ? (
            <ProvRow label="source sha" value={artifact.sourceSha} mono />
          ) : null}
          {typeof artifact.syncedAt === "string" ? (
            <ProvRow
              label="synced at"
              value={new Date(artifact.syncedAt).toLocaleString()}
            />
          ) : null}
        </dl>
        <div className="mt-3 flex flex-wrap items-center gap-1 border-b border-gray-200 dark:border-gray-700 -mb-3">
          <TabButton
            active={effectiveTab === "preview"}
            onClick={() => setTab("preview")}
          >
            Preview
          </TabButton>
          {showSourceTab ? (
            <TabButton
              active={effectiveTab === "source"}
              onClick={() => setTab("source")}
            >
              Source
            </TabButton>
          ) : null}
          <TabButton
            active={effectiveTab === "metadata"}
            onClick={() => setTab("metadata")}
          >
            Metadata
          </TabButton>
          <div className="ml-auto flex items-center gap-3 pb-2 text-xs text-gray-500 dark:text-gray-400">
            {showWrapToggle ? (
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  className="accent-indigo-600"
                  checked={wrap}
                  onChange={(e) => setWrap(e.target.checked)}
                />
                Wrap lines
              </label>
            ) : null}
            <button
              type="button"
              onClick={onCopy}
              disabled={!body}
              className="rounded border border-gray-200 dark:border-gray-700 px-2 py-0.5 text-[11px] font-medium hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
            >
              {copied ? "Copied" : "Copy body"}
            </button>
          </div>
        </div>
      </div>

      <div
        className={`artifact-detail__body min-h-0 ${
          effectiveTab === "preview" && kind === "bundle"
            ? "overflow-hidden"
            : "overflow-auto px-4 py-3"
        }`}
      >
        {effectiveTab === "preview" ? (
          kind === "bundle" ? (
            <BundlePreviewBody entries={bundleEntries} />
          ) : (
            <PreviewBody body={body} kind={kind} wrap={wrap} />
          )
        ) : effectiveTab === "source" ? (
          <SourceBody body={body} wrap={wrap} />
        ) : (
          <MetadataBody metadata={metadata} />
        )}
      </div>
    </div>
  );
}

function PreviewBody({
  body,
  kind,
  wrap,
}: {
  body: string;
  kind: ArtifactBodyKind;
  wrap: boolean;
}) {
  if (!body) {
    return <EmptyBody />;
  }

  if (kind === "json") {
    return (
      <pre className="artifact-body artifact-body--json whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-gray-800 dark:text-gray-200">
        <code>{prettyJson(body)}</code>
      </pre>
    );
  }

  if (kind === "yaml") {
    return (
      <pre
        className={`artifact-body artifact-body--yaml font-mono text-[12px] leading-relaxed text-gray-800 dark:text-gray-200 ${
          wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre overflow-x-auto"
        }`}
      >
        <code>{body}</code>
      </pre>
    );
  }

  if (kind === "markdown") {
    return (
      <div className="artifact-body artifact-body--markdown text-sm leading-relaxed text-gray-800 dark:text-gray-200 break-words">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={MARKDOWN_COMPONENTS}
        >
          {body}
        </ReactMarkdown>
      </div>
    );
  }

  return (
    <pre className="artifact-body artifact-body--text whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-gray-800 dark:text-gray-200">
      {body}
    </pre>
  );
}

function BundlePreviewBody({ entries }: { entries: BundleEntry[] }) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  if (entries.length === 0) {
    return (
      <div className="px-4 py-3">
        <EmptyBody />
      </div>
    );
  }

  // Local state may reference an entry that disappeared after the artifact
  // changed. Fall back to the first entry rather than an empty pane.
  const effectiveKey =
    (selectedKey && entries.find((e) => e.key === selectedKey)?.key) ??
    entries[0].key;
  const selected =
    entries.find((e) => e.key === effectiveKey) ?? entries[0];

  return (
    <div className="grid h-[60vh] min-h-[20rem] grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
      <ul className="min-h-0 overflow-y-auto border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950/40 py-1 text-xs">
        {entries.map((entry) => {
          const isSelected = entry.key === effectiveKey;
          const label = entry.name ?? entry.key;
          const sub = entry.path.length > 0 ? entry.path.join(".") : "root";
          return (
            <li key={`${entry.path.join(".")}::${entry.key}`}>
              <button
                type="button"
                onClick={() => setSelectedKey(entry.key)}
                aria-current={isSelected ? "true" : undefined}
                className={`block w-full px-3 py-2 text-left transition-colors ${
                  isSelected
                    ? "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
                    : "text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                }`}
              >
                <div className="font-mono font-medium truncate" title={label}>
                  {label}
                </div>
                {sub !== label ? (
                  <div
                    className="mt-0.5 truncate text-[10px] text-gray-500 dark:text-gray-400"
                    title={sub}
                  >
                    {sub}
                  </div>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="min-h-0 overflow-y-auto px-4 py-3">
        <BundleEntryDetail entry={selected} />
      </div>
    </div>
  );
}

function BundleEntryDetail({ entry }: { entry: BundleEntry }) {
  const rendered = useMemo(() => unescapeBundleBody(entry.body), [entry.body]);
  const pathLabel = entry.path.length > 0 ? entry.path.join(".") : "root";
  return (
    <div>
      <header className="mb-3 border-b border-gray-200 dark:border-gray-700 pb-2">
        <div className="font-mono text-sm font-semibold text-gray-900 dark:text-gray-100 break-all">
          {entry.name ?? entry.key}
        </div>
        {entry.description ? (
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
            {entry.description}
          </p>
        ) : null}
        <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500">
          {pathLabel}
        </div>
      </header>
      <div className="artifact-body artifact-body--markdown text-sm leading-relaxed text-gray-800 dark:text-gray-200 break-words">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
          {rendered}
        </ReactMarkdown>
      </div>
    </div>
  );
}

function SourceBody({ body, wrap }: { body: string; wrap: boolean }) {
  if (!body) {
    return <EmptyBody />;
  }
  return (
    <pre
      className={`artifact-source font-mono text-[12px] leading-relaxed text-gray-800 dark:text-gray-200 ${
        wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre overflow-x-auto"
      }`}
    >
      <code>{body}</code>
    </pre>
  );
}

function MetadataBody({ metadata }: { metadata: Record<string, unknown> }) {
  const json = JSON.stringify(metadata, null, 2);
  return (
    <pre className="artifact-metadata whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-gray-800 dark:text-gray-200">
      <code>{json}</code>
    </pre>
  );
}

function EmptyBody() {
  return (
    <div className="text-sm text-gray-500 dark:text-gray-400 italic">
      No body content.
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors ${
        active
          ? "border-indigo-600 text-indigo-700 dark:text-indigo-300"
          : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
      }`}
    >
      {children}
    </button>
  );
}

// Tailwind-styled overrides for ReactMarkdown. We don't pull in the
// @tailwindcss/typography plugin — keeping the override map tight gives
// us dark-theme parity with the surrounding panel and avoids adding a
// plugin just for this one surface.
const MARKDOWN_COMPONENTS: Parameters<typeof ReactMarkdown>[0]["components"] = {
  h1: ({ node: _n, ...props }) => (
    <h1
      className="mt-4 mb-2 text-xl font-semibold text-gray-900 dark:text-gray-100"
      {...props}
    />
  ),
  h2: ({ node: _n, ...props }) => (
    <h2
      className="mt-4 mb-2 text-lg font-semibold text-gray-900 dark:text-gray-100"
      {...props}
    />
  ),
  h3: ({ node: _n, ...props }) => (
    <h3
      className="mt-3 mb-1.5 text-base font-semibold text-gray-900 dark:text-gray-100"
      {...props}
    />
  ),
  h4: ({ node: _n, ...props }) => (
    <h4
      className="mt-3 mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100"
      {...props}
    />
  ),
  p: ({ node: _n, ...props }) => <p className="my-2" {...props} />,
  ul: ({ node: _n, ...props }) => (
    <ul className="my-2 list-disc pl-5 space-y-0.5" {...props} />
  ),
  ol: ({ node: _n, ...props }) => (
    <ol className="my-2 list-decimal pl-5 space-y-0.5" {...props} />
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
    const isBlock = typeof className === "string" && className.startsWith("language-");
    if (isBlock) {
      return (
        <code
          className={`${className ?? ""} font-mono text-[12px]`}
          {...props}
        >
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
      <table className="w-full border-collapse text-left text-[13px]" {...props} />
    </div>
  ),
  thead: ({ node: _n, ...props }) => (
    <thead className="border-b border-gray-300 dark:border-gray-600" {...props} />
  ),
  th: ({ node: _n, ...props }) => (
    <th className="px-2 py-1 font-semibold text-gray-900 dark:text-gray-100" {...props} />
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

function ProvRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex gap-2 min-w-0">
      <dt className="text-gray-500 dark:text-gray-400 shrink-0">{label}</dt>
      <dd
        className={`text-gray-900 dark:text-gray-200 truncate ${
          mono ? "font-mono" : ""
        }`}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}

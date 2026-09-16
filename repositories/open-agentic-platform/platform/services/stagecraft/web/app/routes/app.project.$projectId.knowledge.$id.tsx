import { useLoaderData, useFetcher, Link, useSearchParams } from "react-router";
import { useState } from "react";
import { requireUser } from "../lib/auth.server";
import {
  getKnowledgeObject,
  getDownloadUrl,
  transitionKnowledgeState,
  deleteKnowledgeObject,
  retryExtraction,
} from "../lib/project-api.server";
import type { KnowledgeObjectRow } from "../lib/project-api.server";
import { redirect } from "react-router";
import { ExtractionView } from "../components/ExtractionView";

export async function loader({
  request,
  params,
}: {
  request: Request;
  params: { projectId: string; id: string };
}) {
  await requireUser(request);
  const { object, bindingsCount } = await getKnowledgeObject(
    request,
    params.projectId,
    params.id,
  );
  return { object, bindingsCount, projectId: params.projectId };
}

export async function action({
  request,
  params,
}: {
  request: Request;
  params: { projectId: string; id: string };
}) {
  await requireUser(request);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "transition") {
    // Spec 115 FR-027 — legacy click-walk only available behind ?debug=1
    // and the server-side env gate. The button is rendered only in debug
    // mode, but the action handler still respects whatever the API
    // returns.
    const targetState = form.get("targetState") as string;
    const res = await transitionKnowledgeState(
      request,
      params.projectId,
      params.id,
      { targetState },
    );
    return { object: res.object };
  }

  if (intent === "retry") {
    // Spec 115 FR-010 — operator re-enqueues a failed extraction.
    const res = await retryExtraction(request, params.projectId, params.id);
    return { retry: res };
  }

  if (intent === "download") {
    const res = await getDownloadUrl(request, params.projectId, params.id);
    return { downloadUrl: res.downloadUrl };
  }

  if (intent === "delete") {
    await deleteKnowledgeObject(request, params.projectId, params.id);
    return redirect(`/app/project/${params.projectId}/knowledge`);
  }

  return null;
}

const VALID_TRANSITIONS: Record<string, string> = {
  imported: "extracting",
  extracting: "extracted",
  extracted: "classified",
  classified: "available",
};

const STATE_COLORS: Record<string, string> = {
  imported: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  extracting: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  extracted: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  classified: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300",
  available: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  // Spec 143 §12 FU-019 — informational tint, same as list view.
  unsupported_type: "bg-slate-100 text-slate-700 dark:bg-slate-800/40 dark:text-slate-300",
};

const STATE_ORDER = ["imported", "extracting", "extracted", "classified", "available"];

export default function KnowledgeObjectDetail() {
  const { object, bindingsCount, projectId } = useLoaderData() as {
    object: KnowledgeObjectRow;
    bindingsCount: number;
    projectId: string;
  };
  const fetcher = useFetcher();
  const downloadFetcher = useFetcher();
  const retryFetcher = useFetcher();
  const [searchParams] = useSearchParams();

  // Spec 115 FR-028 — the legacy click-walk is only visible when the URL
  // carries ?debug=1. Default builds never render the Advance button.
  const debugMode = searchParams.get("debug") === "1";

  const nextState = debugMode ? VALID_TRANSITIONS[object.state] : null;
  const provenance = object.provenance as {
    sourceType?: string;
    sourceUri?: string;
    importedAt?: string;
  };

  const downloadUrl = (downloadFetcher.data as { downloadUrl?: string } | undefined)?.downloadUrl;
  const retryResult = (retryFetcher.data as { retry?: { runId: string } } | undefined)?.retry;

  function confirmDelete(e: React.FormEvent<HTMLFormElement>) {
    const parts = [`Delete "${object.filename}"?`];
    if (object.state === "available") {
      parts.push(
        `This object is in 'available' state — downstream factory runs that reference it will fail until re-bound.`
      );
    }
    if (bindingsCount > 0) {
      parts.push(
        `It is currently bound to ${bindingsCount} project${bindingsCount === 1 ? "" : "s"}; all bindings will be removed.`
      );
    }
    if (!confirm(parts.join("\n\n"))) {
      e.preventDefault();
    }
  }

  return (
    <div className="max-w-7xl space-y-6">
      {/* Breadcrumb */}
      <nav className="text-sm text-gray-500 dark:text-gray-400">
        <Link
          to={`/app/project/${projectId}/knowledge`}
          className="hover:text-gray-700 dark:hover:text-gray-300"
        >
          Knowledge
        </Link>
        <span className="mx-1">/</span>
        <span className="text-gray-900 dark:text-gray-100">
          {object.filename}
        </span>
      </nav>

      {/* Spec 143 §12 FU-018 — two-column layout at ≥md.
          Left: sticky metadata sidebar (filename/state/progress/MetaRow block).
          Right: actions + extraction output + classification.
          Stacks below md. */}
      <div className="grid gap-6 md:grid-cols-[minmax(280px,360px)_1fr]">

      {/* Sidebar (metadata) */}
      <aside className="space-y-6 md:sticky md:top-6 md:self-start">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 break-words">
            {object.filename}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {object.mimeType} &middot; {formatBytes(object.sizeBytes)}
          </p>
        </div>
        <span
          className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium whitespace-nowrap ${STATE_COLORS[object.state] ?? "bg-gray-100 text-gray-800"}`}
        >
          {object.state}
        </span>
      </div>

      {/* State progress bar */}
      <div className="flex items-center gap-1">
        {STATE_ORDER.map((state, i) => {
          const currentIdx = STATE_ORDER.indexOf(object.state);
          const isPast = i <= currentIdx;
          return (
            <div key={state} className="flex-1 flex flex-col items-center gap-1">
              <div
                className={`h-2 w-full rounded-full ${
                  isPast
                    ? "bg-indigo-500"
                    : "bg-gray-200 dark:bg-gray-700"
                }`}
              />
              <span
                className={`text-[10px] ${
                  isPast
                    ? "text-gray-900 dark:text-gray-100 font-medium"
                    : "text-gray-400 dark:text-gray-500"
                }`}
              >
                {state}
              </span>
            </div>
          );
        })}
      </div>

      {/* Metadata */}
      <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        <dl className="divide-y divide-gray-200 dark:divide-gray-700">
          <MetaRow label="ID" value={object.id} />
          <MetaRow label="Storage Key" value={object.storageKey} />
          <MetaRow label="Content Hash (SHA-256)" value={object.contentHash} />
          <MetaRow label="Source Type" value={provenance?.sourceType ?? "—"} />
          <MetaRow label="Source URI" value={provenance?.sourceUri ?? "—"} />
          <MetaRow
            label="Imported At"
            value={
              provenance?.importedAt
                ? new Date(provenance.importedAt).toLocaleString()
                : "—"
            }
          />
          <MetaRow
            label="Created"
            value={new Date(object.createdAt).toLocaleString()}
          />
          <MetaRow
            label="Updated"
            value={new Date(object.updatedAt).toLocaleString()}
          />
        </dl>
      </div>

      </aside>

      {/* Main panel */}
      <main className="space-y-6 min-w-0">

      {/* Spec 115 FR-028 — extraction status + Retry banner. Visible
          whenever the most recent run failed; the button reuses the
          fetcher action handler. */}
      {object.lastExtractionError && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700 rounded-lg p-4 space-y-3">
          <div>
            <p className="text-sm font-semibold text-red-800 dark:text-red-300">
              Extraction failed
            </p>
            <p className="text-sm text-red-700 dark:text-red-400 mt-1">
              <code className="font-mono text-xs">
                {object.lastExtractionError.code}
              </code>
              {object.lastExtractionError.extractorKind && (
                <>
                  {" "}via{" "}
                  <code className="font-mono text-xs">
                    {object.lastExtractionError.extractorKind}
                  </code>
                </>
              )}
            </p>
            <p className="text-xs text-red-600 dark:text-red-400 mt-1 break-words">
              {object.lastExtractionError.message}
            </p>
          </div>
          <retryFetcher.Form method="POST">
            <input type="hidden" name="intent" value="retry" />
            <button
              type="submit"
              disabled={retryFetcher.state !== "idle"}
              className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {retryFetcher.state !== "idle" ? "Retrying…" : "Retry extraction"}
            </button>
          </retryFetcher.Form>
          {retryResult && (
            <p className="text-xs text-red-700 dark:text-red-300">
              Re-enqueued (run id <code className="font-mono">{retryResult.runId}</code>).
              The status badge will update once the worker picks it up.
            </p>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        {/* FR-028: the legacy Advance button only appears in debug mode. */}
        {nextState && (
          <fetcher.Form method="POST">
            <input type="hidden" name="intent" value="transition" />
            <input type="hidden" name="targetState" value={nextState} />
            <button
              type="submit"
              disabled={fetcher.state !== "idle"}
              className="rounded-md bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              title="Legacy debug-only state walk (FR-027)"
            >
              [debug] Advance to {nextState}
            </button>
          </fetcher.Form>
        )}

        <downloadFetcher.Form method="POST">
          <input type="hidden" name="intent" value="download" />
          <button
            type="submit"
            disabled={downloadFetcher.state !== "idle"}
            className="rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
          >
            Get Download Link
          </button>
        </downloadFetcher.Form>

        <fetcher.Form method="POST" onSubmit={confirmDelete}>
          <input type="hidden" name="intent" value="delete" />
          <button
            type="submit"
            className="rounded-md border border-red-300 dark:border-red-700 px-3 py-2 text-sm font-medium text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
          >
            Delete
            {bindingsCount > 0 && (
              <span className="ml-1 text-xs opacity-75">
                ({bindingsCount} binding{bindingsCount === 1 ? "" : "s"})
              </span>
            )}
          </button>
        </fetcher.Form>
      </div>

      {downloadUrl && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
          <p className="text-sm text-green-800 dark:text-green-300">
            Download link ready (expires in 1 hour):
          </p>
          <a
            href={downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline break-all"
          >
            Download {object.filename}
          </a>
        </div>
      )}

      <PreviewSection
        projectId={projectId}
        objectId={object.id}
        mimeType={object.mimeType}
        sizeBytes={object.sizeBytes}
        filename={object.filename}
      />

      {/* Spec 143 §12 FU-017 typed view — replaces the quick-win
          `<pre>` block. ExtractionView renders per-kind header /
          metadata / outline / text / raw-JSON for the three
          deterministic kinds (text/pdf-embedded/docx); agent-* kinds
          fall back to the generic header + text + raw-JSON shape. */}
      {object.extractionOutput && (
        <ExtractionView
          output={object.extractionOutput as Parameters<typeof ExtractionView>[0]["output"]}
          latestRunDurationMs={object.latestRun?.durationMs ?? undefined}
        />
      )}

      {/* Classification */}
      {object.classification && (
        <section>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wider mb-2">
            Classification
          </h3>
          <div className="flex gap-2 flex-wrap">
            {(Array.isArray(object.classification)
              ? object.classification
              : [object.classification]
            ).map((tag: string, i: number) => (
              <span
                key={i}
                className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200"
              >
                {String(tag)}
              </span>
            ))}
          </div>
        </section>
      )}

      </main>
      </div>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  // Spec 143 §12 FU-018 — sidebar is narrow (~320–360px), so labels stack
  // above values. The previous 3-col sm:grid layout truncated long values
  // (storage keys, content hashes) under the new two-column document layout.
  return (
    <div className="px-4 py-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-gray-900 dark:text-gray-100 break-all font-mono">
        {value}
      </dd>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

const PREVIEW_MAX_BYTES = 1024 * 1024; // 1 MB

function isPreviewableMimeType(mime: string): boolean {
  return (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/xml" ||
    mime === "application/javascript" ||
    mime === "application/x-yaml"
  );
}

/**
 * On-demand text preview. Hits the existing presigned-download endpoint and
 * fetches the blob client-side, so no new server route is needed. Files
 * larger than 1 MB or non-text MIME types fall through to the download
 * link only.
 */
function PreviewSection({
  projectId,
  objectId,
  mimeType,
  sizeBytes,
  filename,
}: {
  projectId: string;
  objectId: string;
  mimeType: string;
  sizeBytes: number;
  filename: string;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isPreviewableMimeType(mimeType)) {
    return null;
  }

  const tooLarge = sizeBytes > PREVIEW_MAX_BYTES;

  async function loadPreview() {
    setLoading(true);
    setError(null);
    try {
      const urlRes = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/knowledge/objects/${objectId}/download`,
      );
      if (!urlRes.ok) {
        throw new Error(`Failed to get download URL (${urlRes.status})`);
      }
      const { downloadUrl } = (await urlRes.json()) as { downloadUrl: string };

      const blobRes = await fetch(downloadUrl, {
        // Cap to PREVIEW_MAX_BYTES so we never pull huge files even if the
        // size column lied (the byte-range honours whatever we ask for).
        headers: { Range: `bytes=0-${PREVIEW_MAX_BYTES - 1}` },
      });
      if (!blobRes.ok && blobRes.status !== 206) {
        throw new Error(`Preview fetch failed (${blobRes.status})`);
      }
      const text = await blobRes.text();
      setContent(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wider">
          Preview
        </h3>
        {content === null && (
          <button
            type="button"
            onClick={loadPreview}
            disabled={loading || tooLarge}
            className="text-xs rounded-md border border-gray-300 dark:border-gray-600 px-2 py-1 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Loading…" : tooLarge ? "Too large to preview" : "Show"}
          </button>
        )}
      </div>
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400 mb-2">{error}</p>
      )}
      {content !== null && (
        <pre className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 text-xs text-gray-700 dark:text-gray-300 overflow-auto max-h-96 whitespace-pre-wrap break-words">
          {content}
        </pre>
      )}
      {tooLarge && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {filename} is {formatBytes(sizeBytes)} — preview is capped at{" "}
          {formatBytes(PREVIEW_MAX_BYTES)}. Use the download link instead.
        </p>
      )}
    </section>
  );
}

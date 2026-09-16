import { useLoaderData, Link } from "react-router";
import { requireUser } from "../lib/auth.server";
import {
  listKnowledgeObjects,
  listConnectors,
} from "../lib/project-api.server";
import type {
  KnowledgeObjectRow,
  SourceConnectorRow,
} from "../lib/project-api.server";
import { useState, useRef } from "react";
import {
  KNOWLEDGE_UPLOAD_MAX_BYTES,
  KNOWLEDGE_UPLOAD_MAX_HUMAN,
} from "../../../api/knowledge/uploadLimits";
import { fetchWithRefresh } from "../lib/fetchWithRefresh";

export async function loader({
  request,
  params,
}: {
  request: Request;
  params: { projectId: string };
}) {
  await requireUser(request);

  const url = new URL(request.url);
  const stateFilter = url.searchParams.get("state") ?? undefined;

  const [koRes, connRes] = await Promise.all([
    listKnowledgeObjects(request, params.projectId, stateFilter),
    listConnectors(request, params.projectId).catch(() => ({
      connectors: [] as SourceConnectorRow[],
    })),
  ]);

  return {
    projectId: params.projectId,
    objects: koRes.objects,
    connectors: connRes.connectors,
    stateFilter: stateFilter ?? "all",
  };
}

const STATES = ["all", "imported", "extracting", "extracted", "classified", "available", "unsupported_type"] as const;

const STATE_COLORS: Record<string, string> = {
  imported: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  extracting: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  extracted: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  classified: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300",
  available: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  // Spec 143 §12 FU-019 — informational tint (slate/gray, matching the
  // `imported` neutral aesthetic, not the red of `lastExtractionError`).
  unsupported_type: "bg-slate-100 text-slate-700 dark:bg-slate-800/40 dark:text-slate-300",
};

export default function KnowledgeBrowser() {
  const { projectId, objects, connectors, stateFilter } = useLoaderData() as {
    projectId: string;
    objects: KnowledgeObjectRow[];
    connectors: SourceConnectorRow[];
    stateFilter: string;
  };
  const base = `/app/project/${projectId}/knowledge`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Knowledge Objects
        </h2>
        <UploadControls projectId={projectId} />
      </div>

      {/* State filter tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
        {STATES.map((state) => {
          const isActive = stateFilter === state;
          const count =
            state === "all"
              ? objects.length
              : objects.filter((o) => o.state === state).length;
          return (
            <Link
              key={state}
              to={state === "all" ? base : `${base}?state=${state}`}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                isActive
                  ? "border-indigo-500 text-indigo-600 dark:text-indigo-400"
                  : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400"
              }`}
            >
              {state}
              <span className="ml-1 text-xs text-gray-400">({count})</span>
            </Link>
          );
        })}
      </div>

      {/* Object list */}
      {objects.length === 0 ? (
        <div className="border border-dashed border-gray-300 dark:border-gray-600 rounded-lg px-4 py-12 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
            No knowledge objects
            {stateFilter !== "all" ? ` in "${stateFilter}" state` : ""}.
          </p>
          <p className="text-sm text-gray-400 dark:text-gray-500">
            Upload documents to start building this project's knowledge base.
          </p>
        </div>
      ) : (
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  File
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Type
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Size
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  State
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Source
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Imported
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
              {objects.map((obj) => (
                <tr
                  key={obj.id}
                  className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                >
                  <td className="px-4 py-3">
                    <Link
                      to={`${base}/${obj.id}`}
                      className="text-sm font-medium text-gray-900 dark:text-gray-100 hover:text-indigo-600 dark:hover:text-indigo-400"
                    >
                      {obj.filename}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                    {obj.mimeType}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                    {formatBytes(obj.sizeBytes)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATE_COLORS[obj.state] ?? "bg-gray-100 text-gray-800"}`}
                    >
                      {obj.state}
                    </span>
                    {/* Spec 115 FR-028 — failure indicator on rows whose
                        most recent extraction failed. */}
                    {obj.lastExtractionError && (
                      <span
                        className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
                        title={obj.lastExtractionError.message}
                      >
                        failed: {obj.lastExtractionError.code}
                      </span>
                    )}
                    {/* Spec 115 FR-030 — show the extractor that produced
                        the most recent successful run. */}
                    {!obj.lastExtractionError &&
                      obj.latestRun?.extractorKind && (
                        <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">
                          via {obj.latestRun.extractorKind}
                        </span>
                      )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                    {obj.provenance?.sourceType ?? "unknown"}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                    {new Date(obj.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Connectors summary */}
      {connectors.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wider mb-3">
            Source Connectors
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {connectors.map((c) => (
              <div
                key={c.id}
                className="border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-3 bg-white dark:bg-gray-900"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {c.name}
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded">
                    {c.type}
                  </span>
                </div>
                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Status: {c.status}
                  {c.lastSyncedAt &&
                    ` · Last sync: ${new Date(c.lastSyncedAt).toLocaleDateString()}`}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

type UploadStatus = "pending" | "uploading" | "done" | "failed";

type UploadItem = {
  id: string;
  name: string;
  size: number;
  status: UploadStatus;
  error?: string;
};

/**
 * Upload controls: a "Document" button (single or multi-file) plus a
 * "Folder" button (whole-directory). Both feed the same per-file pipeline:
 * compute SHA-256 → request presigned URL → PUT to S3 → confirm. Files are
 * processed with a small concurrency cap so the browser does not OOM on a
 * folder full of large files.
 */
const UPLOAD_CONCURRENCY = 3;

function UploadControls({ projectId }: { projectId: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [running, setRunning] = useState(false);

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);

    // Spec 143 FR-011 — browser-side size cap. Pre-checking here
    // means files over the cap never consume an objectId/storageKey
    // server-side and never hit the ingress 413 backstop. The
    // server's requestUpload re-checks identically as defence in
    // depth (see api/knowledge/knowledge.ts).
    const initial: UploadItem[] = files.map((f, i) => {
      const name =
        (f as File & { webkitRelativePath?: string }).webkitRelativePath ||
        f.name;
      const oversize = f.size > KNOWLEDGE_UPLOAD_MAX_BYTES;
      return {
        id: `${Date.now()}-${i}-${f.name}`,
        name,
        size: f.size,
        status: oversize ? "failed" : "pending",
        error: oversize
          ? `File exceeds the ${KNOWLEDGE_UPLOAD_MAX_HUMAN} upload size cap`
          : undefined,
      };
    });
    setItems(initial);

    // Filter out the over-cap entries from the actual upload pipeline
    // so we don't waste a presigned-URL request on them. Their failed
    // state is already populated above, so the toast/banner shows the
    // size-cap error immediately.
    const acceptedIndices: number[] = [];
    files.forEach((f, i) => {
      if (f.size <= KNOWLEDGE_UPLOAD_MAX_BYTES) acceptedIndices.push(i);
    });

    if (acceptedIndices.length === 0) {
      // All files rejected — leave the failure panel visible and exit
      // without entering the running state.
      if (fileRef.current) fileRef.current.value = "";
      if (folderRef.current) folderRef.current.value = "";
      return;
    }

    setRunning(true);

    let cursor = 0;
    let failures = files.length - acceptedIndices.length; // pre-rejected count
    const updateItem = (idx: number, patch: Partial<UploadItem>) =>
      setItems((cur) => cur.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

    async function worker() {
      while (true) {
        const cursorIdx = cursor++;
        if (cursorIdx >= acceptedIndices.length) return;
        const idx = acceptedIndices[cursorIdx];
        const file = files[idx];
        updateItem(idx, { status: "uploading" });
        try {
          await uploadOne(file, projectId);
          updateItem(idx, { status: "done" });
        } catch (err) {
          failures++;
          updateItem(idx, {
            status: "failed",
            error: err instanceof Error ? err.message : "Upload failed",
          });
        }
      }
    }

    const workers = Array.from(
      { length: Math.min(UPLOAD_CONCURRENCY, files.length) },
      () => worker()
    );
    await Promise.all(workers);

    setRunning(false);
    if (fileRef.current) fileRef.current.value = "";
    if (folderRef.current) folderRef.current.value = "";

    // If everything succeeded, refresh so the new rows show in the table.
    // Otherwise leave the failure panel visible so the user can read the
    // errors and decide whether to retry.
    if (failures === 0) {
      window.location.reload();
    }
  }

  const completed = items.filter((i) => i.status === "done").length;
  const failed = items.filter((i) => i.status === "failed").length;
  const total = items.length;

  return (
    <div className="relative">
      <input
        ref={fileRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFiles}
      />
      <input
        ref={folderRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFiles}
        {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
      />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={running}
          onClick={() => fileRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {running ? (
            <>
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              {`Uploading ${completed}/${total}${failed ? ` · ${failed} failed` : ""}`}
            </>
          ) : (
            "Upload Documents"
          )}
        </button>
        <button
          type="button"
          disabled={running}
          onClick={() => folderRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Upload Folder
        </button>
      </div>
      {items.length > 0 && (
        <div className="absolute top-full right-0 mt-2 w-96 max-h-72 overflow-auto bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg z-20">
          <ul className="divide-y divide-gray-200 dark:divide-gray-700">
            {items.map((it) => (
              <li key={it.id} className="px-3 py-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-gray-700 dark:text-gray-300" title={it.name}>
                    {it.name}
                  </span>
                  <UploadStatusBadge status={it.status} />
                </div>
                {it.error && (
                  <p className="mt-1 text-red-600 dark:text-red-400 break-words">
                    {it.error}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function UploadStatusBadge({ status }: { status: UploadStatus }) {
  const styles: Record<UploadStatus, string> = {
    pending: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    uploading: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
    done: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
    failed: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[status]}`}>
      {status}
    </span>
  );
}

/**
 * Upload one file end-to-end. The fetch hits the Encore API directly rather
 * than a Remix action — going through the action returns HTML under React
 * Router v7 single-fetch, which breaks `res.json()` on Safari.
 *
 * Spec 143 FU-023: the two Encore-API hits (requestUpload + confirmUpload)
 * go through `fetchWithRefresh` so a mid-batch __session expiry triggers a
 * single-flighted `/auth/refresh` and the request replays cleanly. The S3
 * PUT is a separate origin (presigned URL) and does not carry the auth
 * cookie, so it stays on raw `fetch`.
 */
async function uploadOne(file: File, projectId: string): Promise<void> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const contentHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

  const sourcePath =
    (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;

  const apiBase = `/api/projects/${encodeURIComponent(projectId)}/knowledge`;

  const reqUploadRes = await fetchWithRefresh(`${apiBase}/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      contentHash,
      sizeBytes: file.size,
      sourcePath,
    }),
  });
  if (!reqUploadRes.ok) {
    const body = await reqUploadRes.text();
    throw new Error(
      `Failed to request upload (${reqUploadRes.status}): ${body.slice(0, 200)}`
    );
  }
  const { uploadUrl, objectId } = (await reqUploadRes.json()) as {
    uploadUrl: string;
    objectId: string;
  };

  const s3Res = await fetch(uploadUrl, { method: "PUT", body: buffer });
  if (!s3Res.ok) {
    throw new Error(`S3 upload failed: ${s3Res.status} ${s3Res.statusText}`);
  }

  const confirmRes = await fetchWithRefresh(
    `${apiBase}/objects/${objectId}/confirm`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }
  );
  if (!confirmRes.ok) {
    const body = await confirmRes.text();
    throw new Error(
      `Upload landed but confirm failed (${confirmRes.status}): ${body.slice(0, 200)}`
    );
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

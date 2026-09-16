/**
 * Factory project import (spec 112 §6).
 *
 * Accepts a GitHub repo URL, detects factory state server-side, and
 * either registers the repo (ACP-native) or rejects with an
 * actionable error (not factory / scaffold-only / legacy incomplete).
 * On L1 import, returns the translator's preview for the user to
 * confirm before the platform opens a PR adding
 * `.factory/pipeline-state.json`.
 *
 * After a successful import, this route also lists the project's
 * bound knowledge objects (drawn from `.artifacts/raw/` during import)
 * and exposes a per-row "Advance to extracted" action that shells the
 * artifact-extract CLI and transitions the row to `state=extracted`.
 */

import {
  Form,
  useActionData,
  useFetcher,
  useLoaderData,
  useNavigation,
} from "react-router";
import { useEffect, useMemo, useState } from "react";
import { requireUser } from "../lib/auth.server";
import {
  advanceKnowledgeToExtracted,
  importFactoryProject,
  listImportInstallations,
  listProjectKnowledge,
  type ImportInstallationEntry,
  type ImportedRawArtifact,
  type ProjectKnowledgeObject,
} from "../lib/projects-api.server";

interface ActionSuccess {
  kind: "import";
  projectId: string | null;
  detectionLevel:
    | "not_factory"
    | "scaffold_only"
    | "legacy_produced"
    | "acp_produced";
  repoUrl: string;
  cloneUrl: string;
  opcDeepLink: string | null;
  translatorVersion: string | null;
  translatedPreview?: Record<string, unknown>;
  previewOnly: boolean;
  rawArtifacts: ImportedRawArtifact[];
  rawArtifactsSkipped: number;
  /** L1 only — URL of the translation PR opened on the source repo. */
  pullRequestUrl?: string | null;
  /** L1 only — message when PR opening failed after registration. */
  pullRequestError?: string;
}

interface AdvanceSuccess {
  kind: "advance";
  projectId: string;
  object: ProjectKnowledgeObject;
}

interface ActionFailure {
  kind: "error";
  error: string;
}

type ActionResult = ActionSuccess | AdvanceSuccess | ActionFailure;

interface LoaderData {
  installations: ImportInstallationEntry[];
  installationsError: string | null;
}

export async function loader({ request }: { request: Request }): Promise<LoaderData> {
  await requireUser(request);
  try {
    const { installations } = await listImportInstallations(request);
    return { installations, installationsError: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("listImportInstallations failed", { error: message });
    return { installations: [], installationsError: message };
  }
}

export async function action({ request }: { request: Request }): Promise<ActionResult> {
  const user = await requireUser(request);
  const formData = await request.formData();
  const intent = (formData.get("intent") as string | null) ?? "import";

  if (intent === "advance-extracted") {
    const projectId = (formData.get("projectId") as string | null) ?? "";
    const objectId = (formData.get("objectId") as string | null) ?? "";
    if (!projectId || !objectId) {
      return { kind: "error", error: "projectId and objectId are required" };
    }
    try {
      const advance = await advanceKnowledgeToExtracted(
        request,
        projectId,
        objectId
      );
      const list = await listProjectKnowledge(request, projectId);
      const updated = list.objects.find((o) => o.id === advance.objectId);
      if (!updated) {
        return {
          kind: "error",
          error: "extraction succeeded but the object is no longer bound",
        };
      }
      return { kind: "advance", projectId, object: updated };
    } catch (err) {
      return { kind: "error", error: formatError(err, user.userId) };
    }
  }

  const repoUrl = (formData.get("repoUrl") as string | null) ?? "";
  const name = (formData.get("name") as string | null) ?? "";
  const slug = (formData.get("slug") as string | null) ?? "";
  const description = (formData.get("description") as string | null) ?? "";
  const githubPat = (formData.get("githubPat") as string | null) ?? "";
  const previewOnly = formData.get("action") === "preview";

  if (!repoUrl) {
    return { kind: "error", error: "A GitHub repo URL is required." };
  }

  try {
    const result = await importFactoryProject(request, {
      repoUrl,
      name: name || undefined,
      slug: slug || undefined,
      description: description || undefined,
      githubPat: githubPat.trim() ? githubPat.trim() : undefined,
      previewOnly,
    });
    return { kind: "import", ...result };
  } catch (err) {
    return { kind: "error", error: formatError(err, user.userId) };
  }
}

function formatError(err: unknown, userId: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("importFactoryProject action failed", { userId, error: msg });
  try {
    const parsed = JSON.parse(msg) as { message?: string };
    if (parsed.message) return parsed.message;
  } catch {
    /* not JSON */
  }
  return msg;
}

function isImportSuccess(data: ActionResult | undefined): data is ActionSuccess {
  return Boolean(data && data.kind === "import");
}

function isAdvanceSuccess(
  data: ActionResult | undefined
): data is AdvanceSuccess {
  return Boolean(data && data.kind === "advance");
}

function isFailure(data: ActionResult | undefined): data is ActionFailure {
  return Boolean(data && data.kind === "error");
}

type SourceMode = "installation" | "url";

export default function ImportProject() {
  const actionData = useActionData() as ActionResult | undefined;
  const { installations, installationsError } = useLoaderData() as LoaderData;
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const [repoUrl, setRepoUrl] = useState("");
  const [name, setName] = useState("");
  const totalInstallationRepos = useMemo(
    () => installations.reduce((sum, inst) => sum + inst.repos.length, 0),
    [installations]
  );
  const [sourceMode, setSourceMode] = useState<SourceMode>(
    totalInstallationRepos > 0 ? "installation" : "url"
  );

  if (isImportSuccess(actionData) && !actionData.previewOnly) {
    return <ImportRegistered data={actionData} />;
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Import Existing Project
        </h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Register a factory-produced GitHub repo as a project under your
          org. The platform detects factory state before creating any rows
          and registers any <code>.artifacts/raw/</code> files as project
          knowledge.
        </p>
      </div>

      {isFailure(actionData) && (
        <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3">
          <p className="text-sm text-red-700 dark:text-red-400">
            {actionData.error}
          </p>
        </div>
      )}

      {isImportSuccess(actionData) && actionData.previewOnly && (
        <ImportPreviewPanel data={actionData} />
      )}

      <Form method="post" className="space-y-5">
        <input type="hidden" name="intent" value="import" />
        <div>
          <span className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Source
          </span>
          <div
            className="mt-2 inline-flex rounded-md border border-gray-300 dark:border-gray-600 overflow-hidden text-sm"
            role="tablist"
          >
            <button
              type="button"
              role="tab"
              aria-selected={sourceMode === "installation"}
              onClick={() => setSourceMode("installation")}
              disabled={totalInstallationRepos === 0}
              className={`px-3 py-1.5 ${
                sourceMode === "installation"
                  ? "bg-indigo-600 text-white"
                  : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              Pick from installation
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={sourceMode === "url"}
              onClick={() => setSourceMode("url")}
              className={`px-3 py-1.5 border-l border-gray-300 dark:border-gray-600 ${
                sourceMode === "url"
                  ? "bg-indigo-600 text-white"
                  : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
              }`}
            >
              Paste URL
            </button>
          </div>

          {sourceMode === "installation" ? (
            <InstallationPicker
              installations={installations}
              installationsError={installationsError}
              repoUrl={repoUrl}
              onSelect={(repo) => {
                setRepoUrl(repo.htmlUrl);
                if (!name) setName(repo.name);
              }}
            />
          ) : (
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Paste a GitHub URL when the target org has no OAP App
              installation, or to import a repo the picker doesn't surface.
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="repoUrl"
            className={`block text-sm font-medium ${
              sourceMode === "installation"
                ? "text-gray-500 dark:text-gray-400"
                : "text-gray-700 dark:text-gray-300"
            }`}
          >
            GitHub Repo URL
            {sourceMode === "installation" && (
              <span className="ml-2 font-normal text-xs">
                (auto-filled from selection)
              </span>
            )}
          </label>
          <input
            type="text"
            name="repoUrl"
            id="repoUrl"
            required
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="https://github.com/acme/my-project"
            readOnly={sourceMode === "installation"}
            className={`mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm font-mono text-gray-900 dark:text-gray-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 ${
              sourceMode === "installation"
                ? "bg-gray-50 dark:bg-gray-900"
                : "bg-white dark:bg-gray-800"
            }`}
          />
          {sourceMode === "url" && (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              If the OAP App is installed on the repo's GitHub org, leave the
              PAT field below empty. Otherwise supply a PAT with repo access
              as an escape hatch.
            </p>
          )}
        </div>

        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Project Name (optional)
          </label>
          <input
            type="text"
            name="name"
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Defaults to the repo name"
            className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        <div>
          <label htmlFor="slug" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Slug (optional)
          </label>
          <input
            type="text"
            name="slug"
            id="slug"
            placeholder="Defaults to the repo name lowercased"
            className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm font-mono text-gray-900 dark:text-gray-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        <div>
          <label htmlFor="description" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Description
          </label>
          <textarea
            name="description"
            id="description"
            rows={2}
            className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        <div>
          <label
            htmlFor="githubPat"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            GitHub PAT (optional)
          </label>
          <input
            type="password"
            name="githubPat"
            id="githubPat"
            autoComplete="off"
            spellCheck={false}
            placeholder="ghp_… or github_pat_…"
            className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm font-mono text-gray-900 dark:text-gray-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Required only when the target GitHub org does not have the OAP
            App installed (e.g. importing a repo from a partner org). The
            token is validated against GitHub before any clone, then stored
            encrypted under this project for subsequent operations.
          </p>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            name="action"
            value="preview"
            disabled={isSubmitting}
            className="inline-flex items-center rounded-md border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            {isSubmitting ? "Inspecting…" : "Detect only"}
          </button>
          <button
            type="submit"
            name="action"
            value="import"
            disabled={isSubmitting}
            className="inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {isSubmitting ? "Importing…" : "Import project"}
          </button>
          <a
            href="/app"
            className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
          >
            Cancel
          </a>
        </div>
      </Form>
    </div>
  );
}

function ImportPreviewPanel({ data }: { data: ActionSuccess }) {
  return (
    <div className="rounded-md border border-gray-200 dark:border-gray-700 p-4 space-y-2">
      <div className="text-sm">
        <strong>Detection:</strong> <code>{data.detectionLevel}</code>
        {data.translatorVersion && (
          <span className="ml-3 text-xs text-gray-500 dark:text-gray-400">
            translator {data.translatorVersion}
          </span>
        )}
      </div>
      {data.translatedPreview && (
        <pre className="bg-gray-50 dark:bg-gray-800 rounded p-2 text-xs overflow-x-auto max-h-64">
          {JSON.stringify(data.translatedPreview, null, 2)}
        </pre>
      )}
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Press "Import project" to register the project and{" "}
        {data.detectionLevel === "legacy_produced" ? (
          <>
            open a PR adding{" "}
            <code className="text-[10px]">.factory/pipeline-state.json</code>{" "}
            to the source repo.
          </>
        ) : (
          <>register the ACP-native project without a translation PR.</>
        )}
      </p>
    </div>
  );
}

function ImportRegistered({ data }: { data: ActionSuccess }) {
  // Seed knowledge list from the import response, then let per-row
  // advance fetchers update individual rows in place.
  const initialObjects: ProjectKnowledgeObject[] = data.rawArtifacts.map(
    (a) => ({
      id: a.objectId,
      filename: a.filename,
      mimeType: "",
      sizeBytes: a.sizeBytes,
      contentHash: a.contentHash,
      state: "imported",
      storageKey: "",
      extractedStorageKey: null,
      provenance: { sourcePath: `.artifacts/raw/${a.relativePath}` },
      boundAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
  );
  const [objects, setObjects] = useState(initialObjects);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="rounded-md bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 px-4 py-3">
        <p className="text-sm text-green-800 dark:text-green-300">
          Project imported. Detection level: <code>{data.detectionLevel}</code>.
          {data.translatorVersion && (
            <>
              {" "}
              Translated via <code>{data.translatorVersion}</code>.
            </>
          )}
          {" "}
          Registered {data.rawArtifacts.length} raw artifact
          {data.rawArtifacts.length === 1 ? "" : "s"} as knowledge.
          {data.rawArtifactsSkipped > 0 && (
            <>
              {" "}
              ({data.rawArtifactsSkipped} skipped — see server logs.)
            </>
          )}
        </p>
      </div>
      <dl className="rounded-md border border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700">
        <div className="grid grid-cols-[10rem_1fr] px-4 py-3">
          <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Repo</dt>
          <dd className="text-sm text-indigo-600 dark:text-indigo-400">
            <a href={data.repoUrl} target="_blank" rel="noreferrer">
              {data.repoUrl}
            </a>
          </dd>
        </div>
        <div className="grid grid-cols-[10rem_1fr] px-4 py-3">
          <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Open in OPC</dt>
          <dd>
            {data.opcDeepLink ? (
              <a
                href={data.opcDeepLink}
                className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
              >
                Launch Factory Cockpit
              </a>
            ) : (
              <span className="text-sm text-gray-500 dark:text-gray-400">
                (preview only — no deep link)
              </span>
            )}
          </dd>
        </div>
        {data.detectionLevel === "legacy_produced" && (
          <div className="grid grid-cols-[10rem_1fr] px-4 py-3">
            <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">
              Translation PR
            </dt>
            <dd className="text-sm">
              {data.pullRequestUrl ? (
                <a
                  href={data.pullRequestUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-indigo-600 dark:text-indigo-400 underline"
                >
                  {data.pullRequestUrl}
                </a>
              ) : data.pullRequestError ? (
                <span className="text-amber-700 dark:text-amber-400">
                  PR opening failed:{" "}
                  <code className="text-xs">{data.pullRequestError}</code>
                  <br />
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    The project is registered. Re-import to retry, or open
                    the PR by hand: add{" "}
                    <code>.factory/pipeline-state.json</code> on a branch off{" "}
                    <code>main</code>.
                  </span>
                </span>
              ) : (
                <span className="text-gray-500 dark:text-gray-400">
                  (PR creation skipped)
                </span>
              )}
            </dd>
          </div>
        )}
      </dl>

      {data.projectId && objects.length > 0 && (
        <KnowledgeObjectsPanel
          projectId={data.projectId}
          objects={objects}
          setObjects={setObjects}
        />
      )}

      {data.projectId && (
        <a
          href={`/app/project/${data.projectId}`}
          className="text-sm text-indigo-600 dark:text-indigo-400"
        >
          Go to project dashboard →
        </a>
      )}
    </div>
  );
}

function KnowledgeObjectsPanel({
  projectId,
  objects,
  setObjects,
}: {
  projectId: string;
  objects: ProjectKnowledgeObject[];
  setObjects: (next: ProjectKnowledgeObject[]) => void;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          Raw artifacts
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Files discovered under <code>.artifacts/raw/</code>. Each file is
          registered as a knowledge object scoped to this project. The
          <code>requirements/</code> folder is tracked separately as factory
          pipeline output and does not appear here.
        </p>
      </div>
      <ul className="divide-y divide-gray-200 dark:divide-gray-700 rounded-md border border-gray-200 dark:border-gray-700">
        {objects.map((obj) => (
          <ArtifactRow
            key={obj.id}
            projectId={projectId}
            object={obj}
            onUpdate={(updated) =>
              setObjects(objects.map((o) => (o.id === updated.id ? updated : o)))
            }
          />
        ))}
      </ul>
    </section>
  );
}

function ArtifactRow({
  projectId,
  object,
  onUpdate,
}: {
  projectId: string;
  object: ProjectKnowledgeObject;
  onUpdate: (updated: ProjectKnowledgeObject) => void;
}) {
  const fetcher = useFetcher<ActionResult>();
  const advancing = fetcher.state !== "idle";
  const sourcePath =
    typeof object.provenance?.sourcePath === "string"
      ? object.provenance.sourcePath
      : null;

  useEffect(() => {
    if (fetcher.data && fetcher.data.kind === "advance") {
      onUpdate(fetcher.data.object);
    }
  }, [fetcher.data, onUpdate]);

  const rowError =
    fetcher.data && fetcher.data.kind === "error" ? fetcher.data.error : null;

  return (
    <li className="px-4 py-3 flex items-center gap-4">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-mono text-gray-900 dark:text-gray-100 truncate">
          {object.filename}
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {formatBytes(object.sizeBytes)} · {object.contentHash.slice(0, 12)}
          {sourcePath ? (
            <>
              {" "}· <code>{sourcePath}</code>
            </>
          ) : null}
        </div>
        {rowError && (
          <div className="mt-1 text-xs text-red-600 dark:text-red-400">
            {rowError}
          </div>
        )}
      </div>
      <StateBadge state={object.state} />
      <div className="shrink-0">
        {object.state === "imported" ? (
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="advance-extracted" />
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="objectId" value={object.id} />
            <button
              type="submit"
              disabled={advancing}
              className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {advancing ? "Extracting…" : "Advance to extracted"}
            </button>
          </fetcher.Form>
        ) : object.state === "extracting" ? (
          <span className="text-xs text-gray-500 dark:text-gray-400">…</span>
        ) : (
          <span className="text-xs text-gray-500 dark:text-gray-400">—</span>
        )}
      </div>
    </li>
  );
}

function StateBadge({ state }: { state: string }) {
  const classes: Record<string, string> = {
    imported:
      "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200",
    extracting:
      "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200",
    extracted:
      "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
    classified:
      "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200",
    available:
      "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${classes[state] ?? classes.imported}`}
    >
      {state}
    </span>
  );
}

function InstallationPicker({
  installations,
  installationsError,
  repoUrl,
  onSelect,
}: {
  installations: ImportInstallationEntry[];
  installationsError: string | null;
  repoUrl: string;
  onSelect: (repo: {
    fullName: string;
    name: string;
    htmlUrl: string;
  }) => void;
}) {
  const [filter, setFilter] = useState("");

  if (installationsError) {
    return (
      <div className="mt-3 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2">
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Couldn't list installations: <code>{installationsError}</code>. Use
          the "Paste URL" tab to import by URL instead.
        </p>
      </div>
    );
  }

  if (installations.length === 0) {
    return (
      <div className="mt-3 rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2">
        <p className="text-xs text-gray-600 dark:text-gray-400">
          No active OAP App installations registered for this org. Install the
          OAP GitHub App on a target org, or use "Paste URL" with a PAT.
        </p>
      </div>
    );
  }

  const needle = filter.trim().toLowerCase();
  const filtered = installations
    .map((inst) => ({
      ...inst,
      repos: needle
        ? inst.repos.filter((r) => r.fullName.toLowerCase().includes(needle))
        : inst.repos,
    }))
    .filter((inst) => inst.repos.length > 0 || inst.error);

  return (
    <div className="mt-3 space-y-3">
      <input
        type="search"
        placeholder="Filter repos…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
      />
      <div className="rounded-md border border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700 max-h-72 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-gray-500 dark:text-gray-400">
            No repos match "{filter}".
          </div>
        ) : (
          filtered.map((inst) => (
            <div key={inst.installationId}>
              <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800/50 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {inst.githubOrgLogin}
                <span className="ml-2 normal-case font-normal text-gray-400 dark:text-gray-500">
                  installation #{inst.installationId} ·{" "}
                  {inst.repos.length} repo
                  {inst.repos.length === 1 ? "" : "s"}
                </span>
              </div>
              {inst.error ? (
                <div className="px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                  Failed to list repos: <code>{inst.error}</code>
                </div>
              ) : (
                <ul>
                  {inst.repos.map((repo) => {
                    const selected = repoUrl === repo.htmlUrl;
                    return (
                      <li
                        key={repo.fullName}
                        className={`px-3 py-2 flex items-center gap-3 cursor-pointer ${
                          selected
                            ? "bg-indigo-50 dark:bg-indigo-900/30"
                            : "hover:bg-gray-50 dark:hover:bg-gray-800"
                        }`}
                        onClick={() =>
                          onSelect({
                            fullName: repo.fullName,
                            name: repo.name,
                            htmlUrl: repo.htmlUrl,
                          })
                        }
                      >
                        <input
                          type="radio"
                          name="repoPick"
                          checked={selected}
                          onChange={() =>
                            onSelect({
                              fullName: repo.fullName,
                              name: repo.name,
                              htmlUrl: repo.htmlUrl,
                            })
                          }
                          className="text-indigo-600 focus:ring-indigo-500"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-mono text-gray-900 dark:text-gray-100 truncate">
                            {repo.fullName}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            default <code>{repo.defaultBranch}</code>
                            {repo.isPrivate ? (
                              <span className="ml-2 inline-flex rounded bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                                private
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

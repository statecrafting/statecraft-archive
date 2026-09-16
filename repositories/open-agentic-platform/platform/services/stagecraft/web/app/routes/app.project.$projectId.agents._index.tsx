/**
 * Spec 123 §6.2 — Project agent binding manager.
 *
 * Lists the project's imported agent bindings. Each row shows:
 *   name @ vN (hash:abc1234), status indicator (active / retired_upstream),
 *   bound_at timestamp + actor, and Repin / Unbind actions.
 *
 * "Add binding" opens a modal with an org-agent picker filtered to agents not
 * yet bound to this project. Selecting one exposes a version dropdown defaulting
 * to the latest published version.
 *
 * All mutations go through form actions which proxy to the binding API endpoints:
 *   POST   /api/projects/:projectId/agents/bind
 *   PATCH  /api/projects/:projectId/agents/:bindingId  (repin)
 *   DELETE /api/projects/:projectId/agents/:bindingId  (unbind)
 *
 * Retired-upstream bindings are kept visible (spec 123 I-B3) with a distinct
 * badge; they are read-only (no Repin action).
 */

import {
  Link,
  useFetcher,
  useLoaderData,
  useParams,
} from "react-router";
import { useState } from "react";
import { requireUser } from "../lib/auth.server";
import {
  bindAgent,
  listOrgAgents,
  listProjectAgentBindings,
  repinBinding,
  unbindAgent,
  type OrgCatalogAgent,
  type ProjectAgentBinding,
} from "../lib/agents-api.server";

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({
  request,
  params,
}: {
  request: Request;
  params: { projectId: string };
}) {
  const user = await requireUser(request);
  const [{ bindings }, { agents: orgAgents }] = await Promise.all([
    listProjectAgentBindings(request, params.projectId),
    // Fetch all org agents so the picker can filter to unbound ones and
    // populate the version list. Fetches published + retired only (drafts
    // cannot be bound per spec 123 §5.2).
    listOrgAgents(request, user.orgId),
  ]);
  return { bindings, orgAgents, orgId: user.orgId };
}

// ---------------------------------------------------------------------------
// Action — handles bind / repin / unbind
// ---------------------------------------------------------------------------

export async function action({
  request,
  params,
}: {
  request: Request;
  params: { projectId: string };
}) {
  await requireUser(request);
  const form = await request.formData();
  const intent = form.get("intent") as string | null;

  try {
    if (intent === "bind") {
      const orgAgentId = form.get("org_agent_id") as string;
      const version = Number(form.get("version"));
      if (!orgAgentId || !version) return { error: "Missing org_agent_id or version." };
      const { binding } = await bindAgent(request, params.projectId, {
        org_agent_id: orgAgentId,
        version,
      });
      return { ok: true, binding };
    }

    if (intent === "repin") {
      const bindingId = form.get("binding_id") as string;
      const version = Number(form.get("version"));
      if (!bindingId || !version) return { error: "Missing binding_id or version." };
      const { binding } = await repinBinding(request, params.projectId, bindingId, { version });
      return { ok: true, binding };
    }

    if (intent === "unbind") {
      const bindingId = form.get("binding_id") as string;
      if (!bindingId) return { error: "Missing binding_id." };
      await unbindAgent(request, params.projectId, bindingId);
      return { ok: true };
    }

    return { error: `Unknown intent: ${String(intent)}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try {
      const parsed = JSON.parse(msg) as { message?: string };
      if (parsed.message) return { error: parsed.message };
    } catch {
      // fallthrough
    }
    return { error: msg || "Action failed." };
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ProjectAgentBindings() {
  const { bindings, orgAgents } = useLoaderData() as {
    bindings: ProjectAgentBinding[];
    orgAgents: OrgCatalogAgent[];
    orgId: string;
  };
  const { projectId } = useParams() as { projectId: string };
  const fetcher = useFetcher<{ error?: string; ok?: boolean }>();
  const [showAddModal, setShowAddModal] = useState(false);
  const [repinTargetId, setRepinTargetId] = useState<string | null>(null);

  // Derive names of already-bound agents so the picker can filter them out.
  const boundAgentNames = new Set(bindings.map((b) => b.agent_name));

  // Org agents available to bind: published, not already bound.
  const bindableAgents = orgAgents.filter(
    (a) => a.status === "published" && !boundAgentNames.has(a.name),
  );

  const repinBinding_row = repinTargetId
    ? bindings.find((b) => b.binding_id === repinTargetId)
    : null;

  // Versions of the target agent available for repin: published versions of
  // the same agent name, from the org catalog.
  const repinVersions = repinBinding_row
    ? orgAgents
        .filter(
          (a) =>
            a.name === repinBinding_row.agent_name && a.status === "published",
        )
        .sort((a, b) => b.version - a.version)
    : [];

  const actionError =
    fetcher.data && "error" in fetcher.data ? fetcher.data.error : null;
  const submitting = fetcher.state === "submitting";

  return (
    <div className="space-y-5">
      {/* Header row */}
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {bindings.length === 0
            ? "No agents bound to this project."
            : `${bindings.length} binding${bindings.length !== 1 ? "s" : ""}.`}
        </p>
        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Add binding
        </button>
      </div>

      {/* Error banner (action errors) */}
      {actionError && (
        <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3">
          <p className="text-sm text-red-700 dark:text-red-400">{actionError}</p>
        </div>
      )}

      {/* Bindings table */}
      {bindings.length > 0 && (
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <Th>Agent</Th>
                <Th>Status</Th>
                <Th>Bound</Th>
                <Th>Actor</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
              {bindings.map((b) => (
                <BindingRow
                  key={b.binding_id}
                  binding={b}
                  projectId={projectId}
                  fetcher={fetcher}
                  submitting={submitting}
                  onRepin={() => setRepinTargetId(b.binding_id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {bindings.length === 0 && (
        <div className="border border-dashed border-gray-300 dark:border-gray-600 rounded-lg px-4 py-12 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
            No imported agents.
          </p>
          <p className="text-sm text-gray-400 dark:text-gray-500">
            Use &ldquo;Add binding&rdquo; to import an org agent into this project.
          </p>
        </div>
      )}

      {/* Add binding modal */}
      {showAddModal && (
        <AddBindingModal
          bindableAgents={bindableAgents}
          orgAgents={orgAgents}
          fetcher={fetcher}
          submitting={submitting}
          onClose={() => setShowAddModal(false)}
        />
      )}

      {/* Repin modal */}
      {repinTargetId && repinBinding_row && (
        <RepinModal
          binding={repinBinding_row}
          availableVersions={repinVersions}
          fetcher={fetcher}
          submitting={submitting}
          onClose={() => setRepinTargetId(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// BindingRow
// ---------------------------------------------------------------------------

function BindingRow({
  binding,
  projectId: _projectId,
  fetcher,
  submitting,
  onRepin,
}: {
  binding: ProjectAgentBinding;
  projectId: string;
  fetcher: ReturnType<typeof useFetcher>;
  submitting: boolean;
  onRepin: () => void;
}) {
  const retired = binding.status === "retired_upstream";
  return (
    <tr className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
      {/* Agent name + version + hash */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium font-mono text-gray-900 dark:text-gray-100">
            {binding.agent_name}
          </span>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            @ v{binding.pinned_version}
          </span>
          <span className="text-xs font-mono text-gray-400 dark:text-gray-500">
            ({binding.pinned_content_hash.slice(0, 7)})
          </span>
        </div>
        <Link
          to={`/app/agents/${binding.org_agent_id}`}
          className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          View definition
        </Link>
      </td>

      {/* Status badge */}
      <td className="px-4 py-3">
        {retired ? (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
            retired upstream
          </span>
        ) : (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
            active
          </span>
        )}
      </td>

      {/* bound_at */}
      <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
        {new Date(binding.bound_at).toLocaleString()}
      </td>

      {/* actor */}
      <td className="px-4 py-3 text-xs font-mono text-gray-500 dark:text-gray-400 max-w-[8rem] truncate">
        {binding.bound_by.slice(0, 8)}…
      </td>

      {/* Actions */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          {!retired && (
            <button
              type="button"
              onClick={onRepin}
              disabled={submitting}
              className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50"
            >
              Repin
            </button>
          )}
          <fetcher.Form method="post" className="inline">
            <input type="hidden" name="intent" value="unbind" />
            <input type="hidden" name="binding_id" value={binding.binding_id} />
            <button
              type="submit"
              disabled={submitting}
              onClick={(e) => {
                if (
                  !confirm(
                    `Unbind ${binding.agent_name} from this project?`,
                  )
                )
                  e.preventDefault();
              }}
              className="text-xs text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
            >
              Unbind
            </button>
          </fetcher.Form>
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// AddBindingModal
// ---------------------------------------------------------------------------

function AddBindingModal({
  bindableAgents,
  orgAgents,
  fetcher,
  submitting,
  onClose,
}: {
  bindableAgents: OrgCatalogAgent[];
  orgAgents: OrgCatalogAgent[];
  fetcher: ReturnType<typeof useFetcher>;
  submitting: boolean;
  onClose: () => void;
}) {
  const [selectedName, setSelectedName] = useState<string>("");
  const [selectedVersion, setSelectedVersion] = useState<number | "">("");

  // When the user picks an agent name, collect the published versions for
  // that name sorted descending and default to the latest.
  const versionsForSelected = selectedName
    ? orgAgents
        .filter((a) => a.name === selectedName && a.status === "published")
        .sort((a, b) => b.version - a.version)
    : [];

  const selectedOrgAgentId = selectedName
    ? orgAgents.find(
        (a) =>
          a.name === selectedName &&
          a.version === (selectedVersion || versionsForSelected[0]?.version),
      )?.id
    : undefined;

  function handleNameChange(name: string) {
    setSelectedName(name);
    const versions = orgAgents
      .filter((a) => a.name === name && a.status === "published")
      .sort((a, b) => b.version - a.version);
    setSelectedVersion(versions[0]?.version ?? "");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-md w-full mx-4 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Add binding
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            ✕
          </button>
        </div>

        {bindableAgents.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            All published org agents are already bound to this project.
          </p>
        ) : (
          <fetcher.Form method="post" onSubmit={onClose} className="space-y-4">
            <input type="hidden" name="intent" value="bind" />
            {selectedOrgAgentId && (
              <input
                type="hidden"
                name="org_agent_id"
                value={selectedOrgAgentId}
              />
            )}

            <div>
              <label
                htmlFor="add-agent-name"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                Agent
              </label>
              <select
                id="add-agent-name"
                value={selectedName}
                onChange={(e) => handleNameChange(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                required
              >
                <option value="">Select an agent…</option>
                {/* Deduplicate by name — only show each agent name once */}
                {[...new Set(bindableAgents.map((a) => a.name))].map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>

            {selectedName && versionsForSelected.length > 0 && (
              <div>
                <label
                  htmlFor="add-agent-version"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  Version
                </label>
                <select
                  id="add-agent-version"
                  name="version"
                  value={selectedVersion}
                  onChange={(e) => setSelectedVersion(Number(e.target.value))}
                  className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  required
                >
                  {versionsForSelected.map((a) => (
                    <option key={a.version} value={a.version}>
                      v{a.version}
                      {a === versionsForSelected[0] ? " (latest)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex items-center gap-3 pt-1">
              <button
                type="submit"
                disabled={submitting || !selectedName || !selectedVersion}
                className="inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {submitting ? "Binding…" : "Bind"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
              >
                Cancel
              </button>
            </div>
          </fetcher.Form>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RepinModal
// ---------------------------------------------------------------------------

function RepinModal({
  binding,
  availableVersions,
  fetcher,
  submitting,
  onClose,
}: {
  binding: ProjectAgentBinding;
  availableVersions: OrgCatalogAgent[];
  fetcher: ReturnType<typeof useFetcher>;
  submitting: boolean;
  onClose: () => void;
}) {
  const [selectedVersion, setSelectedVersion] = useState<number>(
    availableVersions[0]?.version ?? binding.pinned_version,
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-md w-full mx-4 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Repin <span className="font-mono">{binding.agent_name}</span>
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            ✕
          </button>
        </div>

        <p className="text-sm text-gray-500 dark:text-gray-400">
          Currently pinned to v{binding.pinned_version}. Choose a new version:
        </p>

        {availableVersions.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No published versions available to repin to.
          </p>
        ) : (
          <fetcher.Form method="post" onSubmit={onClose} className="space-y-4">
            <input type="hidden" name="intent" value="repin" />
            <input type="hidden" name="binding_id" value={binding.binding_id} />

            <div>
              <label
                htmlFor="repin-version"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                Version
              </label>
              <select
                id="repin-version"
                name="version"
                value={selectedVersion}
                onChange={(e) => setSelectedVersion(Number(e.target.value))}
                className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                required
              >
                {availableVersions.map((a) => (
                  <option key={a.version} value={a.version}>
                    v{a.version}
                    {a === availableVersions[0] ? " (latest)" : ""}
                    {a.version === binding.pinned_version ? " (current)" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-3 pt-1">
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {submitting ? "Repinning…" : "Repin"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
              >
                Cancel
              </button>
            </div>
          </fetcher.Form>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Th helper
// ---------------------------------------------------------------------------

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
      {children}
    </th>
  );
}

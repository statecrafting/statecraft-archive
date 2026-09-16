// Spec 139 Phase 2 (T058) — three-pane merge editor for the
// `edit_and_accept` conflict resolution action.
//
// Phase 2 ships a textarea-based merge view: upstream (read-only),
// editable merge target, current user override (read-only). The server
// accepts the merge target as `body` on POST /api/factory/artifacts/:id/
// resolve with `action='edit_and_accept'` and applies it as the new
// `user_body`.
//
// CodeMirror 6 `@codemirror/merge` (MIT) is the planned upgrade — when
// it lands, the central pane swaps from <textarea> to a CodeMirror
// MergeView while preserving this component's wire surface. The
// per-row endpoint shape is finalised; only the editor render changes.

import { useState } from "react";
import { Form } from "react-router";
import type { ArtifactConflictSummary } from "../lib/factory-api.server";

export type ArtifactMergeEditorProps = {
  conflict: ArtifactConflictSummary;
  /** Disables the submit button while the action is mid-flight. */
  submitting: boolean;
};

export function ArtifactMergeEditor({
  conflict,
  submitting,
}: ArtifactMergeEditorProps) {
  // Seed the merge target with the user's existing override; if there is
  // none (rare for a diverged row), seed with upstream.
  const [merged, setMerged] = useState<string>(
    conflict.userBody ?? conflict.upstreamBody ?? "",
  );

  return (
    <details className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
      <summary className="cursor-pointer font-semibold text-amber-900">
        Edit and accept (3-way merge)
      </summary>
      <Form method="post" className="mt-3 flex flex-col gap-3">
        <input type="hidden" name="id" value={conflict.id} />
        <input type="hidden" name="intent" value="resolve_edit_and_accept" />

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase text-amber-900">
              Upstream (current)
            </label>
            <textarea
              readOnly
              value={conflict.upstreamBody ?? ""}
              className="h-72 w-full rounded border border-amber-200 bg-white p-2 font-mono text-xs"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase text-amber-900">
              Merged result <span className="font-normal">(editable)</span>
            </label>
            <textarea
              name="body"
              value={merged}
              onChange={(event) => setMerged(event.target.value)}
              className="h-72 w-full rounded border border-amber-400 bg-white p-2 font-mono text-xs"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase text-amber-900">
              Your override (current)
            </label>
            <textarea
              readOnly
              value={conflict.userBody ?? ""}
              className="h-72 w-full rounded border border-amber-200 bg-white p-2 font-mono text-xs"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="submit"
            disabled={submitting || merged.length === 0}
            className="rounded bg-amber-700 px-3 py-1 text-white disabled:opacity-50"
          >
            Accept merged body
          </button>
        </div>

        <p className="text-xs text-amber-800">
          Saving applies the merged body as the new <code>user_body</code>{" "}
          and clears <code>conflict_state</code>. Future syncs that don't
          touch this path will leave the merged result intact.
        </p>
      </Form>
    </details>
  );
}

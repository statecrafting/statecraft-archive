// Spec 164 FR-002 / SC-004 — permanent redirect for the legacy
// `/app/project/<uuid>/pipelines` URL. The route was renamed to
// `development` (spec 164 §2.1); this file preserves bookmarks for one
// release cycle.

import { redirect } from "react-router";

export async function loader({
  params,
}: {
  params: { projectId: string };
}) {
  // 308 Permanent Redirect — preserves method and signals to clients
  // that the resource has moved permanently. The Requirements pair
  // (spec 163) and Development board are the two project-lifecycle
  // surfaces post-rename.
  return redirect(`/app/project/${params.projectId}/development`, 308);
}

export default function PipelinesRedirect() {
  // Loader always redirects; this body is unreachable but kept so the
  // route module conforms to React Router's component contract.
  return null;
}

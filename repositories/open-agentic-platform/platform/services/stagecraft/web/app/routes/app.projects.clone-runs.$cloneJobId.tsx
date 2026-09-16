// Spec 114 §5.4 — resource route: GET proxy for clone run status.
//
// The dialog polls this every ~1.5s after submitting a clone, until the
// upstream run reaches `ok` or `failed`. Mirrors the cookie-injection
// pattern of `app.projects.clone-availability.tsx`.

import { requireUser } from "../lib/auth.server";
import {
  getCloneRunStatus,
  type CloneRunStatus,
} from "../lib/projects-api.server";

export async function loader({
  request,
  params,
}: {
  request: Request;
  params: { cloneJobId: string };
}) {
  await requireUser(request);
  try {
    const result: CloneRunStatus = await getCloneRunStatus(
      request,
      params.cloneJobId
    );
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}

// Spec 113 — resource route: GET proxy for the clone availability check.
//
// The Clone Project dialog runs in the browser and can't call Encore
// directly because the user's session cookie does not forward over a
// cross-origin fetch from the SPA bundle. This loader runs in the SSR
// layer (Node), forwards the cookie via `apiFetch`, and surfaces Encore's
// typed `CheckAvailabilityResponse` to the browser as JSON.

import { requireUser } from "../lib/auth.server";
import {
  checkCloneAvailability,
  type CloneAvailabilityResponse,
} from "../lib/projects-api.server";

export async function loader({ request }: { request: Request }) {
  await requireUser(request);
  const url = new URL(request.url);
  const repoName = url.searchParams.get("repoName") ?? undefined;
  const slug = url.searchParams.get("slug") ?? undefined;
  if (!repoName && !slug) {
    return Response.json(
      { error: "at least one of repoName or slug must be provided" },
      { status: 400 }
    );
  }
  try {
    const result: CloneAvailabilityResponse = await checkCloneAvailability(
      request,
      { repoName, slug }
    );
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}

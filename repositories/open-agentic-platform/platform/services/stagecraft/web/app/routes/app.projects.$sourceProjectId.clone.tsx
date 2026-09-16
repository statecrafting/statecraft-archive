// Spec 114 §5.4 — resource route: POST proxy for the clone submit.
//
// Browser-side fetch from the dialog hits this action, which forwards
// the request to Encore via the SSR helper that injects the session
// cookie. Returns the typed `CloneJobAccepted` (or an error JSON). The
// dialog polls `app.projects.clone-runs.$cloneJobId` for the terminal
// verdict.

import { requireUser } from "../lib/auth.server";
import {
  cloneProject,
  type CloneJobAccepted,
} from "../lib/projects-api.server";

interface CloneSubmitBody {
  name?: string;
  slug?: string;
  repoName?: string;
}

export async function action({
  request,
  params,
}: {
  request: Request;
  params: { sourceProjectId: string };
}) {
  await requireUser(request);
  if (request.method !== "POST") {
    return Response.json(
      { error: "method not allowed" },
      { status: 405, headers: { Allow: "POST" } }
    );
  }
  let body: CloneSubmitBody;
  try {
    body = (await request.json()) as CloneSubmitBody;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  try {
    const result: CloneJobAccepted = await cloneProject(
      request,
      params.sourceProjectId,
      {
        name: body.name,
        slug: body.slug,
        repoName: body.repoName,
      }
    );
    return Response.json(result, { status: 202 });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}

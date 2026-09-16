// Spec 112 §5.3 operation 4 — GitHub repo creation + team admin grant.
//
// Thin wrapper over the existing `api/github/repoInit.ts` helpers. This
// exists to localise the spec-112 surface so the Create orchestrator in
// `create.ts` does not import GitHub primitives directly — the scaffold
// subflow is the only caller.

import {
  createGitHubRepo,
  configureBranchProtection,
  type CreateRepoResult,
} from "../../github/repoInit";

export interface GithubRepoCreateOptions {
  token: string;
  githubOrg: string;
  repoName: string;
  isPrivate: boolean;
  description?: string;
}

export async function createRepoWithBranchProtection(
  opts: GithubRepoCreateOptions
): Promise<CreateRepoResult> {
  const result = await createGitHubRepo(opts.token, opts.githubOrg, opts.repoName, {
    isPrivate: opts.isPrivate,
    description: opts.description ?? "",
    // Spec 112 §5.2 step 6 — commit #1 is our scaffold tree; an auto-init
    // README would force the push to overwrite it.
    autoInit: false,
  });
  // Branch protection is best-effort (handles 403 internally per its contract).
  await configureBranchProtection(opts.token, result.fullName, result.defaultBranch);
  return result;
}

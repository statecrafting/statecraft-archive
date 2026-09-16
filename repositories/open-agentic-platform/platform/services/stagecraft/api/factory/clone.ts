import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import log from "encore.dev/log";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Shallow clone helper for spec 108 Phase 3.
//
// Clones a GitHub repo (public or private) shallowly into a fresh tmpdir and
// returns the local path plus HEAD sha. `withClonedRepo` wraps that in a
// try/finally so the caller never has to remember cleanup.
//
// Private repos use a brokered GitHub App installation token; public repos
// work with an anonymous clone. Callers pass the token in when they know it
// may be needed (e.g. the sync worker resolves a token from the org's
// github_installations row before calling). If the first clone fails with
// what looks like an auth error and no token was supplied, we don't silently
// fall back — the caller is expected to retry with a token.
// ---------------------------------------------------------------------------

export type CloneOptions = {
  repo: string; // "owner/name"
  ref: string; // branch/tag
  token?: string; // GitHub installation token or PAT
};

export type ClonedRepo = {
  path: string;
  sha: string;
  cleanup: () => Promise<void>;
};

function buildCloneUrl(repo: string, token?: string): string {
  if (token) {
    return `https://x-access-token:${token}@github.com/${repo}.git`;
  }
  return `https://github.com/${repo}.git`;
}

export async function cloneShallow(opts: CloneOptions): Promise<ClonedRepo> {
  const repoSlug = opts.repo.replace("/", "-");
  const dir = await mkdtemp(join(tmpdir(), `oap-factory-sync-${repoSlug}-`));
  const cleanup = async () => {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch (err) {
      log.warn("factory sync: cleanup failed", { dir, err: String(err) });
    }
  };

  try {
    const cloneUrl = buildCloneUrl(opts.repo, opts.token);
    await execFileAsync(
      "git",
      [
        "clone",
        "--depth=1",
        "--single-branch",
        "--branch",
        opts.ref,
        cloneUrl,
        dir,
      ],
      { timeout: 120_000 }
    );

    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: dir,
      timeout: 10_000,
    });
    const sha = stdout.trim();
    if (!/^[0-9a-f]{40}$/.test(sha)) {
      throw new Error(`unexpected HEAD sha from git rev-parse: ${sha}`);
    }

    return { path: dir, sha, cleanup };
  } catch (err) {
    await cleanup();
    // Scrub the token from error messages before re-throwing.
    const msg = err instanceof Error ? err.message : String(err);
    const scrubbed = opts.token ? msg.split(opts.token).join("***") : msg;
    throw new Error(`clone failed for ${opts.repo}@${opts.ref}: ${scrubbed}`);
  }
}

export async function withClonedRepo<T>(
  opts: CloneOptions,
  fn: (repo: ClonedRepo) => Promise<T>
): Promise<T> {
  const cloned = await cloneShallow(opts);
  try {
    return await fn(cloned);
  } finally {
    await cloned.cleanup();
  }
}

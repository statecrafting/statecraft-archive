/**
 * Git operations for the stamp pipeline (spec 005 §3), via node:child_process.
 *
 * The template is a public repo, kept as a warm bare-clone cache and exported
 * at a pinned SHA with `git archive` semantics (tracked files only, no .git).
 * The stamped tree is pushed as a fresh initial commit over https using the
 * tenant's installation token embedded in the remote URL (never logged).
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import {
  FACTORY_GIT_AUTHOR_EMAIL,
  FACTORY_GIT_AUTHOR_NAME,
} from "./config";

const exec = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;

async function git(args: string[], cwd?: string): Promise<string> {
  const res = await exec("git", args, { cwd, encoding: "utf8", maxBuffer: MAX_BUFFER });
  return res.stdout;
}

/** Bare-clone the template on first use, else fetch to stay current. */
export async function ensureTemplateCache(cacheDir: string, repoUrl: string): Promise<void> {
  if (existsSync(join(cacheDir, "HEAD"))) {
    await git(["-C", cacheDir, "fetch", "origin", "+refs/heads/*:refs/heads/*", "--quiet"]);
    return;
  }
  await mkdir(dirname(cacheDir), { recursive: true });
  await git(["clone", "--bare", "--quiet", repoUrl, cacheDir]);
}

/** Resolve a ref (SHA, short SHA, or branch) to a full 40-char commit SHA. */
export async function resolveRef(cacheDir: string, ref: string): Promise<string> {
  return (await git(["-C", cacheDir, "rev-parse", ref])).trim();
}

/** Export a pinned SHA's tracked tree into destDir (no .git), via git archive. */
export async function exportPinned(cacheDir: string, sha: string, destDir: string): Promise<void> {
  await mkdir(destDir, { recursive: true });
  const tarPath = join(tmpdir(), `factory-archive-${randomUUID()}.tar`);
  try {
    await git(["-C", cacheDir, "archive", "--format=tar", "--output", tarPath, sha]);
    await exec("tar", ["-xf", tarPath, "-C", destDir], { encoding: "utf8", maxBuffer: MAX_BUFFER });
  } finally {
    await rm(tarPath, { force: true }).catch(() => {});
  }
}

export interface PushInput {
  workdir: string;
  org: string;
  repo: string;
  token: string;
  message: string;
}

/** Init, commit the whole tree as "statecraft Factory", and push to main. Returns the pushed SHA. */
export async function pushInitialCommit(input: PushInput): Promise<string> {
  const { workdir, org, repo, token, message } = input;
  await git(["-C", workdir, "init", "-b", "main", "--quiet"]);
  await git(["-C", workdir, "add", "-A"]);
  await git([
    "-C",
    workdir,
    "-c",
    `user.name=${FACTORY_GIT_AUTHOR_NAME}`,
    "-c",
    `user.email=${FACTORY_GIT_AUTHOR_EMAIL}`,
    "commit",
    "--quiet",
    "-m",
    message,
  ]);
  const head = (await git(["-C", workdir, "rev-parse", "HEAD"])).trim();
  const remote = `https://x-access-token:${token}@github.com/${org}/${repo}.git`;
  await git(["-C", workdir, "remote", "add", "origin", remote]);
  await git(["-C", workdir, "push", "--quiet", "origin", "main"]);
  return head;
}

export interface CloneInput {
  org: string;
  repo: string;
  token: string;
  destDir: string;
}

/**
 * Shallow-clone an existing repo's default branch (adopt mode, spec 005 §3),
 * using the tenant's installation token in the remote URL. Returns the default
 * branch name so the pipeline can PR back into it.
 */
export async function cloneExisting(input: CloneInput): Promise<{ defaultBranch: string }> {
  const { org, repo, token, destDir } = input;
  const remote = `https://x-access-token:${token}@github.com/${org}/${repo}.git`;
  await git(["clone", "--quiet", "--depth", "1", remote, destDir]);
  const branch = (await git(["-C", destDir, "rev-parse", "--abbrev-ref", "HEAD"])).trim();
  return { defaultBranch: branch };
}

export interface OverlayInput {
  /** A checkout of the existing repo (from cloneExisting). */
  repoDir: string;
  /** The stamped chassis tree to overlay on top. */
  overlayDir: string;
  branch: string;
  message: string;
  org: string;
  repo: string;
  token: string;
}

/**
 * Overlay the stamped chassis onto the cloned repo on a fresh branch, commit,
 * and push (adopt mode, spec 005 §3). The overlay merges the stamped tree's
 * files over the repo's: chassis files land, same-path files are overwritten,
 * and files unique to the repo (e.g. an app's own crate/CI) are preserved. The
 * stamped tree carries no `.git`, so the repo's history is untouched. Returns the
 * pushed head SHA (the born-green verify then runs on it).
 */
export async function overlayCommitPushBranch(input: OverlayInput): Promise<string> {
  const { repoDir, overlayDir, branch, message, org, repo, token } = input;
  await git(["-C", repoDir, "checkout", "-b", branch, "--quiet"]);
  await cp(overlayDir, repoDir, { recursive: true, force: true });
  await git(["-C", repoDir, "add", "-A"]);
  await git([
    "-C",
    repoDir,
    "-c",
    `user.name=${FACTORY_GIT_AUTHOR_NAME}`,
    "-c",
    `user.email=${FACTORY_GIT_AUTHOR_EMAIL}`,
    "commit",
    "--quiet",
    "-m",
    message,
  ]);
  const head = (await git(["-C", repoDir, "rev-parse", "HEAD"])).trim();
  const remote = `https://x-access-token:${token}@github.com/${org}/${repo}.git`;
  await git(["-C", repoDir, "remote", "set-url", "origin", remote]);
  await git(["-C", repoDir, "push", "--quiet", "origin", branch]);
  return head;
}

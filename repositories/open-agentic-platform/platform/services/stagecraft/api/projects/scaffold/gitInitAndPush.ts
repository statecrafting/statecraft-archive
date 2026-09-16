// Spec 112 §5.3 op 5 — initial git commit + authed push to main.
//
// Takes a populated project tree on disk (the scaffold run's output, with
// `.factory/pipeline-state.json` already seeded by perRequestScaffold) and
// pushes it as the repo's first commit. The repo is created with
// `auto_init: false` (see scaffold/githubRepoCreate.ts) so a plain
// (non-force) push lands the scaffold as commit #1.

import { spawn } from "node:child_process";
import log from "encore.dev/log";

export interface GitInitAndPushOptions {
  projectRoot: string;
  /** GitHub `<owner>/<repo>` — combined with token to form the push URL. */
  githubOrg: string;
  repoName: string;
  /** Brokered installation token (TTL ~1h). Threaded into the URL only. */
  token: string;
  /** Default branch to push to. */
  branch: string;
  commitMessage: string;
  authorName: string;
  authorEmail: string;
  coAuthor?: { name: string; email: string };
  /** Optional progress sink. */
  log?: (line: string) => void;
}

export interface GitInitAndPushResult {
  commitSha: string;
  branch: string;
  /** Sanitised push URL (token redacted) for logs / audit metadata. */
  remoteUrl: string;
}

export async function gitInitAndPush(
  opts: GitInitAndPushOptions
): Promise<GitInitAndPushResult> {
  const sink = opts.log ?? (() => {});
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: opts.authorName,
    GIT_AUTHOR_EMAIL: opts.authorEmail,
    GIT_COMMITTER_NAME: opts.authorName,
    GIT_COMMITTER_EMAIL: opts.authorEmail,
    // Bypass "dubious ownership" check — destDir was created by statecraft
    // running under a different uid than the one git would expect.
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "safe.directory",
    GIT_CONFIG_VALUE_0: "*",
  };
  const commitBody = opts.coAuthor
    ? `${opts.commitMessage}\n\nCo-authored-by: ${opts.coAuthor.name} <${opts.coAuthor.email}>`
    : opts.commitMessage;

  const authedUrl = `https://x-access-token:${opts.token}@github.com/${opts.githubOrg}/${opts.repoName}.git`;
  const safeUrl = `https://github.com/${opts.githubOrg}/${opts.repoName}.git`;

  sink("git init");
  await run(
    "git",
    ["init", "-b", opts.branch],
    opts.projectRoot,
    env,
    opts.token
  );

  sink("git add -A");
  await run("git", ["add", "-A"], opts.projectRoot, env, opts.token);

  sink("git commit");
  await run(
    "git",
    ["commit", "-m", commitBody],
    opts.projectRoot,
    env,
    opts.token
  );

  sink("git remote add origin");
  await run(
    "git",
    ["remote", "add", "origin", authedUrl],
    opts.projectRoot,
    env,
    opts.token
  );

  sink(`git push origin ${opts.branch}`);
  await run(
    "git",
    ["push", "-u", "origin", `HEAD:${opts.branch}`],
    opts.projectRoot,
    env,
    opts.token
  );

  // Reset the remote URL to the bare form so the token does not survive in
  // any operator-side `git remote -v` if the working dir is ever inspected.
  await run(
    "git",
    ["remote", "set-url", "origin", safeUrl],
    opts.projectRoot,
    env,
    opts.token
  ).catch((err) => {
    log.warn("git remote set-url after push failed (non-fatal)", {
      error: err instanceof Error ? err.message : String(err),
    });
  });

  const sha = await capture(
    "git",
    ["rev-parse", "HEAD"],
    opts.projectRoot,
    env,
    opts.token
  );

  return {
    commitSha: sha.trim(),
    branch: opts.branch,
    remoteUrl: safeUrl,
  };
}

function run(
  bin: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  redactToken: string
): Promise<void> {
  return new Promise((resolveRun, rejectRun) => {
    const proc = spawn(bin, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const tail: Buffer[] = [];
    proc.stderr.on("data", (d: Buffer) => tail.push(d));
    proc.stdout.on("data", (d: Buffer) => tail.push(d));
    proc.on("close", (code) => {
      if (code === 0) {
        resolveRun();
      } else {
        const detail = Buffer.concat(tail)
          .toString("utf8")
          .replaceAll(redactToken, "***")
          .slice(-2000);
        rejectRun(
          new Error(`${bin} ${args.join(" ")} exited ${code}: ${detail}`)
        );
      }
    });
    proc.on("error", rejectRun);
  });
}

function capture(
  bin: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  redactToken: string
): Promise<string> {
  return new Promise((resolveRun, rejectRun) => {
    const proc = spawn(bin, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    proc.stdout.on("data", (d: Buffer) => out.push(d));
    proc.on("close", (code) => {
      if (code === 0) {
        resolveRun(Buffer.concat(out).toString("utf8"));
      } else {
        rejectRun(
          new Error(
            `${bin} ${args.join(" ")} exited ${code} (${redactToken ? "redacted" : "raw"})`
          )
        );
      }
    });
    proc.on("error", rejectRun);
  });
}

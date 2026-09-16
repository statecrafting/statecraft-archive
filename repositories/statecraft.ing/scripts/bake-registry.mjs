// Bake the governed spec registries of the Statecraft product family into a
// single static payload the site prerenders and serves.
//
// Spec 001 §3 ("Registry viewer, static edition"): raw.githubusercontent
// cannot list a directory, so we use the GitHub REST API at build time to
// (a) enumerate each repo's `.derived/spec-registry/by-spec` shards and
// (b) read the commit SHA + date of the last change to that path (the
// "as of" stamp), then fetch each shard body from raw.githubusercontent.
// Both hosts are contacted at BUILD TIME ONLY; the emitted site makes no
// runtime request to either. The build fails loudly on any fetch or parse
// error: no silent partial bakes.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ORG = "statecrafting";
const REPOS = ["enrahitu", "statecraft", "statecraft-cli", "statecraft.ing"];
const SHARD_DIR = ".derived/spec-registry/by-spec";
const OUT_PATH = path.join(process.cwd(), "public", "data", "registry.json");

const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";

function apiHeaders() {
  const h = {
    Accept: "application/vnd.github+json",
    "User-Agent": "statecrafting-bake-registry",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (TOKEN) h.Authorization = `Bearer ${TOKEN}`;
  return h;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fetch with a few retries for transient failures (network, 5xx, secondary
// rate limits). A hard 4xx (missing repo/path, bad auth) fails immediately.
async function fetchOrThrow(url, { headers = {}, kind = "resource" } = {}) {
  const maxAttempts = 3;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, { headers });
      if (res.ok) return res;
      const retryable = res.status === 429 || res.status >= 500;
      const body = await res.text().catch(() => "");
      const msg = `${kind} fetch failed: ${res.status} ${res.statusText} for ${url}${
        body ? `\n${body.slice(0, 300)}` : ""
      }`;
      if (!retryable || attempt === maxAttempts) throw new Error(msg);
      lastErr = new Error(msg);
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts) throw lastErr;
    }
    await sleep(attempt * 750);
  }
  throw lastErr;
}

async function fetchJson(url, opts) {
  const res = await fetchOrThrow(url, opts);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`invalid JSON from ${url}: ${err.message}`);
  }
}

async function bakeRepo(repo) {
  const base = `https://api.github.com/repos/${ORG}/${repo}`;

  // (a) enumerate the shard files in the by-spec directory.
  const listing = await fetchJson(
    `${base}/contents/${SHARD_DIR}?ref=main`,
    { headers: apiHeaders(), kind: `${repo} contents` }
  );
  if (!Array.isArray(listing)) {
    throw new Error(`${repo}: ${SHARD_DIR} is not a directory`);
  }
  const shardFiles = listing
    .filter((e) => e.type === "file" && e.name.endsWith(".json"))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (shardFiles.length === 0) {
    throw new Error(`${repo}: no shard files under ${SHARD_DIR}`);
  }

  // (b) "as of": the last commit that touched the by-spec path.
  let sha = "";
  let asOf = "";
  const commits = await fetchJson(
    `${base}/commits?path=${encodeURIComponent(SHARD_DIR)}&sha=main&per_page=1`,
    { headers: apiHeaders(), kind: `${repo} commits` }
  );
  if (Array.isArray(commits) && commits.length > 0) {
    sha = commits[0].sha;
    asOf = commits[0].commit?.committer?.date || commits[0].commit?.author?.date || "";
  } else {
    // Fall back to the branch HEAD if the path-scoped query is empty.
    const branch = await fetchJson(`${base}/branches/main`, {
      headers: apiHeaders(),
      kind: `${repo} branch`,
    });
    sha = branch.commit?.sha || "";
    asOf = branch.commit?.commit?.committer?.date || "";
  }
  if (!sha) throw new Error(`${repo}: could not resolve commit SHA`);

  // (c) fetch each shard body from raw.githubusercontent (does not count
  // against the REST rate limit). Pin the raw fetch to the resolved SHA so the
  // bodies match the "as of" stamp exactly.
  const specs = [];
  for (const file of shardFiles) {
    const rawUrl = `https://raw.githubusercontent.com/${ORG}/${repo}/${sha}/${SHARD_DIR}/${file.name}`;
    const shard = await fetchJson(rawUrl, { kind: `${repo}/${file.name}` });
    const record = shard?.record;
    if (!record || typeof record.id !== "string") {
      throw new Error(`${repo}/${file.name}: shard has no record.id`);
    }
    specs.push({ ...record, shardHash: shard.shardHash });
  }
  specs.sort((a, b) => String(a.id).localeCompare(String(b.id)));

  return {
    repo,
    sha,
    shortSha: sha.slice(0, 12),
    asOf,
    specCount: specs.length,
    specs,
  };
}

async function main() {
  process.stdout.write(
    `bake-registry: fetching shards for ${REPOS.length} repos${
      TOKEN ? " (authenticated)" : " (unauthenticated)"
    }\n`
  );

  const repos = [];
  for (const repo of REPOS) {
    const baked = await bakeRepo(repo);
    process.stdout.write(
      `  ${repo}: ${baked.specCount} specs @ ${baked.shortSha} (${baked.asOf})\n`
    );
    repos.push(baked);
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    org: ORG,
    repos,
    totalSpecs: repos.reduce((n, r) => n + r.specCount, 0),
  };

  await mkdir(path.dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(payload, null, 2) + "\n", "utf8");
  process.stdout.write(
    `bake-registry: wrote ${payload.totalSpecs} specs -> ${path.relative(process.cwd(), OUT_PATH)}\n`
  );
}

main().catch((err) => {
  process.stderr.write(`\nbake-registry FAILED: ${err.message}\n`);
  process.exit(1);
});

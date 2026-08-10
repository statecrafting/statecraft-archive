/**
 * The air-gap bundle and its verifier (spec 029 §3.3, acceptance 4).
 *
 * `verify.sh` is the last thing standing between an air-gapped operator and an
 * image nobody can vouch for, and it runs on a host where no other gate in this
 * corpus is present: no CI, no spec-spine, no network to ask anyone. So its
 * failure modes are the behavior under test, not its happy path.
 *
 * The bundle is produced by the real `scripts/airgap-bundle.sh` against a small
 * supplied archive (`--from-archive`). The checksum manifest and the verifier
 * do not depend on what is inside that archive, so this exercises the shipped
 * code rather than a copy of it, without a 795 MB pull.
 *
 * Each assertion is paired with its mutation: a test that only checks the clean
 * bundle passes against a verifier that reports success unconditionally.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "airgap-bundle.sh");
const VERSION = "0.0.0-test";
const BUNDLE_NAME = `enrahitu-${VERSION}-linux-arm64`;

let workspace: string;
/** The pristine bundle every case copies before mutating it. */
let pristine: string;

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), "airgap-"));
  const archive = join(workspace, "image.tar");
  writeFileSync(archive, Buffer.alloc(4096, 7));

  const out = join(workspace, "out");
  const built = spawnSync(
    SCRIPT,
    ["arm64", "--version", VERSION, "--from-archive", archive, "--skip-signatures", "--out", out],
    { encoding: "utf8" },
  );
  if (built.status !== 0) {
    throw new Error(`airgap-bundle.sh failed: ${built.stdout}\n${built.stderr}`);
  }
  pristine = join(out, BUNDLE_NAME);
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

/** A fresh copy of the built bundle, mutated by `mutate`, then verified. */
function verify(name: string, mutate: (dir: string) => void = () => {}, args: string[] = []) {
  const dir = join(workspace, name);
  rmSync(dir, { recursive: true, force: true });
  cpSync(pristine, dir, { recursive: true });
  mutate(dir);
  const run = spawnSync("./verify.sh", args, { cwd: dir, encoding: "utf8" });
  return { ...run, output: `${run.stdout}${run.stderr}`, dir };
}

describe("the bundle", () => {
  it("carries the image, the manual, the metadata and its own verifier", () => {
    for (const member of ["docs/OPERATIONS.md", "bundle.json", "checksums.txt", "verify.sh", `${BUNDLE_NAME}.tar`]) {
      expect(existsSync(join(pristine, member)), `${member} is missing from the bundle`).toBe(true);
    }
  });

  it("records the rauthy digest the Dockerfile pins, not a tag", () => {
    const meta = JSON.parse(readFileSync(join(pristine, "bundle.json"), "utf8"));
    const dockerfile = readFileSync(join(HERE, "..", "docker", "Dockerfile"), "utf8");
    const pinned = /^FROM ghcr\.io\/sebadob\/rauthy@(sha256:[a-f0-9]{64})/m.exec(dockerfile);

    expect(pinned, "docker/Dockerfile no longer pins rauthy by digest (spec 029 §3.4)").not.toBeNull();
    expect(meta.rauthyDigest).toBe(pinned![1]);
  });

  it("checksums every member except the manifest itself", () => {
    const manifest = readFileSync(join(pristine, "checksums.txt"), "utf8");
    expect(manifest).toContain(`./${BUNDLE_NAME}.tar`);
    expect(manifest).toContain("./verify.sh");
    expect(manifest).toContain("./docs/OPERATIONS.md");
    expect(manifest).not.toContain("./checksums.txt");
  });
});

describe("verify.sh integrity", () => {
  it("passes a bundle nobody has touched", () => {
    const run = verify("clean", () => {}, ["--allow-unsigned"]);
    expect(run.status).toBe(0);
    expect(run.output).toContain("every member is present and matches");
  });

  it("fails an altered member and names it", () => {
    const run = verify("altered", (dir) => appendFileSync(join(dir, "docs/OPERATIONS.md"), "x"));
    expect(run.status).toBe(1);
    expect(run.output).toContain("does not match its checksum");
    expect(run.output).toContain("docs/OPERATIONS.md");
    // The mutation must be what fails it: a verifier that ignored checksums
    // entirely would still exit 2 here on the unsigned path, so assert 1.
    expect(run.output).not.toContain("OK: every member");
  });

  /**
   * The regression this file exists for. Darwin's sha256sum reports an absent
   * file only on stderr and prints no FAILED line on stdout, so a verifier that
   * reads stdout and ignores the exit code passes a bundle with a member
   * deleted. Removing the SBOM or the verifier is precisely the tamper an
   * air-gapped operator cannot detect any other way.
   */
  it("fails a member that was deleted outright and names it", () => {
    const run = verify("deleted", (dir) => rmSync(join(dir, "docs/ARCHITECTURE.md")));
    expect(run.status).toBe(1);
    expect(run.output).toContain("missing entirely");
    expect(run.output).toContain("docs/ARCHITECTURE.md");
    expect(run.output).not.toContain("OK: every member");
  });

  it("reports missing and altered members separately in one run", () => {
    const run = verify("both", (dir) => {
      rmSync(join(dir, "bundle.json"));
      appendFileSync(join(dir, "docs/OPERATIONS.md"), "x");
    });
    expect(run.status).toBe(1);
    expect(run.output).toContain("missing entirely");
    expect(run.output).toContain("bundle.json");
    expect(run.output).toContain("does not match its checksum");
    expect(run.output).toContain("docs/OPERATIONS.md");
  });

  it("refuses a bundle whose manifest is gone rather than finding nothing to check", () => {
    const run = verify("no-manifest", (dir) => rmSync(join(dir, "checksums.txt")));
    expect(run.status).toBe(1);
    expect(run.output).toContain("checksums.txt is missing");
  });

  it("never lets --allow-unsigned excuse a tampered member", () => {
    const run = verify("tampered-allowed", (dir) => appendFileSync(join(dir, "docs/OPERATIONS.md"), "x"), [
      "--allow-unsigned",
    ]);
    expect(run.status).toBe(1);
  });
});

describe("verify.sh authenticity", () => {
  it("does not exit zero silently when the bundle carries no signature", () => {
    const run = verify("unsigned");
    expect(run.status).toBe(2);
    expect(run.output).toContain("NOT CHECKED");
    expect(run.output).toContain("authenticity was NOT");
  });

  /**
   * Acceptance 4's exact case: cosign absent. The signature material is present
   * so the verifier reaches the cosign branch, and PATH is emptied so the tool
   * cannot be found regardless of what the host has installed.
   */
  it("reports that the signature was not checked when cosign is absent", () => {
    const dir = join(workspace, "cosign-absent");
    rmSync(dir, { recursive: true, force: true });
    cpSync(pristine, dir, { recursive: true });
    writeFileSync(join(dir, "checksums.txt.bundle"), '{"not":"a real bundle"}');

    const run = spawnSync("./verify.sh", [], {
      cwd: dir,
      encoding: "utf8",
      env: { PATH: "/usr/bin:/bin", HOME: process.env.HOME ?? "" },
    });

    const output = `${run.stdout}${run.stderr}`;
    expect(run.status).toBe(2);
    expect(output).toContain("cosign is not installed");
    expect(output).toContain("authenticity was NOT");
    expect(output).not.toContain("OK: checksums.txt carries a valid signature");
  });

  it("states the identity and issuer it expects, so the operator can check them", () => {
    const verifier = readFileSync(join(pristine, "verify.sh"), "utf8");
    expect(verifier).toContain("token.actions.githubusercontent.com");
    expect(verifier).toContain("statecrafting/enrahitu");
  });
});

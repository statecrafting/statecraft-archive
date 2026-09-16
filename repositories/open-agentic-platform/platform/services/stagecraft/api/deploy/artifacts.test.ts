import { describe, expect, it } from "vitest";
import {
  deriveArtifactRef,
  derivePreviewRef,
  parseImageRef,
  shortSha,
  SHORT_SHA_LEN,
} from "./artifacts";

const FULL_SHA = "0123456789abcdef0123456789abcdef01234567";
const SHORT = FULL_SHA.slice(0, SHORT_SHA_LEN); // "0123456789ab"

describe("deriveArtifactRef (spec 213 FR-002)", () => {
  it("single-variant tree uses an unsuffixed sha tag", () => {
    expect(
      deriveArtifactRef({ githubOrg: "acme", repoName: "my-app", sha: FULL_SHA }),
    ).toBe(`ghcr.io/acme/my-app:sha-${SHORT}`);
  });

  it("defaults variant to root (single-variant)", () => {
    const withRoot = deriveArtifactRef({
      githubOrg: "acme",
      repoName: "my-app",
      sha: FULL_SHA,
      variant: "root",
    });
    const withDefault = deriveArtifactRef({
      githubOrg: "acme",
      repoName: "my-app",
      sha: FULL_SHA,
    });
    expect(withDefault).toBe(withRoot);
  });

  it("dual-profile variants carry a -public / -internal suffix", () => {
    expect(
      deriveArtifactRef({ githubOrg: "acme", repoName: "my-app", sha: FULL_SHA, variant: "public" }),
    ).toBe(`ghcr.io/acme/my-app:sha-${SHORT}-public`);
    expect(
      deriveArtifactRef({ githubOrg: "acme", repoName: "my-app", sha: FULL_SHA, variant: "internal" }),
    ).toBe(`ghcr.io/acme/my-app:sha-${SHORT}-internal`);
  });

  it("truncates the SHA to the 12-char prefix", () => {
    expect(shortSha(FULL_SHA)).toBe(SHORT);
    expect(shortSha(FULL_SHA).length).toBe(12);
    // An already-short SHA is left unchanged.
    expect(shortSha("abc123")).toBe("abc123");
  });

  it("lowercases org/repo so the ref matches what GHCR accepts", () => {
    expect(
      deriveArtifactRef({ githubOrg: "ACME-OLD", repoName: "My-Service", sha: FULL_SHA }),
    ).toBe(`ghcr.io/acme-old/my-service:sha-${SHORT}`);
  });

  it("never derives a latest tag", () => {
    const ref = deriveArtifactRef({ githubOrg: "acme", repoName: "my-app", sha: FULL_SHA });
    expect(ref).not.toContain(":latest");
    expect(ref.endsWith(":latest")).toBe(false);
  });
});

describe("derivePreviewRef (spec 213 FR-003)", () => {
  it("single-variant PR alias is pr-{n}", () => {
    expect(
      derivePreviewRef({ githubOrg: "acme", repoName: "my-app", prNumber: 42 }),
    ).toBe("ghcr.io/acme/my-app:pr-42");
  });

  it("dual-profile PR alias carries the variant suffix", () => {
    expect(
      derivePreviewRef({ githubOrg: "acme", repoName: "my-app", prNumber: 42, variant: "public" }),
    ).toBe("ghcr.io/acme/my-app:pr-42-public");
    expect(
      derivePreviewRef({ githubOrg: "acme", repoName: "my-app", prNumber: 7, variant: "internal" }),
    ).toBe("ghcr.io/acme/my-app:pr-7-internal");
  });
});

describe("parseImageRef", () => {
  it("splits registry, repository, and tag for a derived ref", () => {
    const ref = deriveArtifactRef({ githubOrg: "acme", repoName: "my-app", sha: FULL_SHA });
    expect(parseImageRef(ref)).toEqual({
      registry: "ghcr.io",
      repository: "acme/my-app",
      tag: `sha-${SHORT}`,
    });
  });

  it("round-trips a dual-variant preview ref", () => {
    const ref = derivePreviewRef({ githubOrg: "acme", repoName: "my-app", prNumber: 9, variant: "internal" });
    expect(parseImageRef(ref)).toEqual({
      registry: "ghcr.io",
      repository: "acme/my-app",
      tag: "pr-9-internal",
    });
  });

  it("throws on a tag-less ref rather than guessing", () => {
    expect(() => parseImageRef("ghcr.io/acme/my-app")).toThrow(/missing tag/);
  });
});

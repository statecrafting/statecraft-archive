import type { VerificationProfile } from "./types.js";

const pr: VerificationProfile = {
  name: "pr",
  description: "Verification profile for pull request workflows",
  gate: true,
  skills: ["lint", "type-check", "unit-tests", "security-scan"],
};

const release: VerificationProfile = {
  name: "release",
  description: "Verification profile for release workflows",
  gate: true,
  skills: ["lint", "type-check", "unit-tests", "security-scan", "license-check"],
};

const hotfix: VerificationProfile = {
  name: "hotfix",
  description: "Verification profile for hotfix branches",
  gate: true,
  skills: ["lint", "type-check", "unit-tests", "security-scan"],
};

/** All bundled platform default profiles, keyed by name. */
export function getDefaultProfiles(): Map<string, VerificationProfile> {
  const map = new Map<string, VerificationProfile>();
  for (const profile of [pr, release, hotfix]) {
    map.set(profile.name, profile);
  }
  return map;
}

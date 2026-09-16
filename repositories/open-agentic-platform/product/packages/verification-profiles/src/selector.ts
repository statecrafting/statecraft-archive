export interface ProfileContext {
  /** Current git branch name (for example: "feature/x", "release/1.2.0"). */
  branch?: string;
  /** Whether the current context is a pull request workflow. */
  isPR?: boolean;
  /** Whether the current context is a release workflow. */
  isRelease?: boolean;
  /** Explicit profile name from CLI/user input (for example: --verify=release). */
  explicit?: string;
}

function normalizeProfileName(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function normalizeBranch(branch: string): string {
  const trimmed = branch.trim();
  if (trimmed.startsWith("refs/heads/")) {
    return trimmed.slice("refs/heads/".length).toLowerCase();
  }
  return trimmed.toLowerCase();
}

/**
 * Select verification profile from explicit override or workflow context (FR-005).
 *
 * Precedence:
 * 1) explicit profile (e.g. --verify=release)
 * 2) boolean workflow hints (isRelease / isPR)
 * 3) branch naming patterns
 */
export function selectProfile(context: ProfileContext): string | null {
  const explicit = normalizeProfileName(context.explicit);
  if (explicit) {
    return explicit;
  }

  if (context.isRelease) {
    return "release";
  }
  if (context.isPR) {
    return "pr";
  }

  if (!context.branch) {
    return null;
  }
  const branch = normalizeBranch(context.branch);

  if (/^(release|rel)\/.+$/.test(branch)) {
    return "release";
  }
  if (/^hotfix\/.+$/.test(branch)) {
    return "hotfix";
  }
  if (/^pull\/\d+\/(head|merge)$/.test(branch)) {
    return "pr";
  }
  if (/^pr\/.+$/.test(branch)) {
    return "pr";
  }
  if (/^(feature|feat|bugfix|fix|chore|refactor|docs|test|perf|ci|build)\/.+$/.test(branch)) {
    return "pr";
  }

  return null;
}

/**
 * Parse an explicit --verify flag from argv-style CLI args.
 * Supports:
 * - --verify=release
 * - --verify release
 */
export function parseVerifyFlag(args: string[]): string | null {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith("--verify=")) {
      return normalizeProfileName(arg.slice("--verify=".length));
    }
    if (arg === "--verify") {
      return normalizeProfileName(args[i + 1]);
    }
  }
  return null;
}

/**
 * Secret censoring — scrubs common secret patterns from text before display.
 *
 * Zero dependencies. Patterns covered:
 *   - Anthropic API keys (sk-ant-*)
 *   - OpenAI API keys (sk-*)
 *   - GitHub tokens (ghp_/gho_/ghu_/ghr_/ghs_/github_pat_)
 *   - AWS access key IDs (AKIA/ASIA/ABIA/ACCA)
 *   - AWS secret access keys
 *   - Generic Bearer tokens
 *   - Private key PEM blocks
 *   - Basic auth credentials in URLs
 *   - Generic high-entropy strings assigned to secret-ish env vars
 *
 * Ported from claudepal (server/src/cli/censor.ts).
 */

const REDACTED = "[REDACTED]";

interface CensorPattern {
  re: RegExp;
  replacement: string | ((...args: string[]) => string);
}

const PATTERNS: CensorPattern[] = [
  // Anthropic API keys: sk-ant-api03-...
  { re: /sk-ant-[A-Za-z0-9\-_]{20,}/g, replacement: REDACTED },

  // OpenAI API keys: sk-proj-..., sk-...
  { re: /sk-(?:proj-)?[A-Za-z0-9\-_T]{20,}/g, replacement: REDACTED },

  // GitHub personal access tokens
  { re: /gh[pousr]_[A-Za-z0-9_]{36,}/g, replacement: REDACTED },
  // GitHub fine-grained tokens
  { re: /github_pat_[A-Za-z0-9_]{22,}/g, replacement: REDACTED },

  // AWS access key IDs
  {
    re: /(?<![A-Z0-9])(AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}(?![A-Z0-9])/g,
    replacement: REDACTED,
  },

  // AWS secret access keys (40 chars base64-ish after assignment)
  {
    re: /(?:aws.{0,20}secret.{0,20}[=:]\s*)["']?([A-Za-z0-9+/]{40})["']?/gi,
    replacement: (m: string) => m.replace(/[A-Za-z0-9+/]{40}/, REDACTED),
  },

  // Bearer tokens in headers
  {
    re: /Bearer\s+[A-Za-z0-9\-_=+/.]{20,}/g,
    replacement: `Bearer ${REDACTED}`,
  },

  // Basic auth credentials embedded in URLs: https://user:pass@host
  { re: /(:\/\/[^:@\s]+:)[^@\s]+(@)/g, replacement: `$1${REDACTED}$2` },

  // PEM private key blocks
  {
    re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g,
    replacement: `-----BEGIN PRIVATE KEY-----\n${REDACTED}\n-----END PRIVATE KEY-----`,
  },

  // Generic: env var assignments with secret-ish names
  // Matches: SOME_SECRET="value", TOKEN=value, etc.
  {
    re: /\b((?:SECRET|TOKEN|PASSWORD|PASSWD|API[_-]?KEY|PRIVATE[_-]?KEY|ACCESS[_-]?KEY|AUTH[_-]?KEY|DB[_-]?PASS)[A-Z_0-9]*)\s*[=:]\s*["']?([A-Za-z0-9\-_=+/.]{12,})["']?/gi,
    replacement: (_m: string, name: string) => `${name}=${REDACTED}`,
  },
];

/**
 * Scrub known secret patterns from a string.
 * Returns the sanitised string, or the original if nothing matched.
 */
export function censorSecrets(text: string): string {
  let result = text;
  for (const { re, replacement } of PATTERNS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    result = result.replace(re, replacement as any);
    re.lastIndex = 0; // reset global regex state
  }
  return result;
}

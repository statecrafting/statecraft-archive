/**
 * Pure path-sanitisation for the BFF proxy (spec 004 FR-002, INV-10).
 *
 * Kept free of Encore imports so it can be unit-tested in isolation. proxy.ts
 * imports sanitizePath from here.
 */

/** True if the string contains any ASCII control character (0x00..0x1f or 0x7f). */
export function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * Iteratively decodes the path (defeating %2e%2e and double-encoding), rejects
 * control characters and any `..` segment, and re-anchors to a single leading
 * slash. Returns null when the path must be blocked.
 */
export function sanitizePath(rawPath: string): string | null {
  let decoded = rawPath;
  for (let i = 0; i < 5; i++) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return null;
    }
    if (next === decoded) break;
    decoded = next;
  }
  if (hasControlCharacter(decoded)) return null;
  const segments = decoded.split("/");
  if (segments.some((segment) => segment === "..")) return null;
  return "/" + segments.filter((segment) => segment.length > 0).join("/");
}

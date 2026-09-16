/**
 * Pure response-masking decisions for the BFF proxy (spec 004 FR-004/FR-005,
 * INV-10). Kept free of Encore and Node imports so the masking contract is unit
 * testable in isolation; proxy.ts wires these into the raw handler.
 */

/** Upstream server errors (5xx) are masked to a generic 502: never leak them. */
export function isServerError(upstreamStatus: number): boolean {
  return upstreamStatus >= 500;
}

/** A fetch rejection caused by the abort timer is the 504 (deadline) case. */
export function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

/**
 * Remove a leaked stack trace from a parsed 4xx JSON error body before it is
 * forwarded to the public caller. Returns the same value for convenience; a body
 * without an `error` object is returned unchanged.
 */
export function stripErrorStack<T>(body: T): T {
  if (body && typeof body === "object" && "error" in body) {
    const error = (body as { error?: unknown }).error;
    if (error && typeof error === "object" && "stack" in error) {
      delete (error as { stack?: unknown }).stack;
    }
  }
  return body;
}

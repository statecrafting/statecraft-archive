/**
 * Unwrap an error for structured logging.
 *
 * Drizzle's `DrizzleQueryError` and similar wrappers set `.cause` to the
 * underlying driver error (e.g. a `pg` error with `.code`, `.detail`,
 * `.schema`, `.table`, `.column`). `String(err)` only yields the outer
 * `message`, which masks the actual failure.
 */
export function errorForLog(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const out: Record<string, unknown> = {
      message: err.message,
      name: err.name,
    };
    const anyErr = err as unknown as Record<string, unknown>;
    for (const key of ["code", "detail", "schema", "table", "column", "constraint", "hint"]) {
      if (anyErr[key] !== undefined) out[key] = anyErr[key];
    }
    if (err.cause) out.cause = errorForLog(err.cause);
    return out;
  }
  return { message: String(err) };
}

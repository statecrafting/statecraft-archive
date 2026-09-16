// Lightweight mock for encore.dev/api used by vitest when running outside
// the Encore runtime (e.g. CI with `npm test`).
//
// The `api()` wrapper simply returns the handler function so unit tests can
// call endpoints directly. `api.raw`, `api.streamIn`, `api.streamOut`, and
// `api.streamInOut` share the same semantics — tests invoke the handler
// directly and do not exercise the gateway plumbing.
//
// `APIError` matches the real shape closely enough for tests that branch on
// `err.code === "not_found"` and similar.

type Handler = (...args: unknown[]) => unknown;

function wrap(_options: unknown, handler: Handler): Handler {
  return handler;
}

export const api = Object.assign(wrap, {
  raw: wrap,
  streamIn: wrap,
  streamOut: wrap,
  streamInOut: wrap,
}) as typeof wrap & {
  raw: typeof wrap;
  streamIn: typeof wrap;
  streamOut: typeof wrap;
  streamInOut: typeof wrap;
};

export class APIError extends Error {
  public readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }

  static notFound(message: string): APIError {
    return new APIError("not_found", message);
  }
  static invalidArgument(message: string): APIError {
    return new APIError("invalid_argument", message);
  }
  static permissionDenied(message: string): APIError {
    return new APIError("permission_denied", message);
  }
  static failedPrecondition(message: string): APIError {
    return new APIError("failed_precondition", message);
  }
  static unauthenticated(message: string): APIError {
    return new APIError("unauthenticated", message);
  }
  static internal(message: string): APIError {
    return new APIError("internal", message);
  }
  static resourceExhausted(message: string): APIError {
    return new APIError("resource_exhausted", message);
  }
}

// `StreamOut` and related stream types are phantom at runtime — the real
// module exports them as TypeScript-only symbols. Vitest never imports the
// value side, so exporting an empty placeholder keeps type-only imports
// happy under transpile-only mode without breaking anything.
export type StreamOut<T> = { send: (msg: T) => Promise<void> };
export type StreamIn<T> = { recv: () => Promise<T | null> };
export type StreamInOut<I, O> = StreamIn<I> & StreamOut<O>;

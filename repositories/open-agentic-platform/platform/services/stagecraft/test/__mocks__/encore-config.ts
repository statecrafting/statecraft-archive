// Lightweight mock for encore.dev/config used by vitest when running outside
// the Encore runtime (npm test path; the live runtime is provided when
// running under `encore test`).
//
// Encore's `secret(name)` returns a thunk that reads the secret value at
// call time. The mock thunk reads `process.env[name]` instead so unit
// tests can set/unset secret values via env-var manipulation without
// driving the Encore CLI's secret store.

export function secret(name: string): () => string {
  return () => process.env[name] ?? "";
}

// The lifecycle policy's wire and record shape (spec 123 B-2), in a module that
// imports nothing at run time. The web UI's client posts this shape and the
// registry journals it, so both must build it from one function; the UI's
// bundle reaches that function, and `lifecycle-policy.ts` imports `fs`,
// `path` and (through the receipt and the journal) `crypto`, which a browser
// cannot load. Vite's dev server refuses such a module outright, so the
// function lives here and `lifecycle-policy.ts` re-exports it (128 D-16).
import type { JsonValue } from "./journal";
import type { LifecyclePolicy, PolicySource } from "./lifecycle-policy";

export function policyPayload(policy: LifecyclePolicy, source: PolicySource): Record<string, JsonValue> {
  return {
    policy: {
      schedulable: { statuses: [...policy.schedulable.statuses], namedDraft: policy.schedulable.namedDraft },
      merge: { method: policy.merge.method },
      sensitive: { prefixes: [...policy.sensitive.prefixes], onTouch: policy.sensitive.onTouch },
      humanGate: policy.humanGate,
    },
    source,
  };
}

// SPDX-License-Identifier: Apache-2.0

//! The v0.1 capability-kind table (enrahitu spec 020 section 3.3).
//!
//! The kernel must classify every kind it enforces: an unknown kind cannot be
//! enforced and therefore cannot be permitted, so boot refuses a model that
//! declares one. The boolean marks the kinds a `read-only` trust level may
//! still exercise. `secret.read` is deliberately classified non-read:
//! released credential material acts on the world, whatever the verb says.

const KINDS: &[(&str, bool)] = &[
    ("db.read", true),
    ("db.write", false),
    ("db.txn", false),
    ("db.migrate", false),
    ("kv.get", true),
    ("kv.put", false),
    ("kv.delete", false),
    ("counter.get", true),
    ("counter.add", false),
    ("counter.set", false),
    ("counter.delete", false),
    ("lock.acquire", false),
    ("notify.publish", false),
    ("notify.listen", true),
    ("pubsub.publish", false),
    ("pubsub.subscribe", true),
    ("bucket.list", true),
    ("bucket.read", true),
    ("bucket.write", false),
    ("bucket.delete", false),
    // Signing mints a new capability (a usable URL), so it is not a read.
    ("bucket.sign", false),
    ("secret.read", false),
    ("ledger.append", false),
    ("ledger.read", true),
    ("ledger.verify", true),
    // The callee may mutate; fail closed.
    ("endpoint.call", false),
    ("http.egress", false),
    // Mail is the first effect to escape the HTTP-shaped egress facade: an SMTP
    // transport opens a TCP socket, which a governed fetch never sees. A
    // deployment that can be made to send mail without a Decision has an audit
    // record incomplete in the direction that matters most, because mail is the
    // channel that reaches people (enrahitu spec 037 section 3.2).
    ("smtp.egress", false),
    ("tool.invoke", false),
];

/// Whether `kind` is in the v0.1 vocabulary.
pub fn is_known(kind: &str) -> bool {
    KINDS.iter().any(|(k, _)| *k == kind)
}

/// Whether `kind` is exercisable at `read-only` trust. Unknown kinds are
/// non-read by construction (but they never get this far: boot refuses them).
pub fn is_read(kind: &str) -> bool {
    KINDS.iter().any(|(k, read)| *k == kind && *read)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vocabulary_matches_the_contract() {
        // 29 kinds in 020 section 3.3.
        assert_eq!(KINDS.len(), 29);
        assert!(is_known("db.read"));
        assert!(is_known("tool.invoke"));
        assert!(!is_known("db.drop"));
    }

    #[test]
    fn mail_leaves_through_a_classified_kind() {
        // The kind exists so that the one module permitted a socket adjudicates
        // before opening it. Classified non-read for the same reason
        // `secret.read` is: sending acts on the world.
        assert!(is_known("smtp.egress"));
        assert!(!is_read("smtp.egress"));
    }

    #[test]
    fn read_classification() {
        assert!(is_read("kv.get"));
        assert!(is_read("ledger.verify"));
        assert!(!is_read("kv.put"));
        assert!(!is_read("secret.read"), "credential egress is not a read");
        assert!(!is_read("bucket.sign"), "signing mints a capability");
    }
}

//! The redactor for opt-in content inspection. Every byte read from the
//! observed tree passes through `redact` before it is displayed anywhere.

use regex::Regex;
use std::sync::OnceLock;

struct Rules {
    tokens: Vec<(Regex, &'static str)>,
    json_field: Regex,
    env_field: Regex,
    hex_run: Regex,
    b64_run: Regex,
}

fn rules() -> &'static Rules {
    static RULES: OnceLock<Rules> = OnceLock::new();
    RULES.get_or_init(|| Rules {
        tokens: vec![
            (Regex::new(r"sk-ant-[A-Za-z0-9_-]{8,}").unwrap(), "anthropic-key"),
            // Spec 115 B-5: the `sk-proj-` and bare `sk-` forms OpenAI issues.
            (
                Regex::new(r"\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}").unwrap(),
                "openai-key",
            ),
            (
                Regex::new(r"(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}").unwrap(),
                "github-token",
            ),
            (Regex::new(r"github_pat_[A-Za-z0-9_]{20,}").unwrap(), "github-pat"),
            (
                Regex::new(r"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}").unwrap(),
                "jwt",
            ),
            (
                Regex::new(r"\b[Bb]earer\s+[A-Za-z0-9._~+/=-]{16,}").unwrap(),
                "bearer-token",
            ),
            (Regex::new(r"\bAKIA[A-Z0-9]{16}\b").unwrap(), "aws-access-key-id"),
            (Regex::new(r"xox[baprs]-[A-Za-z0-9-]{10,}").unwrap(), "slack-token"),
        ],
        // "some_api_key": "value"  /  "authToken": "value"  (JSON-ish fields)
        json_field: Regex::new(
            r#"(?i)("[^"]*(?:token|key|secret|password|passwd|credential|auth)[^"]*"\s*:\s*")((?:[^"\\]|\\.){4,})(")"#,
        )
        .unwrap(),
        // FOO_TOKEN=value style (shell snapshots, env dumps)
        env_field: Regex::new(
            r"\b([A-Za-z_]*(?:TOKEN|KEY|SECRET|PASSWORD|PASSWD|CREDENTIAL)[A-Za-z_]*)(\s*=\s*)(\S+)",
        )
        .unwrap(),
        // Long opaque runs: hex >= 32 chars, base64-ish >= 48 chars.
        hex_run: Regex::new(r"\b[a-fA-F0-9]{32,}\b").unwrap(),
        b64_run: Regex::new(r"\b[A-Za-z0-9+/]{48,}={0,2}\b").unwrap(),
    })
}

pub fn redact(text: &str) -> String {
    let r = rules();
    let mut out = r
        .json_field
        .replace_all(text, "$1[REDACTED:field]$3")
        .into_owned();
    out = r
        .env_field
        .replace_all(&out, "$1$2[REDACTED:env]")
        .into_owned();
    for (re, tag) in &r.tokens {
        out = re
            .replace_all(&out, format!("[REDACTED:{tag}]").as_str())
            .into_owned();
    }
    out = r
        .hex_run
        .replace_all(&out, |m: &regex::Captures<'_>| {
            format!("[REDACTED:hex{}]", m[0].len())
        })
        .into_owned();
    out = r
        .b64_run
        .replace_all(&out, |m: &regex::Captures<'_>| {
            format!("[REDACTED:b64x{}]", m[0].len())
        })
        .into_owned();
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_tokens_fields_env_and_opaque_runs() {
        assert_eq!(
            redact("key sk-ant-abcdefghij here"),
            "key [REDACTED:anthropic-key] here"
        );
        // Spec 115 B-5: both OpenAI forms, and the Anthropic form still wins first.
        assert_eq!(
            redact("k sk-proj-abcdefghijklmnopqrstuvwxyz0123 and sk-abcdefghijklmnopqrstuvwxyz"),
            "k [REDACTED:openai-key] and [REDACTED:openai-key]"
        );
        assert_eq!(
            redact("sk-ant-abcdefghijklmnopqrstuvwxyz"),
            "[REDACTED:anthropic-key]"
        );
        assert_eq!(
            redact(r#"{"authToken": "abcd1234"}"#),
            r#"{"authToken": "[REDACTED:field]"}"#
        );
        assert_eq!(
            redact("export GITHUB_TOKEN=ghp_x"),
            "export GITHUB_TOKEN=[REDACTED:env]"
        );
        assert_eq!(
            redact("id 0123456789abcdef0123456789abcdef"),
            "id [REDACTED:hex32]"
        );
        assert_eq!(redact("plain text stays"), "plain text stays");
        let jwt = format!("eyJ{}.{}.{}", "a".repeat(12), "b".repeat(12), "c".repeat(6));
        assert_eq!(redact(&jwt), "[REDACTED:jwt]");
    }
}

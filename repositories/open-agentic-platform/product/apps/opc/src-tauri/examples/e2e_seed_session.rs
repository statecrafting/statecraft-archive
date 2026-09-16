// Spec 187 `[[opc-e2e-auth-state-seeding]]`: e2e keychain seed helper.
//
// A tiny CLI that writes (or clears) an OS-keychain entry via the SAME
// `keyring` crate and version the OPC app links (`Cargo.toml` dep at the crate
// root), so a value it stores is guaranteed to read back identically through
// `StatecraftClient::load_token_from_keychain` / `auth_get_status` /
// `resolve_token`. That "same crate" guarantee is why this helper lives inside
// the opc crate rather than in a standalone helper crate: a re-declared
// dependency could drift and silently break Secret-Service attribute
// compatibility.
//
// It is a cargo `[[example]]`, NOT a `[[bin]]`, and deliberately so: Tauri's
// bundler enumerates every `[[bin]]` target of the packaged crate and tries to
// copy each one into the app bundle. A `[[bin]]` gated behind
// `required-features` is never built by the release `cargo build`, so the
// bundler failed with "e2e_seed_session does not exist" and broke both the
// Release Desktop workflow and the nightly's `tauri build` step. Examples are
// not bundled, so living in `examples/` keeps it out of Tauri's sight while
// staying in the same crate (same `keyring`). It is still NEVER compiled into a
// shipping build: the `[[example]]` target carries
// `required-features = ["e2e-seed"]`, and nothing in the production feature set
// enables `e2e-seed`. Only the nightly e2e job builds it, with
// `--features e2e-seed`. The production `opc` binary is byte-for-byte
// unchanged by this file's existence.
//
// The seed VALUE (a fake, unsigned session JWT) is produced test-side by the
// harness helper `tests-e2e/harness/seed_session.ts` and piped in on stdin, so
// it never appears in argv / the process table. OPC decodes the JWT's claims
// but never verifies its signature (`statecraft_client.rs::decode_jwt_claims`),
// so a self-signed payload with an `exp` in the future and a `custom.oap_org_id`
// claim is a complete "signed-in" seed.
//
// Usage:
//   printf '%s' "<jwt>" | e2e_seed_session set   [--service S] [--account A]
//                         e2e_seed_session clear [--service S] [--account A]
// Defaults: service "dev.opc.statecraft", account "session" (mirrors
// `keychain.rs::SERVICE_NAME` / `DEFAULT_USER` and the hard-coded slots in
// `statecraft_client.rs`).

use std::io::Read;
use std::process::ExitCode;

const DEFAULT_SERVICE: &str = "dev.opc.statecraft";
const DEFAULT_ACCOUNT: &str = "session";

fn main() -> ExitCode {
    let mut args = std::env::args().skip(1);
    let Some(command) = args.next() else {
        eprintln!("e2e_seed_session: missing command (expected `set` or `clear`)");
        return ExitCode::FAILURE;
    };

    let mut service = DEFAULT_SERVICE.to_string();
    let mut account = DEFAULT_ACCOUNT.to_string();
    while let Some(flag) = args.next() {
        match flag.as_str() {
            "--service" => match args.next() {
                Some(v) => service = v,
                None => return usage_err("--service requires a value"),
            },
            "--account" => match args.next() {
                Some(v) => account = v,
                None => return usage_err("--account requires a value"),
            },
            other => return usage_err(&format!("unknown flag `{other}`")),
        }
    }

    let entry = match keyring::Entry::new(&service, &account) {
        Ok(e) => e,
        Err(e) => {
            eprintln!("e2e_seed_session: keyring open failed ({service}/{account}): {e}");
            return ExitCode::FAILURE;
        }
    };

    match command.as_str() {
        "set" => {
            let mut value = String::new();
            if let Err(e) = std::io::stdin().read_to_string(&mut value) {
                eprintln!("e2e_seed_session: failed to read secret from stdin: {e}");
                return ExitCode::FAILURE;
            }
            // Do not trim interior bytes: the JWT is piped verbatim. A trailing
            // newline would corrupt the third (signature) segment's base64url,
            // but the harness pipes with `printf '%s'` (no newline); strip a
            // stray trailing CR/LF anyway as a guard.
            let value = value.trim_end_matches(['\n', '\r']);
            if value.is_empty() {
                eprintln!("e2e_seed_session: refusing to store an empty secret");
                return ExitCode::FAILURE;
            }
            match entry.set_password(value) {
                Ok(()) => ExitCode::SUCCESS,
                Err(e) => {
                    eprintln!("e2e_seed_session: set failed ({service}/{account}): {e}");
                    ExitCode::FAILURE
                }
            }
        }
        "clear" => match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => ExitCode::SUCCESS,
            Err(e) => {
                eprintln!("e2e_seed_session: clear failed ({service}/{account}): {e}");
                ExitCode::FAILURE
            }
        },
        other => usage_err(&format!("unknown command `{other}` (expected `set` or `clear`)")),
    }
}

fn usage_err(msg: &str) -> ExitCode {
    eprintln!("e2e_seed_session: {msg}");
    eprintln!("usage: e2e_seed_session <set|clear> [--service S] [--account A]  (set reads value from stdin)");
    ExitCode::FAILURE
}

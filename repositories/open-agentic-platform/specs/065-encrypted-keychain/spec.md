---
id: "065-encrypted-keychain"
title: "Encrypted Keychain and Credential Storage"
feature_branch: "065-encrypted-keychain"
status: approved
implementation: complete
kind: desktop
domain: opc
created: "2026-03-31"
authors:
  - "open-agentic-platform"
language: en
summary: >
  Software keychain for the desktop app using AES-256-GCM encryption with a
  machine-derived key. Stores API keys, tokens, and credentials in a typed,
  encrypted SQLite table with per-entry active/inactive toggle. Integrates with
  the existing censor module to prevent accidental exposure of stored secrets
  in agent output.
code_aliases:
  - ENCRYPTED_KEYCHAIN
sources:
  - claudepal
  - claudecodeui
references:
  - role: historical
    unit: { kind: file, path: product/apps/opc/src-tauri/src/keychain.rs }
  - role: historical
    unit: { kind: file, path: product/apps/opc/src/components/CredentialPicker.tsx }
extends:
  - spec: "032-opc-inspect-governance-wiring-mvp"
    nature: additive
    unit: { kind: crate, id: "@opc/desktop" }
---

# Feature Specification: Encrypted Keychain and Credential Storage

## Purpose

The desktop app needs to store sensitive credentials — API keys for LLM providers, GitHub tokens, MCP server secrets, and other authentication material. Currently there is no secure storage mechanism; users must configure credentials via environment variables or manual config files, which are plaintext on disk and easy to leak through agent output, git commits, or log files.

This feature provides a software keychain that encrypts credentials at rest using AES-256-GCM with a machine-derived key. Credentials are stored in a typed SQLite table, accessible through a clean API, and integrated with the existing `censor.ts` module so that stored secret values are automatically scrubbed from any agent output.

## Scope

### In scope

- **Machine-derived encryption key**: Derive an encryption key from machine-specific identifiers (machine ID + app-specific salt) using PBKDF2/HKDF so the keychain is bound to the device.
- **AES-256-GCM encryption**: Each credential value is encrypted individually with a unique IV per entry.
- **Typed credential entries**: Each entry has a type (api_key, token, password, certificate, generic), a label, an encrypted value, metadata, and an active/inactive toggle.
- **CRUD API**: Create, read (decrypt), update, list (metadata only, no decrypted values), delete credentials.
- **Censor integration**: On credential creation/update, register the plaintext value pattern with `censor.ts` so it is scrubbed from all agent output.
- **Tauri command bridge**: Expose keychain operations as Tauri commands callable from the React frontend.
- **Credential picker UI**: Settings panel for managing stored credentials, with masked display and copy-to-clipboard.

### Out of scope

- **OS keychain integration (macOS Keychain, Windows Credential Manager)**: The initial implementation is a standalone software keychain. OS keychain integration is a follow-on for platforms that support it.
- **Multi-user / team credential sharing**: Credentials are per-device, single-user.
- **Credential rotation automation**: Detecting and auto-rotating expired credentials is deferred.
- **Hardware security module (HSM) support**: Software-only encryption for now.
- **Biometric unlock (Touch ID, Windows Hello)**: Deferred to a follow-on enhancement.

## Requirements

### Functional

- **FR-001**: The encryption key is derived from a machine identifier and an application-specific salt using HKDF-SHA256, producing a 256-bit key. The machine identifier is sourced from the platform's machine ID facility (Tauri's `os` plugin or equivalent).
- **FR-002**: Each credential value is encrypted using AES-256-GCM with a 96-bit random IV generated per encryption operation. The IV is stored alongside the ciphertext.
- **FR-003**: The credential table schema:
  ```sql
  CREATE TABLE credentials (
    id          TEXT PRIMARY KEY,    -- UUID v4
    type        TEXT NOT NULL,       -- api_key | token | password | certificate | generic
    label       TEXT NOT NULL,       -- human-readable name
    provider    TEXT,                -- optional: anthropic | openai | github | custom
    ciphertext  BLOB NOT NULL,
    iv          BLOB NOT NULL,       -- 12 bytes
    auth_tag    BLOB NOT NULL,       -- 16 bytes
    metadata    TEXT,                -- JSON blob for extra fields
    active      INTEGER DEFAULT 1,  -- 1 = active, 0 = inactive
    created_at  TEXT NOT NULL,       -- ISO 8601
    updated_at  TEXT NOT NULL        -- ISO 8601
  );
  ```
- **FR-004**: `create(type, label, plaintext, provider?, metadata?)` encrypts the value and inserts a row. Returns the credential ID.
- **FR-005**: `read(id)` decrypts and returns the plaintext value. Only callable from Rust backend; never exposed directly to the frontend.
- **FR-006**: `list()` returns all credentials with metadata (id, type, label, provider, active, created_at, updated_at) but never decrypted values.
- **FR-007**: `update(id, fields)` re-encrypts if the plaintext value changes (new IV), updates metadata fields.
- **FR-008**: `delete(id)` removes the credential row. The ciphertext is zeroed before deletion.
- **FR-009**: `toggle(id, active)` enables or disables a credential without deleting it. Disabled credentials are excluded from provider resolution.
- **FR-010**: On create and update, the plaintext value (and common derived forms like `Bearer <value>`) is registered with the censor module so agent output containing the value is scrubbed.
- **FR-011**: On delete, the value's censor pattern is unregistered.
- **FR-012**: The keychain database file is stored in the Tauri app data directory with restrictive file permissions (0600 on Unix, ACL-restricted on Windows).

### Non-functional

- **NF-001**: Encrypt/decrypt operations complete in < 1ms per credential.
- **NF-002**: The keychain supports at least 1000 stored credentials without performance degradation.
- **NF-003**: The encryption key derivation runs once at app startup and is cached in memory for the session lifetime.
- **NF-004**: No plaintext credential value is ever written to disk outside the encrypted SQLite database (no temp files, no swap, no logs).

## Architecture

### Key derivation

```rust
use hkdf::Hkdf;
use sha2::Sha256;

struct KeychainKey {
    key: [u8; 32],
}

impl KeychainKey {
    fn derive(machine_id: &[u8], app_salt: &[u8]) -> Self {
        let hk = Hkdf::<Sha256>::new(Some(app_salt), machine_id);
        let mut key = [0u8; 32];
        hk.expand(b"oap-keychain-v1", &mut key)
            .expect("32 bytes is a valid length for HKDF-SHA256");
        Self { key }
    }
}
```

### Encrypt/decrypt

```rust
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use aes_gcm::aead::Aead;
use rand::RngCore;

struct EncryptedValue {
    ciphertext: Vec<u8>,
    iv: [u8; 12],
    auth_tag: Vec<u8>, // last 16 bytes of ciphertext in aes-gcm crate
}

fn encrypt(key: &KeychainKey, plaintext: &[u8]) -> EncryptedValue {
    let cipher = Aes256Gcm::new_from_slice(&key.key).unwrap();
    let mut iv = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut iv);
    let nonce = Nonce::from_slice(&iv);
    let ciphertext = cipher.encrypt(nonce, plaintext).unwrap();
    EncryptedValue { ciphertext, iv, auth_tag: vec![] }
}

fn decrypt(key: &KeychainKey, encrypted: &EncryptedValue) -> Vec<u8> {
    let cipher = Aes256Gcm::new_from_slice(&key.key).unwrap();
    let nonce = Nonce::from_slice(&encrypted.iv);
    cipher.decrypt(nonce, encrypted.ciphertext.as_ref()).unwrap()
}
```

### Tauri command bridge

```rust
#[tauri::command]
async fn keychain_create(
    type_: String, label: String, value: String,
    provider: Option<String>, metadata: Option<String>,
    state: State<'_, KeychainState>,
) -> Result<String, String> { /* ... */ }

#[tauri::command]
async fn keychain_list(state: State<'_, KeychainState>) -> Result<Vec<CredentialMeta>, String> { /* ... */ }

#[tauri::command]
async fn keychain_delete(id: String, state: State<'_, KeychainState>) -> Result<(), String> { /* ... */ }

#[tauri::command]
async fn keychain_toggle(id: String, active: bool, state: State<'_, KeychainState>) -> Result<(), String> { /* ... */ }

// NOTE: No keychain_read command exposed to frontend.
// Decryption happens only in Rust backend when a provider needs the credential.
```

### Censor integration flow

```
User creates credential "ANTHROPIC_API_KEY" = "sk-ant-abc123..."
  |
  v
Keychain encrypts and stores
  |
  v
Register patterns with censor.ts:
  - "sk-ant-abc123..."         (raw value)
  - "Bearer sk-ant-abc123..."  (bearer token form)
  - "sk-ant-abc1..."           (first-12-char prefix for partial matches)
  |
  v
Any agent output containing these patterns is scrubbed to "[REDACTED]"
```

## Implementation approach

1. **Phase 1 — key derivation and crypto**: Implement `KeychainKey::derive()`, `encrypt()`, `decrypt()` in Rust. Unit tests with known test vectors.
2. **Phase 2 — SQLite schema and CRUD**: Create the credentials table, implement create/read/list/update/delete/toggle operations. Integration tests against an in-memory SQLite database.
3. **Phase 3 — censor integration**: Wire credential create/update/delete to register/unregister patterns with the censor module. Test that stored credential values are scrubbed from sample output.
4. **Phase 4 — Tauri commands**: Expose keychain operations as Tauri commands. Integration test from a Tauri test harness.
5. **Phase 5 — credential picker UI**: Settings panel in the React frontend for listing, creating, toggling, and deleting credentials. Masked value display with reveal toggle.
6. **Phase 6 — provider resolution**: Wire the provider registry (spec 042) to resolve API keys from the keychain by provider name and credential type.

## Success criteria

- **SC-001**: A credential stored via `keychain_create` can be retrieved via `keychain_read` with the correct plaintext value.
- **SC-002**: The SQLite database file contains no plaintext credential values (verified by binary search of the file).
- **SC-003**: Agent output containing a stored credential value is scrubbed to `[REDACTED]` by the censor module.
- **SC-004**: Deleting a credential unregisters its censor pattern — subsequent agent output containing the former value passes through unmodified.
- **SC-005**: The `keychain_list` Tauri command returns metadata for all credentials without any decrypted values.
- **SC-006**: Credential encryption uses a unique IV per operation — encrypting the same plaintext twice produces different ciphertext.

## Dependencies

| Spec | Relationship |
|------|-------------|
| 042-multi-provider-agent-registry | Provider registry consumes credentials from the keychain for API authentication |
| 010 (censor module) | Censor module receives secret patterns from the keychain for output scrubbing |

## Risk

- **R-001**: Machine-derived key means the keychain is not portable across machines. Mitigation: this is intentional — credentials are device-bound. Export/import with re-encryption can be added later.
- **R-002**: If the machine ID changes (OS reinstall, hardware swap), all credentials become unreadable. Mitigation: document this clearly; consider a recovery key backup mechanism as a follow-on.
- **R-003**: In-memory key caching means the key is in process memory for the app lifetime. Mitigation: use `mlock`/`VirtualLock` to prevent the key from being swapped to disk. Clear on app shutdown.
- **R-004**: SQLite WAL or journal files may transiently contain plaintext during write operations. Mitigation: use `PRAGMA journal_mode=DELETE` and `PRAGMA secure_delete=ON` to overwrite deleted data.

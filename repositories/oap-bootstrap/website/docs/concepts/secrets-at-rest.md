# Secrets at Rest

Handling sensitive credentials securely is a core requirement of `oap-bootstrap`. The CLI ensures that secrets are protected while at rest, yet accessible to the upstream scripts when needed.

## SOPS and age Encryption

The `oap.env` configuration file is designed to be committed to version control safely. To achieve this, `oap-bootstrap` uses [SOPS](https://github.com/getsops/sops) backed by [age](https://github.com/FiloSottile/age) encryption.

When saving the configuration, the CLI leverages the SOPS `encrypted_regex` feature. It selectively encrypts only the keys that are explicitly classified as secrets in the internal registry (e.g., tokens, passwords, and private keys). Non-secret configuration values, such as domain names and organization targets, remain in cleartext. This ensures that standard Git diffs remain readable for configuration changes while sensitive data is protected.

The CLI reuses the operator's existing age key, typically located at `~/.config/sops/age/keys.txt` or specified by the `SOPS_AGE_KEY_FILE` environment variable. Decryption occurs entirely in-process using the SOPS Go library.

## The Plaintext Fallback

If `sops` or `age` are not installed on the system, the CLI will fall back to a plaintext vault. In this scenario, secrets are written to `oap.env` in cleartext. 

When this fallback occurs, the CLI emits a loud, visible warning:
> `sops/age unavailable: oap.env secrets will be stored in CLEARTEXT`

## The Cleartext Bridge

The upstream `setup.sh` script expects to `source` a standard, unencrypted `.env` file. To bridge the gap between the encrypted `oap.env` and the upstream script, the CLI creates a transient cleartext file.

Before executing a wrapped phase, `oap-bootstrap` writes all configuration keys into a temporary `.env` file with restrictive `0600` permissions. After the phase completes, the CLI immediately shreds this file.

### Shredding Limitations

The shredding process attempts to overwrite the file's bytes with random data before unlinking it. However, this is a portable best-effort operation. On copy-on-write (CoW) or log-structured filesystems, the overwrite may not physically hit the original disk blocks. While it removes the file from the namespace and prevents trivial recovery, operators should be aware of these underlying filesystem semantics.

For debugging purposes, the CLI provides a `--keep-bridge` flag that prevents the file from being shredded, leaving the plaintext secrets on disk.

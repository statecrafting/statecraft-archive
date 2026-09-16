# Troubleshooting

While `oap-bootstrap` automates the deployment process, you may encounter environmental issues or require manual intervention during certain phases. This guide covers common edge cases and troubleshooting steps.

## Rauthy 0.35 Session-Gated Provider Screen

In Rauthy version 0.35, the API endpoint for registering upstream authentication providers is session-gated. This means it cannot be called programmatically using an API key.

When the `identity` phase reaches this step, it will gracefully degrade. Instead of silently skipping the configuration, the CLI will pause and print explicit guidance to the terminal. You will be provided with the exact URLs and field values needed to register the GitHub provider manually through the Rauthy web interface. This is an intentional human-in-the-loop step, not a bug. The CLI will automatically probe the API and bypass this manual step when running against Rauthy 0.36 or later.

## Missing `RAUTHY_ADMIN_TOKEN`

The `identity` phase requires an admin API token to configure Rauthy. However, Rauthy 0.35 bootstraps an initial admin user, not an API key.

If the `RAUTHY_ADMIN_TOKEN` is missing from your `oap.env` file, the `identity` phase will halt and print step-by-step instructions. You must log into the Rauthy UI using the generated `RAUTHY_ADMIN_PASSWORD`, create an API key with the necessary permissions, add it to `oap.env`, and then re-run the `identity` phase.

## DNS Propagation Delays

During the `dns` phase, the CLI waits for DNS records to resolve to the cluster's IP address. If you do not provide a Cloudflare API token, you must create these records manually.

If DNS has not propagated, the CLI will poll with a bounded timeout (configurable via `--dns-timeout`). It will display a clear message indicating which hosts are failing to resolve. It will never hang indefinitely. If the phase times out, ensure your DNS records are correct and re-run the phase once propagation is complete.

## Missing Credentials and Scopes

The `doctor` phase is designed to catch missing tools and configuration before any resources are mutated. However, if a token lacks the necessary scopes (e.g., a Hetzner token is read-only, or a GitHub token lacks `admin:org`), a phase may fail mid-provisioning.

Because every phase is idempotent, you can correct the token scopes and safely re-run the failed phase. The CLI will detect the resources that were already created and resume from the point of failure.

## Plaintext Fallback Warning

`oap-bootstrap` uses SOPS and age to encrypt secrets at rest in the `oap.env` file. If these tools are not installed, or if the age key cannot be resolved, the CLI will fall back to storing secrets in plaintext.

When this occurs, the CLI emits a loud warning: `sops/age unavailable: oap.env secrets will be stored in CLEARTEXT`. To resolve this, install `sops` and `age`, and ensure your key is available at `~/.config/sops/age/keys.txt` or via the `SOPS_AGE_KEY_FILE` environment variable.

## Partial Optional Groups

Certain features, such as SMTP configuration, are treated as optional groups. These groups are all-or-nothing. If you provide an `SMTP_URL` but omit the `SMTP_USERNAME` or `SMTP_PASSWORD`, the configuration is considered incomplete, and the `init` phase will fail validation.

Additionally, note that Hetzner Cloud blocks outbound traffic on port 465 (SMTPS) by default. If you configure SMTP, you must use port 587 with STARTTLS. The CLI will refuse configurations using port 465.

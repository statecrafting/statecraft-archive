variable "project_name" { type = string }
variable "location" { type = string }

variable "oidc_m2m_client_id" {
  type      = string
  sensitive = true
  default   = ""
}

variable "oidc_m2m_client_secret" {
  type      = string
  sensitive = true
  default   = ""
}

variable "statecraft_db_url" {
  type      = string
  sensitive = true
  default   = "postgres://user:pass@host:5432/statecraft"
}

variable "deployd_db_url" {
  type      = string
  sensitive = true
  default   = "postgres://user:pass@host:5432/deployd"
}

# store.rs reads HIQLITE_SECRET_RAFT / HIQLITE_SECRET_API directly, with a
# hardcoded dev-fallback when unset; a companion deployd-api-rs change is
# making them required. Operators MUST override these defaults per real
# environment (terraform.tfvars, not committed) -- the defaults below are
# placeholders, same convention as deployd_db_url above.
variable "hiqlite_secret_raft" {
  type      = string
  sensitive = true
  default   = "change-me-hiqlite-raft-secret"
}

variable "hiqlite_secret_api" {
  type      = string
  sensitive = true
  default   = "change-me-hiqlite-api-secret"
}

# Spec 143 FR-010 — per-purpose sweeper M2M client credentials.
# Each Rauthy client carries the matching `platform:<service>:sweep`
# scope in *Default Scopes* (load-bearing per §12 L-006: Rauthy 0.35
# `client_credentials` mints Default Scopes regardless of `scope=`).
# All three pairs are provisioned in Key Vault; the FU-001 beat 4
# commit only wires the knowledge pair into a CronJob — factory and
# audit are staged for FU-003 to inherit without re-deriving the
# discipline.

variable "statecraft_knowledge_sweeper_client_id" {
  type      = string
  sensitive = true
  default   = ""
}

variable "statecraft_knowledge_sweeper_client_secret" {
  type      = string
  sensitive = true
  default   = ""
}

variable "statecraft_factory_sweeper_client_id" {
  type      = string
  sensitive = true
  default   = ""
}

variable "statecraft_factory_sweeper_client_secret" {
  type      = string
  sensitive = true
  default   = ""
}

variable "statecraft_audit_sweeper_client_id" {
  type      = string
  sensitive = true
  default   = ""
}

variable "statecraft_audit_sweeper_client_secret" {
  type      = string
  sensitive = true
  default   = ""
}

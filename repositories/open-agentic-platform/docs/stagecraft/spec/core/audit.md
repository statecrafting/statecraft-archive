# Audit Log

## Overview

Admin actions are recorded in an audit log for compliance and debugging.

## Schema

| Column        | Type   | Description                          |
|---------------|--------|--------------------------------------|
| id            | uuid   | Primary key                          |
| actor_user_id | uuid   | User who performed the action         |
| action        | text   | Action identifier (e.g. `user.set_role`) |
| target_type   | text   | Type of target (e.g. `user`)         |
| target_id     | text   | ID of target entity                  |
| metadata      | jsonb  | Additional context (e.g. `{ role: "admin" }`) |
| created_at    | timestamp | When the action occurred          |

## Recorded Actions

- `user.set_role` - When admin changes a user's role (target_type: user, target_id: userId, metadata: { role })

## Usage

- **Write**: Admin service inserts into `audit_log` when performing auditable actions
- **Read**: `GET /admin/audit` returns recent events (e.g. last 200), ordered by created_at DESC

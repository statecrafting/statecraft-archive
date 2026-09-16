# Role-Based Access Control

## Overview

Two roles: `user` and `admin`. Stored on the `users` table. Session kind (`user` | `admin`) determines which cookie and which routes apply.

## Roles

| Role   | Description                    | Session Kind | Cookie            |
|--------|--------------------------------|--------------|-------------------|
| `user` | Standard signed-in user         | `user`       | `__session`       |
| `admin`| Can access admin panel         | `admin`      | `__admin_session`  |

## Enforcement

- **User app** (`/app/*`): Layout loader calls `requireUser(request)` - validates `__session` via `/auth/session`
- **Admin app** (`/admin/*`): Layout loader calls `requireAdmin(request)` - validates `__admin_session` via `/admin/auth/session` and checks `role === "admin"`

## Session Kind

Sessions have a `kind` enum: `user` | `admin`. Admin signin creates an `admin`-kind session; user signin creates a `user`-kind session. This allows the same user to have both a user session and an admin session (different cookies, different paths).

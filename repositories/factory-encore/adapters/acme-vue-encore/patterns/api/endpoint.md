# Pattern: endpoint

One Build Spec operation becomes one Encore endpoint. Use `api()` for typed
JSON; use `api.raw()` only when the handler must set cookies or headers directly
(for example auth callbacks).

## Conventions

- `expose: true` for endpoints the SPA calls; `auth: true` when the operation
  requires authentication.
- The path and method come from the operation; payloads are bare typed objects,
  no success/data envelope.
- The handler delegates to the service layer; it does not embed SQL.

## Example

`apps/api/registration/registration.ts`:

```ts
import { api } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import { requireRole } from "../lib/roles";
import * as service from "./service";
import type { CreateRegistrationRequest, Registration } from "./types";

export const createRegistration = api(
  { method: "POST", path: "/api/v1/registrations", expose: true, auth: true },
  async (req: CreateRegistrationRequest): Promise<Registration> => {
    const auth = getAuthData()!;
    requireRole(auth, ["attendee"]);
    return service.create(auth.userID, req.eventId);
  },
);

export const listMyRegistrations = api(
  { method: "GET", path: "/api/v1/registrations/mine", expose: true, auth: true },
  async (): Promise<{ items: Registration[] }> => {
    const auth = getAuthData()!;
    return { items: await service.listForAttendee(auth.userID) };
  },
);
```

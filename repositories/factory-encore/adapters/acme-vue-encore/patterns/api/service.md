# Pattern: service

The service layer holds the business logic for a resource. It calls the model
layer (tagged-template SQL) and enforces the operation's business rules. It does
not handle HTTP; endpoints call it.

## Conventions

- One service module per resource at `apps/api/{resource}/service.ts`.
- Enforce each business rule at the point the Build Spec names. Throw Encore
  `APIError` for rule violations so the error envelope is consistent.
- Keep functions small and typed; no `any`.

## Example

`apps/api/registration/service.ts`:

```ts
import { APIError } from "encore.dev/api";
import * as model from "./model";
import type { Registration } from "./types";

// BR-002 capacity, BR-003 uniqueness enforced here.
export async function create(attendeeId: string, eventId: string): Promise<Registration> {
  const existing = await model.findActive(eventId, attendeeId);
  if (existing) {
    throw APIError.alreadyExists("You already have a registration for this event.");
  }
  const confirmed = await model.countConfirmed(eventId);
  const capacity = await model.eventCapacity(eventId);
  const status = confirmed < capacity ? "submitted" : "waitlisted";
  return model.insert({ eventId, attendeeId, status });
}

export async function listForAttendee(attendeeId: string): Promise<Registration[]> {
  return model.listByAttendee(attendeeId);
}
```

# Pattern: types

Each resource declares its request and response types as plain TypeScript
interfaces. Payloads are bare (the object is the body), with no wrapping
envelope. Encore validates the request and response shapes from these typed
api() signatures, so the interface is the contract.

## Conventions

- One `types.ts` per resource at `apps/api/{resource}/types.ts`.
- Request types name only the fields the operation accepts; response types name
  only the fields it returns.
- Define the entity interface here (or in a shared module under packages/shared
  when both the SPA and the API consume it) and reuse it for full-record
  responses.

## Example

`apps/api/registration/types.ts`:

```ts
export interface Registration {
  id: string;
  eventId: string;
  attendeeId: string;
  status: "draft" | "submitted" | "confirmed" | "waitlisted" | "cancelled";
  submittedAt: string | null;
  createdAt: string;
}

export interface CreateRegistrationRequest {
  eventId: string;
}

export interface RegistrationDecisionRequest {
  id: string;
  decision: "confirmed" | "waitlisted";
}
```

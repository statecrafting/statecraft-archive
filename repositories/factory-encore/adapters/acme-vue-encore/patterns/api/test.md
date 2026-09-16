# Pattern: api test

Each backend feature ships a test next to it. Use Vitest. Test the service logic
and the business rules the operation enforces; use the mock auth driver so tests
do not depend on a live identity provider.

## Conventions

- One test file per resource at `apps/api/{resource}/{resource}.test.ts`.
- Cover the happy path and at least one business-rule branch (for example the
  capacity-to-waitlist transition, or the uniqueness rejection).
- Arrange data through the model or fixtures; assert on returned values and
  thrown `APIError` codes.

## Example

`apps/api/registration/registration.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import * as service from "./service";

describe("registration.create", () => {
  beforeEach(async () => {
    /* reset the test database to a known seed */
  });

  it("waitlists when the event is at capacity", async () => {
    const reg = await service.create("attendee-1", "full-event");
    expect(reg.status).toBe("waitlisted");
  });

  it("rejects a duplicate registration", async () => {
    await service.create("attendee-1", "open-event");
    await expect(service.create("attendee-1", "open-event")).rejects.toThrow();
  });
});
```

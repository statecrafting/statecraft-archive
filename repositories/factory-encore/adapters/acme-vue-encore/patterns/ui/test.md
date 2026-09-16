# Pattern: ui test

Each page ships a component test. Use Vitest with Vue Test Utils and a stubbed
store, so the test exercises the view's rendering and behavior without a live
backend.

## Conventions

- One test per view at `apps/{stack}/src/views/{PageName}View.test.ts`.
- Provide a fresh Pinia instance (`createTestingPinia`) and assert that the view
  renders the loading, error, and content states.
- Assert that user actions call the expected store action.

## Example

`apps/web/src/views/EventsView.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createTestingPinia } from "@pinia/testing";
import EventsView from "./EventsView.vue";
import { useEventsStore } from "@/stores/events.store";

describe("EventsView", () => {
  it("renders rows from the store", () => {
    const wrapper = mount(EventsView, {
      global: { plugins: [createTestingPinia({ stubActions: true })] },
    });
    const store = useEventsStore();
    store.items = [{ id: "1", name: "Demo", startsAt: "2026-07-01T09:00:00Z" } as never];
    store.loading = false;
    expect(wrapper.text()).toContain("Demo");
  });
});
```

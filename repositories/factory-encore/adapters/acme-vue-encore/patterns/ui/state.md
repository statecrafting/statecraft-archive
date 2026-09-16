# Pattern: state

State lives in Pinia setup-stores, one per resource. Stores own data fetching,
loading and error state, and mutations. Components read from the store and call
its actions; they never call the API client directly.

## Conventions

- One store per resource at `apps/{stack}/src/stores/{resource}.store.ts`.
- Use the typed API client; send bare payloads.
- On mutations (POST/PUT/PATCH/DELETE) attach the CSRF token: fetch it once from
  `GET /api/v1/auth/csrf-token`, then replay it as the `X-CSRF-Token` header. An
  axios interceptor in the auth store does this for every mutating request.
- Track `loading` and `error` so views can render those states.

## Example

`apps/web/src/stores/events.store.ts`:

```ts
import { defineStore } from "pinia";
import { ref } from "vue";
import { api } from "@/lib/api-client";
import type { Event } from "@app/shared/schemas/event.schema";

export const useEventsStore = defineStore("events", () => {
  const items = ref<Event[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetch(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const res = await api.get<{ items: Event[] }>("/events");
      items.value = res.items;
    } catch (e) {
      error.value = e instanceof Error ? e.message : "Failed to load events";
    } finally {
      loading.value = false;
    }
  }

  return { items, loading, error, fetch };
});
```

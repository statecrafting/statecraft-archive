# Pattern: view

One Build Spec page becomes one `{PageName}View.vue` using the Composition API
(`<script setup>`) and PrimeVue components. The view reads and writes through a
Pinia store; it does not call the API client directly.

## Conventions

- Use PrimeVue components for all UI (no hand-rolled styled controls).
- Always render three states: loading (a spinner or skeleton), error (a PrimeVue
  `Message`), and content.
- Bind data from the store; trigger loads in `onMounted`.

## Example

`apps/web/src/views/EventsView.vue`:

```vue
<script setup lang="ts">
import { onMounted } from "vue";
import DataTable from "primevue/datatable";
import Column from "primevue/column";
import Message from "primevue/message";
import ProgressSpinner from "primevue/progressspinner";
import { useEventsStore } from "@/stores/events.store";

const store = useEventsStore();
onMounted(() => store.fetch());
</script>

<template>
  <ProgressSpinner v-if="store.loading" />
  <Message v-else-if="store.error" severity="error">{{ store.error }}</Message>
  <DataTable v-else :value="store.items" dataKey="id">
    <Column field="name" header="Event" />
    <Column field="startsAt" header="Starts" />
  </DataTable>
</template>
```

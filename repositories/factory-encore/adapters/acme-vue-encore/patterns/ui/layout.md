# Pattern: layout

The app shell (header, navigation, content slot, footer) is a small set of layout
components that wrap every routed view. Navigation entries come from the Build
Spec `ui.navigation`, filtered by the current user's roles.

## Conventions

- `AppLayout.vue` holds the shell and a `<router-view />`; `AppHeader.vue` renders
  navigation with a PrimeVue `Menubar`; `AppFooter.vue` renders site chrome.
- Navigation items are gated by role in the UI for convenience only; the server
  still authorizes every request.
- The header surfaces sign-in/sign-out via the auth store.

## Example

`apps/web/src/components/layout/AppHeader.vue`:

```vue
<script setup lang="ts">
import Menubar from "primevue/menubar";
import Button from "primevue/button";
import { computed } from "vue";
import { useAuthStore } from "@/stores/auth.store";

const auth = useAuthStore();
const items = computed(() => [
  { label: "Events", route: "/events" },
  ...(auth.hasRole("attendee") ? [{ label: "My Registrations", route: "/my/registrations" }] : []),
]);
</script>

<template>
  <Menubar :model="items">
    <template #end>
      <Button v-if="auth.authenticated" label="Sign out" text @click="auth.logout()" />
      <Button v-else label="Sign in" text @click="auth.login()" />
    </template>
  </Menubar>
</template>
```

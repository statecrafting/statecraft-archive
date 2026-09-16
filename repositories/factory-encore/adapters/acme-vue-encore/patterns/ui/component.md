# Pattern: component

Reusable components compose PrimeVue primitives into app-specific pieces. Build a
component only when markup repeats across views; otherwise use PrimeVue
components directly in the view.

## Conventions

- One component per file at `apps/{stack}/src/components/{Name}.vue`, PascalCase.
- Typed props and emits via `defineProps`/`defineEmits`. No `any`.
- Styling comes from PrimeVue design tokens; avoid bespoke CSS where a token or
  component prop exists.

## Example

`apps/web/src/components/StatusBadge.vue`:

```vue
<script setup lang="ts">
import Tag from "primevue/tag";

const props = defineProps<{ status: string }>();

const severity: Record<string, string> = {
  draft: "secondary",
  submitted: "info",
  confirmed: "success",
  waitlisted: "warn",
  cancelled: "danger",
};
</script>

<template>
  <Tag :value="props.status" :severity="severity[props.status] ?? 'secondary'" />
</template>
```

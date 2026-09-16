<template>
  <footer class="app-footer">
    <div class="app-footer__inner">
      <span>{{ serviceName }}</span>
      <span class="app-footer__meta">Built with Vue 3, PrimeVue, and Encore.ts</span>
    </div>
  </footer>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ serviceName?: string }>(), {
  serviceName: 'Application Template',
})
</script>

<style scoped>
.app-footer {
  flex-shrink: 0;
  background: var(--app-surface);
  border-top: 1px solid var(--app-border);
}

.app-footer__inner {
  max-width: var(--app-max-width);
  margin: 0 auto;
  padding: 1.25rem 1rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: space-between;
  align-items: center;
  color: var(--app-text-muted);
  font-size: 0.875rem;
}
</style>

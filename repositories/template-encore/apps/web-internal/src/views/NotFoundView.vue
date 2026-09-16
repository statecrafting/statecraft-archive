<template>
  <section class="not-found">
    <p class="not-found__code">404</p>
    <h1>Page not found</h1>
    <p class="not-found__lead">The page you are looking for does not exist or has moved.</p>
    <Button
      label="Back to dashboard"
      icon="pi pi-home"
      @click="goHome"
    />
  </section>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import Button from 'primevue/button'

const router = useRouter()

function goHome() {
  void router.push('/')
}
</script>

<style scoped>
.not-found {
  text-align: center;
  padding: 4rem 1rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
}

.not-found__code {
  margin: 0;
  font-size: 4rem;
  font-weight: 800;
  color: var(--p-primary-500);
  line-height: 1;
}

.not-found h1 {
  margin: 0;
}

.not-found__lead {
  margin: 0;
  color: var(--app-text-muted);
}
</style>

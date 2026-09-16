<template>
  <section class="about">
    <h1>About this template</h1>
    <Card>
      <template #content>
        <p>
          This is the public-facing SPA of the Vue + Encore enterprise template. It pairs a
          Vue 3 single-page app (Composition API, Pinia, Vue Router, PrimeVue) with a
          standalone Encore.ts backend.
        </p>
        <p>
          Authentication is stateless RS256 JWT with a database-backed refresh-token rotation,
          delivered over httpOnly cookies with CSRF double-submit protection. Two SSO drivers
          (mock and rauthy OIDC) coexist behind a uniform login surface.
        </p>
        <p>
          The backend exposes a backend-for-frontend gateway: the browser never reaches the
          private backend directly. Every architectural decision is captured as a markdown spec
          and reconciled against the implementing code.
        </p>
      </template>
    </Card>
  </section>
</template>

<script setup lang="ts">
import Card from 'primevue/card'
</script>

<style scoped>
.about {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.about h1 {
  margin: 0;
}

.about :deep(p) {
  margin: 0 0 1rem;
  max-width: 70ch;
  color: var(--app-text);
}

.about :deep(p:last-child) {
  margin-bottom: 0;
}
</style>

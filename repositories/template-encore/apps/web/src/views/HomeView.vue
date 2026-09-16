<template>
  <section class="home">
    <div class="home__hero">
      <Tag
        value="Spec-governed template"
        severity="secondary"
        rounded
      />
      <h1 class="home__title">Vue + Encore enterprise template</h1>
      <p class="home__lead">
        A production-shaped starting point: an Encore.ts backend with multi-driver SSO,
        stateless JWT auth, and a BFF gateway, paired with a Vue 3 + PrimeVue SPA.
      </p>
      <div class="home__cta">
        <Button
          v-if="!isAuthenticated"
          label="Sign in"
          icon="pi pi-sign-in"
          @click="go('/login')"
        />
        <Button
          v-else
          label="View profile"
          icon="pi pi-user"
          @click="go('/profile')"
        />
        <Button
          label="Learn more"
          icon="pi pi-arrow-right"
          icon-pos="right"
          severity="secondary"
          outlined
          @click="go('/about')"
        />
      </div>
    </div>

    <div class="home__features">
      <Card
        v-for="feature in features"
        :key="feature.title"
      >
        <template #header>
          <i
            :class="feature.icon"
            class="home__feature-icon"
            aria-hidden="true"
          />
        </template>
        <template #title>{{ feature.title }}</template>
        <template #content>
          <p>{{ feature.body }}</p>
        </template>
      </Card>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import Card from 'primevue/card'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import { useAuthStore } from '@/stores/auth.store'

const router = useRouter()
const authStore = useAuthStore()
const isAuthenticated = computed(() => authStore.isAuthenticated)

const features = [
  {
    icon: 'pi pi-shield',
    title: 'Multi-driver auth',
    body: 'Mock and rauthy OIDC SSO behind one uniform login surface, with RS256 JWT and refresh rotation.',
  },
  {
    icon: 'pi pi-server',
    title: 'BFF gateway',
    body: 'The SPA never talks to the private backend directly; a server-to-server OAuth proxy injects credentials and masks errors.',
  },
  {
    icon: 'pi pi-check-circle',
    title: 'Spec-governed',
    body: 'Every change is bound to a markdown spec and mechanically reconciled against the code that implements it.',
  },
]

function go(path: string) {
  void router.push(path)
}
</script>

<style scoped>
.home {
  display: flex;
  flex-direction: column;
  gap: 2.5rem;
}

.home__hero {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1rem;
  padding: 2rem 0 1rem;
}

.home__title {
  margin: 0;
  font-size: clamp(1.9rem, 4vw, 2.75rem);
}

.home__lead {
  margin: 0;
  max-width: 60ch;
  font-size: 1.125rem;
  color: var(--app-text-muted);
}

.home__cta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 0.5rem;
}

.home__features {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 1.25rem;
}

.home__feature-icon {
  display: block;
  padding: 1.25rem 1.25rem 0;
  font-size: 1.75rem;
  color: var(--p-primary-600);
}
</style>

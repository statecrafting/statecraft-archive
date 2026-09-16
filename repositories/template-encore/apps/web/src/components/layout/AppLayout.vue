<template>
  <div class="app-layout">
    <a
      href="#main-content"
      class="skip-link"
    >Skip to main content</a>

    <AppHeader
      :service-name="serviceName"
      :user="user"
      :navigation-items="navigationItems"
    />

    <main
      id="main-content"
      class="app-main"
    >
      <div class="page">
        <slot />
      </div>
    </main>

    <AppFooter :service-name="serviceName" />
  </div>
</template>

<script setup lang="ts">
import AppHeader from './AppHeader.vue'
import AppFooter from './AppFooter.vue'

interface NavigationItem {
  path: string
  label: string
}

interface User {
  name: string
  email?: string
}

withDefaults(
  defineProps<{
    serviceName?: string
    user?: User | null
    navigationItems?: NavigationItem[]
  }>(),
  {
    serviceName: 'Application Template',
    user: null,
    navigationItems: () => [],
  },
)
</script>

<style scoped>
.app-layout {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.app-main {
  flex: 1 0 auto;
}

.page {
  max-width: var(--app-max-width);
  margin: 0 auto;
  padding: 2rem 1rem 3rem;
}
</style>

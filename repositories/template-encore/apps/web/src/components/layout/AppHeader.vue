<template>
  <header class="app-header">
    <div class="app-header__inner">
      <RouterLink
        to="/"
        class="app-header__brand"
      >
        <span
          class="app-header__logo"
          aria-hidden="true"
        >VE</span>
        <span class="app-header__title">{{ serviceName }}</span>
      </RouterLink>

      <nav
        class="app-header__nav"
        aria-label="Primary"
      >
        <RouterLink
          v-for="item in navigationItems"
          :key="item.path"
          :to="item.path"
          class="app-header__link"
        >{{ item.label }}</RouterLink>
      </nav>

      <div class="app-header__actions">
        <template v-if="user">
          <Button
            type="button"
            severity="secondary"
            text
            class="app-header__user"
            aria-haspopup="true"
            aria-controls="user-menu"
            @click="toggleMenu"
          >
            <Avatar
              :label="initials"
              shape="circle"
              size="normal"
            />
            <span class="app-header__username">{{ user.name }}</span>
            <i
              class="pi pi-angle-down"
              aria-hidden="true"
            />
          </Button>
          <Menu
            id="user-menu"
            ref="menu"
            :model="userMenuItems"
            :popup="true"
          />
        </template>
        <Button
          v-else
          label="Sign in"
          icon="pi pi-sign-in"
          @click="goTo('/login')"
        />
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import Button from 'primevue/button'
import Menu from 'primevue/menu'
import Avatar from 'primevue/avatar'
import type { MenuItem } from 'primevue/menuitem'
import { useAuthStore } from '@/stores/auth.store'

interface User {
  name: string
  email?: string
}

interface NavigationItem {
  path: string
  label: string
}

const props = withDefaults(
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

const router = useRouter()
const authStore = useAuthStore()
const menu = ref()

const initials = computed(() =>
  (props.user?.name ?? '?')
    .split(' ')
    .map((part) => part.charAt(0))
    .slice(0, 2)
    .join('')
    .toUpperCase(),
)

const userMenuItems = computed<MenuItem[]>(() => [
  { label: 'Profile', icon: 'pi pi-user', command: () => goTo('/profile') },
  { separator: true },
  { label: 'Sign out', icon: 'pi pi-sign-out', command: () => void handleLogout() },
])

function toggleMenu(event: Event) {
  menu.value?.toggle(event)
}

function goTo(path: string) {
  void router.push(path)
}

async function handleLogout() {
  try {
    await authStore.logout()
    void router.push('/')
  } catch {
    void router.push('/')
  }
}
</script>

<style scoped>
.app-header {
  position: sticky;
  top: 0;
  z-index: 100;
  background: var(--app-surface);
  border-bottom: 1px solid var(--app-border);
}

.app-header__inner {
  max-width: var(--app-max-width);
  margin: 0 auto;
  height: var(--app-header-height);
  padding: 0 1rem;
  display: flex;
  align-items: center;
  gap: 1.5rem;
}

.app-header__brand {
  display: inline-flex;
  align-items: center;
  gap: 0.625rem;
  text-decoration: none;
  color: var(--app-text);
  font-weight: 700;
}

.app-header__logo {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--p-primary-600);
  color: #ffffff;
  font-size: 0.8rem;
  font-weight: 700;
}

.app-header__nav {
  display: flex;
  gap: 0.25rem;
  margin-right: auto;
}

.app-header__link {
  padding: 0.4rem 0.75rem;
  border-radius: 8px;
  text-decoration: none;
  color: var(--app-text-muted);
  font-weight: 550;
}

.app-header__link:hover {
  background: var(--p-primary-50);
  color: var(--p-primary-700);
}

.app-header__link.router-link-exact-active {
  color: var(--p-primary-700);
  background: var(--p-primary-50);
}

.app-header__actions {
  display: flex;
  align-items: center;
}

.app-header__user {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.app-header__username {
  font-weight: 600;
}

@media (max-width: 640px) {
  .app-header__username,
  .app-header__nav {
    display: none;
  }
}
</style>

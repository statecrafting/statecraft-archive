<template>
  <div class="app-layout">
    <a
      href="#main-content"
      class="skip-link"
    >Skip to main content</a>

    <aside
      class="sidebar"
      aria-label="Primary"
    >
      <RouterLink
        to="/"
        class="sidebar__brand"
      >
        <span
          class="sidebar__logo"
          aria-hidden="true"
        >VE</span>
        <span class="sidebar__title">{{ serviceName }}</span>
      </RouterLink>

      <nav class="sidebar__nav">
        <RouterLink
          v-for="item in primaryItems"
          :key="item.id"
          :to="item.to"
          class="sidebar__link"
        >
          <i
            :class="iconClass(item.icon)"
            aria-hidden="true"
          />
          <span>{{ resolveLabel(item.label) }}</span>
        </RouterLink>

        <RouterLink
          v-for="item in secondaryItems"
          :key="item.id"
          :to="item.to"
          class="sidebar__link"
        >
          <i
            :class="iconClass(item.icon)"
            aria-hidden="true"
          />
          <span>{{ resolveLabel(item.label) }}</span>
          <Badge
            v-if="resolveBadge(item.badge) !== undefined"
            :value="resolveBadge(item.badge)"
          />
        </RouterLink>
      </nav>

      <div class="sidebar__account">
        <div
          v-if="user"
          class="sidebar__user"
        >
          <Avatar
            :label="initials"
            shape="circle"
            size="normal"
          />
          <div class="sidebar__user-info">
            <span class="sidebar__user-name">{{ user.name }}</span>
            <span
              v-if="user.email"
              class="sidebar__user-email"
            >{{ user.email }}</span>
          </div>
        </div>

        <RouterLink
          v-for="item in accountItems"
          :key="item.id"
          :to="item.to"
          class="sidebar__link"
        >
          <i
            :class="iconClass(item.icon)"
            aria-hidden="true"
          />
          <span>{{ resolveLabel(item.label) }}</span>
        </RouterLink>

        <button
          type="button"
          class="sidebar__link sidebar__signout"
          @click="handleLogout"
        >
          <i
            class="pi pi-sign-out"
            aria-hidden="true"
          />
          <span>Sign out</span>
        </button>
      </div>
    </aside>

    <main
      id="main-content"
      class="content"
    >
      <div class="content__inner">
        <slot />
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import Avatar from 'primevue/avatar'
import Badge from 'primevue/badge'
import { useAuthStore } from '@/stores/auth.store'
import { resolveLabel, resolveBadge, type SidebarNavItem } from '@/composables/useNavigation'

interface User {
  name: string
  email?: string
}

const props = withDefaults(
  defineProps<{
    serviceName?: string
    user?: User | null
    primaryItems?: SidebarNavItem[]
    secondaryItems?: SidebarNavItem[]
    accountItems?: SidebarNavItem[]
  }>(),
  {
    serviceName: 'Internal Portal',
    user: null,
    primaryItems: () => [],
    secondaryItems: () => [],
    accountItems: () => [],
  },
)

const router = useRouter()
const authStore = useAuthStore()

// Map the framework-neutral icon names used by the module loader to primeicons.
const ICONS: Record<string, string> = {
  home: 'pi pi-home',
  person: 'pi pi-user',
  users: 'pi pi-users',
  settings: 'pi pi-cog',
  inbox: 'pi pi-inbox',
  chart: 'pi pi-chart-line',
}

function iconClass(icon?: string): string {
  if (!icon) return 'pi pi-circle'
  return ICONS[icon] ?? 'pi pi-circle'
}

const initials = computed(() =>
  (props.user?.name ?? '?')
    .split(' ')
    .map((part) => part.charAt(0))
    .slice(0, 2)
    .join('')
    .toUpperCase(),
)

async function handleLogout() {
  try {
    await authStore.logout()
    void router.push('/login')
  } catch {
    void router.push('/login')
  }
}
</script>

<style scoped>
.app-layout {
  min-height: 100vh;
  display: flex;
}

.sidebar {
  width: var(--app-sidebar-width);
  flex-shrink: 0;
  background: var(--app-surface);
  border-right: 1px solid var(--app-border);
  display: flex;
  flex-direction: column;
  padding: 1rem 0.75rem;
  gap: 0.5rem;
  position: sticky;
  top: 0;
  height: 100vh;
}

.sidebar__brand {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.5rem;
  text-decoration: none;
  color: var(--app-text);
  font-weight: 700;
}

.sidebar__logo {
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

.sidebar__nav {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  margin-top: 0.5rem;
}

.sidebar__link {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.55rem 0.625rem;
  border-radius: 8px;
  text-decoration: none;
  color: var(--app-text-muted);
  font: inherit;
  font-weight: 550;
  background: none;
  border: none;
  width: 100%;
  cursor: pointer;
  text-align: left;
}

.sidebar__link:hover {
  background: var(--p-primary-50);
  color: var(--p-primary-700);
}

.sidebar__link.router-link-exact-active {
  background: var(--p-primary-50);
  color: var(--p-primary-700);
}

.sidebar__account {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  border-top: 1px solid var(--app-border);
  padding-top: 0.75rem;
}

.sidebar__user {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.5rem;
}

.sidebar__user-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.sidebar__user-name {
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--app-text);
}

.sidebar__user-email {
  font-size: 0.75rem;
  color: var(--app-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar__signout:hover {
  background: var(--p-red-50, #fef2f2);
  color: var(--p-red-600, #dc2626);
}

.content {
  flex: 1;
  min-width: 0;
}

.content__inner {
  max-width: 1080px;
  margin: 0 auto;
  padding: 2rem 1.5rem 3rem;
}

@media (max-width: 720px) {
  .app-layout {
    flex-direction: column;
  }

  .sidebar {
    width: 100%;
    height: auto;
    position: static;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
  }

  .sidebar__account {
    margin-top: 0;
    border-top: none;
    padding-top: 0;
    flex-direction: row;
    margin-left: auto;
  }

  .sidebar__user {
    display: none;
  }
}
</style>

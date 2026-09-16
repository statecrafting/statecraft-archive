<template>
  <section class="dashboard">
    <header class="dashboard__head">
      <h1>Dashboard</h1>
      <p
        v-if="user"
        class="dashboard__welcome"
      >Welcome back, {{ user.name }}.</p>
    </header>

    <div class="dashboard__grid">
      <Card
        v-for="stat in stats"
        :key="stat.label"
      >
        <template #content>
          <div class="stat">
            <i
              :class="stat.icon"
              class="stat__icon"
              aria-hidden="true"
            />
            <div>
              <p class="stat__value">{{ stat.value }}</p>
              <p class="stat__label">{{ stat.label }}</p>
            </div>
          </div>
        </template>
      </Card>
    </div>

    <Card>
      <template #title>Your access</template>
      <template #content>
        <p class="dashboard__note">
          This portal is role-scoped. The roles below come from your authenticated session.
        </p>
        <div class="dashboard__roles">
          <Tag
            v-for="role in roles"
            :key="role"
            :value="role"
          />
          <span
            v-if="roles.length === 0"
            class="dashboard__empty"
          >No roles assigned.</span>
        </div>
      </template>
    </Card>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Card from 'primevue/card'
import Tag from 'primevue/tag'
import { useAuthStore } from '@/stores/auth.store'

const authStore = useAuthStore()
const user = computed(() => authStore.user)
const roles = computed(() => user.value?.roles ?? [])

// Placeholder metrics: this template ships no domain data services to query.
const stats = [
  { icon: 'pi pi-users', value: '0', label: 'Active users' },
  { icon: 'pi pi-inbox', value: '0', label: 'Open items' },
  { icon: 'pi pi-chart-line', value: '0', label: 'This week' },
]
</script>

<style scoped>
.dashboard {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.dashboard__head h1 {
  margin: 0;
}

.dashboard__welcome {
  margin: 0.25rem 0 0;
  color: var(--app-text-muted);
}

.dashboard__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1.25rem;
}

.stat {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.stat__icon {
  font-size: 1.5rem;
  color: var(--p-primary-600);
  background: var(--p-primary-50);
  padding: 0.75rem;
  border-radius: 10px;
}

.stat__value {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 700;
}

.stat__label {
  margin: 0;
  color: var(--app-text-muted);
  font-size: 0.875rem;
}

.dashboard__note {
  margin: 0 0 1rem;
  color: var(--app-text-muted);
}

.dashboard__roles {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.dashboard__empty {
  color: var(--app-text-muted);
}
</style>

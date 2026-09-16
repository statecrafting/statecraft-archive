<template>
  <section class="profile">
    <Card v-if="user">
      <template #title>My profile</template>
      <template #content>
        <div class="profile__head">
          <Avatar
            :label="initials"
            size="xlarge"
            shape="circle"
          />
          <div>
            <h2 class="profile__name">{{ user.name }}</h2>
            <p class="profile__email">{{ user.email }}</p>
          </div>
        </div>

        <dl class="profile__grid">
          <div class="profile__row">
            <dt>User ID</dt>
            <dd>{{ user.id }}</dd>
          </div>
          <div class="profile__row">
            <dt>Roles</dt>
            <dd class="profile__roles">
              <Tag
                v-for="role in user.roles"
                :key="role"
                :value="role"
              />
            </dd>
          </div>
        </dl>

        <Button
          label="Sign out"
          icon="pi pi-sign-out"
          severity="secondary"
          @click="onLogout"
        />
      </template>
    </Card>

    <div
      v-else
      class="profile__loading"
    >
      <ProgressSpinner style="width: 2.5rem; height: 2.5rem" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import Card from 'primevue/card'
import Avatar from 'primevue/avatar'
import Tag from 'primevue/tag'
import Button from 'primevue/button'
import ProgressSpinner from 'primevue/progressspinner'
import { useAuthStore } from '@/stores/auth.store'

const authStore = useAuthStore()
const router = useRouter()
const user = computed(() => authStore.user)

const initials = computed(() =>
  (user.value?.name ?? '?')
    .split(' ')
    .map((part) => part.charAt(0))
    .slice(0, 2)
    .join('')
    .toUpperCase(),
)

async function onLogout() {
  try {
    await authStore.logout()
  } finally {
    void router.push('/')
  }
}
</script>

<style scoped>
.profile__head {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.profile__name {
  margin: 0;
}

.profile__email {
  margin: 0.25rem 0 0;
  color: var(--app-text-muted);
}

.profile__grid {
  margin: 0 0 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.profile__row {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.profile__row dt {
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--app-text-muted);
}

.profile__row dd {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.profile__roles {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  font-family: inherit;
}

.profile__loading {
  display: flex;
  justify-content: center;
  padding: 3rem 0;
}
</style>

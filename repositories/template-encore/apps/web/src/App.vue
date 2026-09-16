<template>
  <AppLayout
    service-name="Enterprise Template"
    :user="user"
    :navigation-items="navigationItems"
  >
    <Message
      v-if="showSessionExpired"
      severity="warn"
      :closable="false"
      class="session-banner"
    >
      <div class="session-banner__body">
        <span>Your session has expired. Please sign in again to continue.</span>
        <div class="session-banner__actions">
          <Button
            label="Sign in"
            size="small"
            @click="goToSignIn"
          />
          <Button
            label="Dismiss"
            size="small"
            severity="secondary"
            text
            @click="dismissSessionExpired"
          />
        </div>
      </div>
    </Message>
    <RouterView />
  </AppLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import Message from 'primevue/message'
import Button from 'primevue/button'
import { useAuthStore } from './stores/auth.store'
import { useNavigation, resolveLabel } from './composables/useNavigation'
import AppLayout from './components/layout/AppLayout.vue'

/**
 * Root application component: layout shell, dynamic navigation (driven by the
 * installed modules via useNavigation), and the session-expiry notice.
 */
const authStore = useAuthStore()
const router = useRouter()
const { leftItems } = useNavigation()

const user = computed(() => authStore.user)

const navigationItems = computed(() =>
  leftItems.value.map((item) => ({ path: item.to, label: resolveLabel(item.label) })),
)

const showSessionExpired = ref(false)

watch(
  () => authStore.sessionExpired,
  (expired) => {
    if (expired) showSessionExpired.value = true
  },
)

function dismissSessionExpired() {
  showSessionExpired.value = false
  authStore.sessionExpired = false
}

function goToSignIn() {
  showSessionExpired.value = false
  authStore.sessionExpired = false
  void router.push('/login')
}

onMounted(async () => {
  await authStore.fetchUser()
})
</script>

<style scoped>
.session-banner {
  margin: 1rem auto 0;
  max-width: var(--app-max-width);
  width: calc(100% - 2rem);
}

.session-banner__body {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.session-banner__actions {
  display: flex;
  gap: 0.5rem;
}
</style>

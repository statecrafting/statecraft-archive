<template>
  <section class="login">
    <Card class="login__card">
      <template #title>Sign in</template>
      <template #subtitle>Choose an authentication method</template>
      <template #content>
        <div
          v-if="loading"
          class="login__loading"
        >
          <ProgressSpinner
            style="width: 2.5rem; height: 2.5rem"
            stroke-width="4"
          />
        </div>

        <div
          v-else
          class="login__methods"
        >
          <div
            v-if="drivers.includes('mock')"
            class="login__group"
          >
            <h3 class="login__group-title">Mock users (development)</h3>
            <div class="login__mock">
              <Button
                v-for="mockUser in mockUsers"
                :key="mockUser.index"
                :label="mockUser.label"
                icon="pi pi-user"
                severity="secondary"
                outlined
                @click="signIn('mock', mockUser.index)"
              />
            </div>
          </div>

          <Button
            v-if="drivers.includes('rauthy')"
            label="Sign in with SSO"
            icon="pi pi-sign-in"
            @click="signIn('rauthy')"
          />

          <Message
            v-if="drivers.length === 0"
            severity="info"
            :closable="false"
          >
            No authentication drivers are configured.
          </Message>
        </div>
      </template>
    </Card>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import Card from 'primevue/card'
import Button from 'primevue/button'
import Message from 'primevue/message'
import ProgressSpinner from 'primevue/progressspinner'
import { useAuthStore } from '@/stores/auth.store'

const authStore = useAuthStore()
const drivers = ref<string[]>([])
const loading = ref(true)

const mockUsers = [
  { index: 0, label: 'Casey User (user)' },
  { index: 1, label: 'Avery Admin (admin)' },
  { index: 2, label: 'Devon Developer (developer)' },
]

function signIn(driver: string, userIndex?: number) {
  authStore.login(driver, userIndex !== undefined ? { userIndex } : undefined)
}

onMounted(async () => {
  try {
    const status = await authStore.checkStatus()
    drivers.value = status.drivers ?? []
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.login {
  display: flex;
  justify-content: center;
  padding-top: 1.5rem;
}

.login__card {
  width: 100%;
  max-width: 460px;
}

.login__loading {
  display: flex;
  justify-content: center;
  padding: 1.5rem 0;
}

.login__methods {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.login__group-title {
  margin: 0 0 0.5rem;
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--app-text-muted);
}

.login__mock {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
</style>

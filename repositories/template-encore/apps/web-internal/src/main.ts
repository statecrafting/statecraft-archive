import { createApp } from 'vue'
import { createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import { definePreset } from '@primevue/themes'
import Aura from '@primevue/themes/aura'
import 'primeicons/primeicons.css'
import App from './App.vue'
import router from './router'
import './assets/styles/main.css'

// Indigo primary on the Aura preset: a professional, neutral enterprise palette.
const AppPreset = definePreset(Aura, {
  semantic: {
    primary: {
      50: '{indigo.50}',
      100: '{indigo.100}',
      200: '{indigo.200}',
      300: '{indigo.300}',
      400: '{indigo.400}',
      500: '{indigo.500}',
      600: '{indigo.600}',
      700: '{indigo.700}',
      800: '{indigo.800}',
      900: '{indigo.900}',
      950: '{indigo.950}',
    },
  },
})

// `as never`: the SFC default export resolves loosely under the lint type
// service; the cast keeps createApp's argument strongly typed at the call site.
const app = createApp(App as never)

app.use(createPinia())
app.use(router)
app.use(PrimeVue, {
  theme: {
    preset: AppPreset,
    options: { darkModeSelector: 'system', cssLayer: false },
  },
})

app.mount('#app')

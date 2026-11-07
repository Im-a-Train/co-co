import { createApp } from 'vue'
import App from './App.vue'
import i18n from './plugins/i18n'
import vuetify from './plugins/vuetify'
import router from './router'

async function boot(): Promise<void> {
  // UI QA without Tauri: only in vite dev mode (dead-code-eliminated from production builds).
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('mock') === '1') {
    const { installMockTauri } = await import('./dev/mockTauri')
    installMockTauri()
  }
  createApp(App).use(i18n).use(vuetify).use(router).mount('#app')
}

void boot()

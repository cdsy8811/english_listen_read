import { createSSRApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'

export function createApp() {
  const app = createSSRApp(App)
  app.use(createPinia())
  // Vue3 版 uni-app 只需返回 app；不要返回 Vue2 时代的 Pinia 字段
  return { app }
}

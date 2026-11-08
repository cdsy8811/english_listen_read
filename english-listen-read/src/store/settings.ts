import { defineStore } from 'pinia'
import { DEFAULT_SETTINGS, type Settings } from '@/services/types'
import * as repo from '@/services/storage'

export const useSettingsStore = defineStore('settings', {
  state: () => ({ data: { ...DEFAULT_SETTINGS } as Settings, loaded: false }),
  actions: {
    /** 幂等加载：App.vue 与各页面都可安全调用；失败时保留默认设置，离线功能不受影响。 */
    async load() {
      if (this.loaded) return
      try {
        this.data = await repo.loadSettings()
        this.loaded = true
      } catch (_) { /* 本地库异常时用内存默认值 */ }
    },
    async set<K extends keyof Settings>(key: K, value: Settings[K]) {
      this.data[key] = value
      await repo.saveSetting(key, value)
    },
    async reset() {
      this.data = { ...DEFAULT_SETTINGS }
      for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
        await repo.saveSetting(k, DEFAULT_SETTINGS[k])
      }
    },
  },
})

import { defineStore } from 'pinia'
import type { Unit, Word } from '@/services/types'
import * as repo from '@/services/storage'

export const useLibraryStore = defineStore('library', {
  state: () => ({
    units: [] as Unit[],
    words: [] as Word[],
    currentUnitId: '' as string,
    keyword: '' as string,
  }),
  getters: {
    currentUnit(state): Unit | null {
      return state.units.find((u) => u.id === state.currentUnitId) || null
    },
    visibleWords(state): Word[] {
      const k = state.keyword.trim().toLowerCase()
      if (!k) return state.words
      return state.words.filter((w) =>
        w.word.toLowerCase().includes(k) || w.translation.includes(k),
      )
    },
  },
  actions: {
    async refreshUnits() { this.units = await repo.listUnits() },
    async openUnit(id: string) {
      this.currentUnitId = id
      this.words = await repo.listWords(id)
    },
    async addUnit(title: string): Promise<Unit> {
      const u = await repo.createUnit(title)
      await this.refreshUnits()
      return u
    },
    async removeUnit(id: string) {
      await repo.deleteUnit(id)
      if (this.currentUnitId === id) { this.currentUnitId = ''; this.words = [] }
      await this.refreshUnits()
    },
    async renameUnit(id: string, title: string) {
      await repo.renameUnit(id, title)
      await this.refreshUnits()
    },
    async removeWord(id: string) {
      await repo.deleteWord(id)
      await this.openUnit(this.currentUnitId)
    },
    async saveWord(w: Word) {
      await repo.saveWord(w)
      await this.openUnit(this.currentUnitId)
    },
  },
})

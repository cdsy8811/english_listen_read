import { defineStore } from 'pinia'
import type { EvalResult, PracticeMode } from '@/services/types'

export interface RoundItem { wordId: string; word: string; score: number; result: EvalResult | null }

/** 一次练习的会话结果，供结果页汇总（不落库，落库由 practice_record 负责）。 */
export const usePracticeStore = defineStore('practice', {
  state: () => ({
    unitId: '' as string,
    mode: '2.1' as PracticeMode,
    total: 0,
    rounds: [] as RoundItem[],
    startedAt: 0,
  }),
  getters: {
    answered(state): number { return state.rounds.length },
    average(state): number {
      if (!state.rounds.length) return 0
      return Math.round(state.rounds.reduce((s, r) => s + r.score, 0) / state.rounds.length)
    },
    wrongCount(state): number { return state.rounds.filter((r) => r.score < 60).length },
  },
  actions: {
    start(unitId: string, mode: PracticeMode, total: number) {
      this.unitId = unitId; this.mode = mode; this.total = total
      this.rounds = []; this.startedAt = Date.now()
    },
    record(item: RoundItem) { this.rounds.push(item) },
  },
})

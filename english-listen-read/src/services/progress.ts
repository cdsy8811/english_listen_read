/**
 * 练习页状态机（固定口径，新增逻辑不得绕开）：
 *   idle → playing → awaiting → evaluating → advancing
 * 2.1 无作答：playing 播完直接 advancing；2.2 / 2.3 playing 后进入 awaiting。
 * 定时推进与用户提交都只能从 evaluating → advancing，避免两者打架。
 */
export type PracticeState = 'idle' | 'playing' | 'awaiting' | 'evaluating' | 'advancing'

const ALLOWED: Record<PracticeState, PracticeState[]> = {
  idle: ['playing'],
  playing: ['awaiting', 'advancing'],
  awaiting: ['evaluating', 'advancing'],
  evaluating: ['advancing'],
  advancing: ['playing', 'idle'],
}

export function canTransition(from: PracticeState, to: PracticeState): boolean {
  return ALLOWED[from].includes(to)
}

export class StateMachine {
  private _state: PracticeState = 'idle'
  private listeners: Array<(s: PracticeState, from: PracticeState) => void> = []

  get state(): PracticeState { return this._state }

  onChange(fn: (s: PracticeState, from: PracticeState) => void): void {
    this.listeners.push(fn)
  }

  to(next: PracticeState): boolean {
    if (!canTransition(this._state, next)) return false
    const from = this._state
    this._state = next
    for (const fn of this.listeners) fn(next, from)
    return true
  }

  reset(): void { this._state = 'idle' }
}

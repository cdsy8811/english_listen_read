/**
 * 推进模式控制器（P5 验收点：定时 / 提交两种推进互斥、不重复触发）。
 *
 * - submit：只有用户点「下一条 / 跳过」才推进，绝不挂定时器。
 * - timer ：评价完成后挂一个可取消的定时器；用户提前点「下一条」立即取消定时器。
 * - 无论哪条路径，onAdvance 在「一条题目」内最多触发一次；下一条由 reset() 重新武装。
 */
import type { AdvanceMode } from './types.ts'

export interface AdvanceOptions {
  getMode: () => AdvanceMode
  getWaitSec: () => number
  onAdvance: () => void
  /** 注入时钟，便于离线自测 */
  setTimeoutFn?: (fn: () => void, ms: number) => unknown
  clearTimeoutFn?: (h: unknown) => void
}

export interface AdvanceController {
  /** 评价完成后调用：timer 模式挂表，submit 模式不挂表 */
  schedule: () => void
  /** 用户点「下一条 / 跳过」 */
  commitNow: () => void
  /** 重试 / 切页 / 结束：彻底取消，不再推进 */
  cancel: () => void
  /** 进入新一条时重新武装 */
  reset: () => void
  isPending: () => boolean
}

export function createAdvanceController(opts: AdvanceOptions): AdvanceController {
  const setTimer = opts.setTimeoutFn || ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = opts.clearTimeoutFn || ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
  let handle: unknown = null
  let fired = false

  const clear = () => {
    if (handle !== null) { clearTimer(handle); handle = null }
  }
  const fire = () => {
    if (fired) return
    fired = true
    clear()
    opts.onAdvance()
  }

  return {
    schedule() {
      if (fired || opts.getMode() !== 'timer') return
      clear()
      // 需求口径 1–15 秒，越界值夹回区间
      const sec = Math.max(1, Math.min(15, opts.getWaitSec()))
      handle = setTimer(() => { handle = null; fire() }, sec * 1000)
    },
    commitNow() { fire() },
    cancel() { fired = true; clear() },
    reset() { clear(); fired = false },
    isPending() { return !fired },
  }
}

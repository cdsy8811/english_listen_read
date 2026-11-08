/**
 * 播放队列：由「播放完成回调」驱动，禁止用固定 sleep 串播。
 * 支持 2.1 的播放顺序 / 重复次数 / 语速 / 音量 / 条目间隔（间隔计时器可随时取消）。
 */
import { synthesize, speakNative, stopNative } from '../api/xfyun-tts.ts'
import { logger } from '../utils/log.ts'
import type { Settings, Word } from './types.ts'

export interface Segment { text: string; lang: 'zh' | 'en'; label: string }
export interface PlayOptions {
  speed: number
  volume: number
  /** 每条之间的间隔（秒），由需求 3 明确要求，不是串播估算 */
  gapSec?: number
  onSegStart?: (seg: Segment, index: number, total: number) => void
  onSegEnd?: (seg: Segment) => void
}

/** 2.1 的播放片段生成（纯函数，可离线自测）。 */
export function buildReadSegments(word: Word, s: Pick<Settings, 'playOrder' | 'repeatTimes'>): Segment[] {
  const en: Segment = { text: word.word, lang: 'en', label: '英文' }
  const zh: Segment = { text: word.translation || word.word, lang: 'zh', label: '中文释义' }
  const base: Segment[] =
    s.playOrder === 'zh-en' ? [zh, en] :
    s.playOrder === 'en-only' ? [en] : [en, zh]
  const times = Math.min(3, Math.max(1, s.repeatTimes))
  const out: Segment[] = []
  for (let i = 0; i < times; i++) out.push(...base.map((x) => ({ ...x })))
  return out
}

/** 2.2 读中文提示 / 2.3 读英文单词。 */
export function buildPromptSegment(word: Word, mode: '2.2' | '2.3'): Segment {
  return mode === '2.2'
    ? { text: word.translation || word.word, lang: 'zh', label: '中文提示' }
    : { text: word.word, lang: 'en', label: '英文单词' }
}

type AudioCtx = ReturnType<typeof uni.createInnerAudioContext>

export class PlayQueue {
  private cancelled = false
  private current: AudioCtx | null = null
  private currentFinish: (() => void) | null = null
  private gapTimer: ReturnType<typeof setTimeout> | null = null
  private gapResolve: (() => void) | null = null

  get isCancelled(): boolean { return this.cancelled }

  /** 立刻停止：取消间隔计时器、销毁当前音频，并让所有在等的 Promise 收口。 */
  stop(): void {
    this.cancelled = true
    if (this.gapTimer) { clearTimeout(this.gapTimer); this.gapTimer = null }
    if (this.gapResolve) { const r = this.gapResolve; this.gapResolve = null; r() }
    const finish = this.currentFinish
    this.currentFinish = null
    try { this.current?.stop(); this.current?.destroy() } catch (_) { /* ignore */ }
    this.current = null
    // 原生 TTS / 浏览器语音不在 current 里，需要单独打断
    try { stopNative() } catch (_) { /* ignore */ }
    finish?.()
  }

  /** 单段音频：onEnded / onError 都算完成，避免一段卡死整条队列。 */
  private playFile(path: string, volume: number): Promise<void> {
    return new Promise((resolve) => {
      let ctx: AudioCtx
      try { ctx = uni.createInnerAudioContext() } catch (_) { resolve(); return }
      this.current = ctx
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        if (this.current === ctx) { this.current = null; this.currentFinish = null }
        try { ctx.destroy() } catch (_) { /* ignore */ }
        resolve()
      }
      this.currentFinish = finish
      ctx.src = path
      ctx.volume = Math.min(1, Math.max(0, volume / 100))
      ctx.onEnded(finish)
      ctx.onError(() => { logger.warn('player.audio.error'); finish() })
      ctx.onPlay(() => {})
      try { ctx.play() } catch (_) { finish() }
    })
  }

  /** 顺序播放一组片段；每一段都等上一段完成回调后才开始。 */
  async playSegments(segments: Segment[], opts: PlayOptions): Promise<void> {
    this.cancelled = false
    for (let i = 0; i < segments.length; i++) {
      if (this.cancelled) return
      const seg = segments[i]
      opts.onSegStart?.(seg, i, segments.length)
      await this.playOne(seg, opts)
      opts.onSegEnd?.(seg)
    }
  }

  private async playOne(seg: Segment, opts: PlayOptions): Promise<void> {
    if (this.cancelled) return
    const speakOpts = { lang: seg.lang, speed: opts.speed, volume: opts.volume }
    try {
      const path = await synthesize(seg.text, speakOpts)
      if (this.cancelled) return
      // 空路径 = 英文音色不可用 / 无网，已降级安卓原生 TTS
      if (!path) { await speakNative(seg.text, speakOpts); return }
      await this.playFile(path, opts.volume)
    } catch (e) {
      logger.warn('player.segment.fallback', { name: (e as Error).name })
      if (!this.cancelled) { try { await speakNative(seg.text, speakOpts) } catch (_) { /* 不因单段失败中断练习 */ } }
    }
  }

  /** 条目间隔：可取消的计时器，不与播放回调冲突。 */
  waitGap(seconds: number): Promise<void> {
    if (seconds <= 0 || this.cancelled) return Promise.resolve()
    return new Promise((resolve) => {
      this.gapResolve = resolve
      this.gapTimer = setTimeout(() => {
        this.gapTimer = null
        this.gapResolve = null
        resolve()
      }, seconds * 1000)
    })
  }
}

/** 全局唯一队列，切页 / 退出练习时调用 stop 即可。 */
export const playQueue = new PlayQueue()

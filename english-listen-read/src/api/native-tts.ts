/**
 * 安卓原生 TTS 降级档（完全离线、免费）。
 * 方案第 5 节结论：plus.android.importClass('android.speech.tts.TextToSpeech')
 * + OnInitListener 可用；风险是中文语音包可能 LANG_MISSING_DATA。
 * 仅作为英文超拟人音色未授权 / 无网时的降级，不进主线。
 */
import { logger } from '../utils/log.ts'
import type { SpeakOptions } from './xfyun-tts.ts'

type TtsInstance = {
  setLanguage: (l: unknown) => number
  setSpeechRate: (s: number) => number
  speak: (text: string, mode: number, params: unknown) => number
  setOnUtteranceProgressListener: (l: unknown) => number
  shutdown: () => void
}

/** importClass 返回的是泛化的 PlusAndroidClassObject，按实际用到的类收敛类型。 */
function androidClass<T>(name: string): T {
  return plus.android.importClass(name) as unknown as T
}

let cached: TtsInstance | null = null

export function nativeAvailable(): boolean {
  // #ifdef APP-PLUS
  return true
  // #endif
  // #ifndef APP-PLUS
  // 浏览器预览：用系统语音合成兜底，保证「点播放有声音」，便于校对界面与流程。
  return typeof window !== 'undefined' && 'speechSynthesis' in window
  // #endif
}

/** 浏览器预览朗读：Web Speech API，同样用 onend / onerror 回调驱动队列。 */
function browserSpeak(text: string, opts: SpeakOptions): Promise<void> {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return Promise.resolve()
  return new Promise<void>((resolve) => {
    let done = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const finish = () => {
      if (done) return
      done = true
      if (timer) clearTimeout(timer)
      resolve()
    }
    const utter = new SpeechSynthesisUtterance(text)
    utter.lang = opts.lang === 'zh' ? 'zh-CN' : 'en-US'
    utter.rate = Math.min(2, Math.max(0.5, opts.speed))
    utter.volume = Math.min(1, Math.max(0, opts.volume / 100))
    utter.onend = finish
    utter.onerror = finish
    timer = setTimeout(finish, Math.max(4000, text.length * 220))
    try {
      window.speechSynthesis.cancel()
      window.speechSynthesis.speak(utter)
    } catch (_) { finish() }
  })
}

function instance(): TtsInstance | null {
  // #ifdef APP-PLUS
  if (cached) return cached
  try {
    const TTS = androidClass<new (activity: unknown, listener: unknown) => TtsInstance>(
      'android.speech.tts.TextToSpeech',
    )
    const Locale = androidClass<{ US: unknown }>('java.util.Locale')
    const activity = plus.android.runtimeMainActivity()
    const listener = plus.android.implements('android.speech.tts.TextToSpeech$OnInitListener', {
      onInit: (_status: number) => { /* 初始化完成后再 setLanguage */ },
    })
    const tts = new TTS(activity, listener)
    tts.setLanguage(Locale.US)
    cached = tts
    return tts
  } catch (e) {
    logger.warn('tts.native.init', { name: (e as Error).name })
    return null
  }
  // #endif
  // #ifndef APP-PLUS
  return null
  // #endif
}

/**
 * 原生朗读：用 UtteranceProgressListener 的 onDone / onError 完成回调收口，
 * 播放队列由回调驱动，绝不用固定 sleep 估算时长。
 */
export async function nativeSpeak(text: string, opts: SpeakOptions): Promise<void> {
  // #ifdef APP-PLUS
  const tts = instance()
  if (!tts) return
  const Locale = androidClass<{ CHINESE: unknown; US: unknown }>('java.util.Locale')
  const HashMap = androidClass<new () => { put: (k: string, v: string) => void }>('java.util.HashMap')
  tts.setLanguage(opts.lang === 'zh' ? Locale.CHINESE : Locale.US)
  tts.setSpeechRate(Math.min(2, Math.max(0.5, opts.speed)))
  await new Promise<void>((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      if (timer) clearTimeout(timer)
      resolve()
    }
    // 回调丢失时的兜底（不是串播计时，只是防止队列永久卡死）
    const timer = setTimeout(finish, Math.max(4000, text.length * 220))
    try {
      const listener = plus.android.implements('android.speech.tts.UtteranceProgressListener', {
        onStart: () => {},
        onDone: () => finish(),
        onError: () => finish(),
      })
      tts.setOnUtteranceProgressListener(listener)
    } catch (_) { /* 部分 ROM 不支持监听器，走兜底 */ }
    const params = new HashMap()
    params.put('utteranceId', 'elr-utterance')
    tts.speak(text, 0, params) // QUEUE_FLUSH
  })
  // #endif
  // #ifndef APP-PLUS
  await browserSpeak(text, opts)
  // #endif
}

/** 打断正在朗读的内容（用户点停止 / 切词时用），不销毁实例。 */
export function interruptNative(): void {
  // #ifdef APP-PLUS
  try { (cached as TtsInstance & { stop?: () => number } | null)?.stop?.() } catch (_) { /* ignore */ }
  // #endif
  // #ifndef APP-PLUS
  try { window.speechSynthesis?.cancel() } catch (_) { /* ignore */ }
  // #endif
}

export function releaseNative(): void {
  // #ifdef APP-PLUS
  try { cached?.shutdown() } catch (_) { /* ignore */ }
  cached = null
  // #endif
  // #ifndef APP-PLUS
  try { window.speechSynthesis?.cancel() } catch (_) { /* ignore */ }
  // #endif
}

/**
 * 录音能力：uni.getRecorderManager()，16k 单声道 mp3（lame），单次 ≤60s。
 *
 * 排障要点（真机上录音失败的常见原因都在这里记日志）：
 * 1) uni 的 onStart / onStop / onError 是**全局唯一**回调，反复 onXxx 只会叠加监听，
 *    所以只在第一次取 manager 时注册一遍，再按会话号派发给当前等待者；
 * 2) onStop 会自己触发（达到 duration 上限、被来电打断），此时没有 stopRecording 调用者，
 *    结果先存下来，松手时直接复用，不至于把已录好的音频丢掉；
 * 3) 所有失败路径都带上「卡在哪一步 + 耗时」，日志可在练习页「排障日志」里复制出来。
 */
import { CloudError, errText, kb, logger } from '../utils/log.ts'
import { readDataUrl } from '../utils/plus-io.ts'

export interface RecordResult { path: string; base64: string; durationMs: number }

interface StopWaiter {
  session: number
  resolve: (path: string) => void
  reject: (e: unknown) => void
}

let recorder: ReturnType<typeof uni.getRecorderManager> | null = null
/** 会话号：start 递增，用来识别迟到的旧回调 */
let sessionSeq = 0
let activeSession = 0
let waiting: StopWaiter | null = null
let startedAt = 0
/** onStart 是否已回调（start() 返回不代表真的开始采集） */
let started = false
/** 最近一次 onStop 的结果：用于「录音自己先停了」的情形 */
let lastStop: { session: number; path: string; at: number } | null = null
/** 正在进行的停止流程（拒绝重复 stop） */
let stopTask: Promise<RecordResult> | null = null

/** 日志里只出现文件名，避免打印整条临时路径。 */
function fileName(u: string): string {
  const clean = String(u || '').split('?')[0]
  return clean.split('/').pop() || clean
}

function manager(): ReturnType<typeof uni.getRecorderManager> {
  if (recorder) return recorder
  recorder = uni.getRecorderManager()
  recorder.onStart(() => {
    started = true
    logger.info('rec.event.start', { session: activeSession, afterMs: Date.now() - startedAt })
  })
  recorder.onStop((res) => {
    started = false
    const r = res as { tempFilePath?: string; fileSize?: number; duration?: number }
    const path = r?.tempFilePath || ''
    logger.info('rec.event.stop', {
      session: activeSession,
      file: fileName(path),
      bytes: r?.fileSize,
      dur: r?.duration,
      afterMs: Date.now() - startedAt,
    })
    lastStop = { session: activeSession, path, at: Date.now() }
    const w = waiting
    waiting = null
    if (!w) { logger.warn('rec.stop.no-waiter', { session: activeSession }); return }
    if (w.session !== activeSession) { logger.warn('rec.stop.stale', { want: w.session, got: activeSession }); return }
    if (!path) { w.reject(new CloudError('录音结束但没拿到文件，请重试', -11)); return }
    w.resolve(path)
  })
  recorder.onError((e) => {
    started = false
    logger.error('rec.event.error', {
      session: activeSession,
      afterMs: Date.now() - startedAt,
      msg: errText(e),
    })
    const w = waiting
    waiting = null
    if (w) w.reject(new CloudError(`录音出错：${errText(e) || '未知错误'}`, -12))
  })
  // 部分机型会走中断 / 暂停事件（来电、其他 App 抢占麦克风），记下来才好定位
  const ext = recorder as unknown as {
    onInterruptionBegin?: (cb: () => void) => void
    onInterruptionEnd?: (cb: () => void) => void
    onPause?: (cb: () => void) => void
    onResume?: (cb: () => void) => void
  }
  ext.onInterruptionBegin?.(() => logger.warn('rec.event.interruption-begin', { session: activeSession }))
  ext.onInterruptionEnd?.(() => logger.warn('rec.event.interruption-end', { session: activeSession }))
  ext.onPause?.(() => logger.warn('rec.event.pause', { session: activeSession }))
  ext.onResume?.(() => logger.warn('rec.event.resume', { session: activeSession }))
  logger.info('rec.manager.ready', {})
  return recorder
}

/** 开始录音（同步返回：真正的开始以 onStart 事件为准，日志里有 afterMs）。 */
export function startRecording(): void {
  if (started) logger.warn('rec.start.busy', { session: activeSession })
  const m = manager()
  sessionSeq++
  activeSession = sessionSeq
  startedAt = Date.now()
  started = false
  lastStop = null
  waiting = null
  logger.info('rec.start.req', {
    session: activeSession, maxSec: 60, sampleRate: 16000, channels: 1, format: 'mp3',
  })
  try {
    m.start({
      duration: 60000,
      sampleRate: 16000,
      numberOfChannels: 1,
      encodeBitRate: 48000,
      format: 'mp3',
    })
  } catch (e) {
    logger.error('rec.start.throw', { session: activeSession, msg: errText(e) })
    throw new CloudError(`录音启动失败：${errText(e) || '未知错误'}`, -13)
  }
}

/** 停止录音并读取音频 base64。 */
export function stopRecording(): Promise<RecordResult> {
  // 松手与 60s 上限计时器可能同时触发，只允许一次 stop，其余复用同一个 Promise
  if (stopTask) {
    logger.warn('rec.stop.dup', { session: activeSession })
    return stopTask
  }
  const p = doStop()
  stopTask = p
  const clear = () => { stopTask = null }
  p.then(clear, clear)
  return p
}

async function doStop(): Promise<RecordResult> {
  const durationMs = Date.now() - startedAt
  const session = activeSession
  const m = manager()
  // 注意：waiting 是「本次 stop 的等待者」，只能在这里创建，不能拿它判断有没有在录音，
  // 否则每次松手都会走到下面的报错分支（上一版就踩了这个坑）。
  if (!session) {
    logger.error('rec.stop.no-session', { session, started, dur: durationMs })
    throw new CloudError('录音还没有开始，请按住再说', -10)
  }
  // 已经自己停了（60s 上限 / 被系统打断）：onStop 结果已缓存，直接复用
  if (lastStop && lastStop.session === session && lastStop.path && Date.now() - lastStop.at < 10000) {
    logger.warn('rec.stop.reuse-auto-stop', { session, file: fileName(lastStop.path), dur: durationMs })
    return finishRead(lastStop.path, durationMs, session)
  }
  if (!started) {
    // 少数机型 onStart 事件迟到：仍然把 stop 发下去，让 onStop/onError 决定结果
    logger.warn('rec.stop.before-start-event', { session, dur: durationMs })
  }
  const path = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      waiting = null
      logger.error('rec.stop.timeout', { session, dur: durationMs, afterMs: Date.now() - startedAt })
      reject(new CloudError('录音结束回调超时（8s），请重试', -1))
    }, 8000)
    waiting = {
      session,
      resolve: (p) => { clearTimeout(timer); resolve(p) },
      reject: (e) => { clearTimeout(timer); reject(e) },
    }
    logger.info('rec.stop.req', { session, dur: durationMs, started })
    try {
      m.stop()
    } catch (e) {
      waiting = null
      clearTimeout(timer)
      logger.error('rec.stop.throw', { session, msg: errText(e) })
      reject(new CloudError(`录音停止失败：${errText(e) || '未知错误'}`, -15))
    }
  })
  return finishRead(path, durationMs, session)
}

async function finishRead(path: string, durationMs: number, session: number): Promise<RecordResult> {
  const t0 = Date.now()
  let base64 = ''
  try {
    base64 = await readDataUrl(path)
  } catch (e) {
    logger.error('rec.read.fail', { session, file: fileName(path), msg: errText(e), ms: Date.now() - t0 })
    throw new CloudError('读取录音文件失败，请重试', -14)
  }
  logger.info('rec.ok', { session, file: fileName(path), kb: kb(base64.length), dur: durationMs, readMs: Date.now() - t0 })
  if (base64.length < 2000) {
    logger.warn('rec.audio.empty-ish', { session, kb: kb(base64.length), dur: durationMs })
  }
  return { path, base64, durationMs }
}

/** 无网 / 录音失败时，UI 直接切到输入框作答，此函数只负责能力探测。 */
export function recordAvailable(): boolean {
  // #ifdef APP-PLUS
  return true
  // #endif
  // #ifndef APP-PLUS
  return false
  // #endif
}

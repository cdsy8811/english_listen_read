/** 录音能力：uni.getRecorderManager()，16k 单声道 mp3（lame），单次 ≤60s。 */
import { CloudError } from '../utils/log.ts'
import { readDataUrl } from '../utils/plus-io.ts'

export interface RecordResult { path: string; base64: string; durationMs: number }

let recorder: ReturnType<typeof uni.getRecorderManager> | null = null
let startedAt = 0

function manager(): ReturnType<typeof uni.getRecorderManager> {
  if (!recorder) {
    recorder = uni.getRecorderManager()
    recorder.onError(() => { /* 由 start 的 reject 与 UI 提示收口 */ })
  }
  return recorder
}

export function startRecording(): void {
  startedAt = Date.now()
  manager().start({
    duration: 60000,
    sampleRate: 16000,
    numberOfChannels: 1,
    encodeBitRate: 48000,
    format: 'mp3',
  })
}

/** 停止录音并读取音频 base64。 */
export async function stopRecording(): Promise<RecordResult> {
  const durationMs = Date.now() - startedAt
  const path = await new Promise<string>((resolve, reject) => {
    const m = manager()
    const timer = setTimeout(() => reject(new CloudError('录音结束回调超时，请改用输入框作答', -1)), 8000)
    m.onStop((res) => { clearTimeout(timer); resolve(res.tempFilePath) })
    m.stop()
  })
  const base64 = await readAudioBase64(path)
  return { path, base64, durationMs }
}

function readAudioBase64(path: string): Promise<string> {
  return readDataUrl(path).catch(() => Promise.reject(new CloudError('读取录音失败')))
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

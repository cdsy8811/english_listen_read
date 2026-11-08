/**
 * 语音听写大模型（中英）V2.0（WSS，16k 单声道，≤60s）。
 * 实测结论：只返回文本，没有置信度 / 音素 / 流利度 —— 不能用于发音评分。
 * 本项目只用它把录音转成文字，交给 2.2 / 2.3 做「内容正确度」评价。
 */
import { openWs, signedWsUrl } from './http.ts'
import { ENDPOINTS, appId } from './runtime-config.ts'
import { base64ToUtf8 } from '../utils/crypto.ts'
import { CloudError } from '../utils/log.ts'

interface IatFrame {
  header?: { code?: number; message?: string; sid?: string; status?: number }
  payload?: { result?: { text?: string } }
}

/** 解码听写结果帧：text 是 base64 的 JSON，取 ws[].cw[].w 拼接（末帧为全量结果）。 */
export function decodeIatText(b64: string): string {
  if (!b64) return ''
  let json = ''
  try { json = base64ToUtf8(b64) } catch (_) { return '' }
  try {
    const obj = JSON.parse(json) as { ws?: Array<{ cw?: Array<{ w?: string }> }> }
    return (obj.ws || []).map((w) => (w.cw || []).map((c) => c.w || '').join('')).join('').trim()
  } catch (_) { return json }
}

const AUDIO_CFG = { encoding: 'lame', sample_rate: 16000, channels: 1, bit_depth: 16 }

/** 把一段音频（base64）切成帧；首帧带业务参数，末帧 status=2。 */
export function buildIatFrames(audioBase64: string, lang: 'zh' | 'en', frameChars = 1280): unknown[] {
  const first = {
    header: { app_id: appId(), status: 0 },
    parameter: {
      iat: {
        domain: 'sLMv2',
        language: lang === 'en' ? 'en_us' : 'zh_cn',
        accent: 'mandarin',
        eos: 6000,
        result: { encoding: 'utf8', compress: 'raw', format: 'json' },
      },
    },
    payload: { audio: { ...AUDIO_CFG, status: 0, seq: 0, audio: '' } },
  }
  const frames: unknown[] = []
  const count = Math.max(1, Math.ceil(audioBase64.length / frameChars))
  for (let i = 0; i < count; i++) {
    const chunk = audioBase64.slice(i * frameChars, (i + 1) * frameChars)
    const isLast = i === count - 1
    const status = isLast ? 2 : i === 0 ? 0 : 1
    if (i === 0) {
      frames.push({ ...first, payload: { audio: { ...first.payload.audio, audio: chunk, status: 0 } } })
    } else {
      frames.push({
        header: { app_id: appId(), status },
        payload: { audio: { ...AUDIO_CFG, status, seq: i, audio: chunk } },
      })
    }
  }
  // 单帧时首帧的 status 也要是 2，服务端才知道音频结束
  if (count === 1) {
    const f = frames[0] as { header: { status: number }; payload: { audio: { status: number } } }
    f.header.status = 2
    f.payload.audio.status = 2
  }
  return frames
}

/** 一次转写：录音文件 base64 → 分帧 → 云端文本。 */
export async function transcribeRaw(audioBase64: string, lang: 'zh' | 'en'): Promise<string> {
  if (!audioBase64) throw new CloudError('录音为空，请重试或改用输入框作答', -1)
  const frames = buildIatFrames(audioBase64, lang)
  let lastText = ''
  return new Promise<string>((resolve, reject) => {
    let settled = false
    let session: ReturnType<typeof openWs> | null = null
    const finish = (fn: () => void) => { if (!settled) { settled = true; fn() } }
    session = openWs(signedWsUrl(ENDPOINTS.iatWss), {
      onMessage: (raw) => {
        let f: IatFrame
        try { f = JSON.parse(String(raw)) as IatFrame } catch (_) { return }
        const code = f.header?.code
        if (code !== undefined && code !== 0) {
          finish(() => { session?.close(); reject(new CloudError(`听写失败（code=${code}）：${f.header?.message || ''}`, code, f.header?.sid)) })
          return
        }
        const t = f.payload?.result?.text
        if (t) { const text = decodeIatText(t); if (text) lastText = text }
        if (f.header?.status === 2) {
          finish(() => {
            session?.close()
            if (lastText) resolve(lastText)
            else reject(new CloudError('未识别到内容，请重试或改用输入框作答', -2, undefined, true))
          })
        }
      },
      onError: (e) => finish(() => reject(e)),
      onClose: () => finish(() => {
        if (lastText) resolve(lastText)
        else reject(new CloudError('听写连接已关闭，请改用输入框作答', -3, undefined, true))
      }),
    }, 60000)
    // 逐帧发送：40ms 间隔，避免一次性塞满导致丢帧
    let i = 0
    const tick = () => {
      if (settled || i >= frames.length) return
      session?.send(frames[i++])
      if (i < frames.length) setTimeout(tick, 40)
    }
    setTimeout(tick, 120)
  })
}

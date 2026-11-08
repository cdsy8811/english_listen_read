/**
 * 超拟人合成（WSS）。P0 实测要点：
 *  - 签名请求行 GET；三段式请求体；语种靠 vcn 发音人切换（没有 language 字段）
 *  - speed 默认 50 而非 1.0：0.5×–2.0× 需做倍数标定
 *  - 音频分帧返回且顺序不保证，必须按 seq 重排序后再拼接
 *  - 输出 lame(mp3)/16k 可直接给 uni.createInnerAudioContext()
 *  - 英文发音人授权未验证：失败时由 player 降级安卓原生 TTS
 */
import { openWs, signedWsUrl } from './http.ts'
import { ENDPOINTS, appId, devProxyAvailable } from './runtime-config.ts'
import { base64Decode, utf8ToBase64 } from '../utils/crypto.ts'
import { CloudError, logger } from '../utils/log.ts'
import { textHash, saveAudioBytes, audioFilePath } from '../utils/audio-file.ts'
import { toBlob } from '../utils/plus-io.ts'
import { getCachedAudio, putCachedAudio } from '../services/storage.ts'
import { dedupe, withRetry } from '../utils/retry.ts'
import { nativeSpeak, nativeAvailable, interruptNative } from './native-tts.ts'

export interface SpeakOptions { lang: 'zh' | 'en'; speed: number; volume: number }

interface TtsFrame {
  header?: { code?: number; message?: string; sid?: string }
  payload?: { audio?: { audio?: string; seq?: number; status?: number } }
}

/** 讯飞 speed 区间 0–100，50 为 1.0×；需求 0.5×–2.0× 线性映射到 25–100。 */
export function speedToXf(multiplier: number): number {
  const clamped = Math.min(2, Math.max(0.5, multiplier))
  return Math.round(clamped * 50)
}

export function volumeToXf(percent: number): number {
  return Math.round(Math.min(100, Math.max(0, percent)))
}

/**
 * 帧按 seq 升序、**逐帧解码后再拼接字节**。
 * 不能直接拼 base64 字符串：单帧自带 `=` 补位，字符串拼接后解码会在第一个补位处截断
 * （实测一句话只剩第一帧、约 3.8KB 的残缺音频）。
 */
export function mergeFrames(frames: Array<{ seq: number; audio: string }>): Uint8Array {
  const sorted = [...frames].sort((a, b) => a.seq - b.seq)
  const parts = sorted.map((f) => base64Decode(f.audio))
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const p of parts) { out.set(p, offset); offset += p.length }
  return out
}

/** 一次合成：返回可直接播放的本地文件路径（带缓存）。 */
async function synthOnce(text: string, opts: SpeakOptions): Promise<string> {
  const vcn = opts.lang === 'en' ? ENDPOINTS.vcnEn : ENDPOINTS.vcnZh
  const speed = speedToXf(opts.speed)
  const hash = textHash(`${text}:${opts.lang}:${vcn}:${speed}`)
  const cached = await getCachedAudio(hash, opts.lang, vcn, speed)
  if (cached) return cached

  const frames: Array<{ seq: number; audio: string }> = []
  return new Promise<string>((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void) => { if (!settled) { settled = true; fn() } }
    let session: ReturnType<typeof openWs> | null = null
    session = openWs(signedWsUrl(ENDPOINTS.ttsWss), {
      onMessage: (raw) => {
        let frame: TtsFrame
        try { frame = JSON.parse(String(raw)) as TtsFrame } catch (_) { return }
        const code = frame.header?.code
        if (code !== undefined && code !== 0) {
          finish(() => {
            session?.close()
            reject(new CloudError(`合成失败（code=${code}）：${frame.header?.message || '发音人可能未授权'}`, code, frame.header?.sid))
          })
          return
        }
        const audio = frame.payload?.audio
        if (audio?.audio) frames.push({ seq: Number(audio.seq ?? 0), audio: audio.audio })
        const status = audio?.status ?? frame.header?.code
        const done = status === 2 || (frames.length > 0 && audio?.audio === '')
        if (done) {
          finish(() => {
            session?.close()
            if (!frames.length) { reject(new CloudError('合成未返回音频', -1)); return }
            const merged = mergeFrames(frames)
            saveAudioBytes(merged, hash)
              .then((path) => putCachedAudio(hash, opts.lang, vcn, speed, audioFilePath(hash)).then(() => resolve(path)))
              .catch(reject)
          })
        }
      },
      onError: (e) => finish(() => reject(e)),
      onClose: () => finish(() => reject(new CloudError('连接在合成完成前关闭', -2, undefined, true))),
    }, 90000)

    // 一次性发送：header.status=2，payload.text.status=2
    const body = {
      header: { app_id: appId(), status: 2 },
      parameter: {
        tts: {
          vcn,
          speed,
          volume: volumeToXf(opts.volume),
          pitch: 50,
          audio: { encoding: 'lame', sample_rate: 16000, channels: 1, bit_depth: 16 },
        },
      },
      payload: {
        text: { encoding: 'utf8', compress: 'raw', format: 'plain', status: 2, seq: 0, text: utf8ToBase64(text) },
      },
    }
    // socket 可能尚未 onOpen；uni.connectSocket 的 send 在 onOpen 前会排队，这里延迟一帧发送
    setTimeout(() => session?.send(body), 120)
  })
}

/**
 * H5 开发预览专用：同源代理合成，返回 data URI。
 * 浏览器拿到的是音频数据，不含任何密钥；静态构建下本函数不会被走到。
 */
const h5AudioCache = new Map<string, string>()

async function synthViaDevProxy(text: string, opts: SpeakOptions): Promise<string> {
  const key = `${text}:${opts.lang}:${opts.speed}:${opts.volume}`
  const hit = h5AudioCache.get(key)
  if (hit) return hit
  const res = await fetch('/__dev/xfyun/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: { text, lang: opts.lang, speed: opts.speed, volume: opts.volume } }),
  })
  const raw = await res.text()
  let data: { audio?: string; header?: { code?: number; message?: string } } = {}
  try { data = JSON.parse(raw) as typeof data } catch (_) { /* 非 JSON 交给状态码报错 */ }
  if (!res.ok || !data.audio) {
    throw new Error(data.header?.message || `本机合成代理返回 ${res.status}`)
  }
  // 交给 <audio> 用 blob URL 更稳（data URI 在部分浏览器有长度上限）
  const blob = toBlob(base64Decode(data.audio), 'audio/mpeg')
  const url = URL.createObjectURL(blob)
  if (h5AudioCache.size > 60) {
    for (const old of h5AudioCache.values()) { try { URL.revokeObjectURL(old) } catch (_) { /* ignore */ } }
    h5AudioCache.clear()
  }
  h5AudioCache.set(key, url)
  return url
}

/**
 * 同一会话内已确认不可用的语种（发音人未授权 / vcn 非法）。
 * 命中后该语种直接走原生 TTS，不再每条词都白跑一次云调用。
 */
const langUnavailable = new Set<'zh' | 'en'>()
const AUTH_FAIL_RE = /code=(10163|10303|11200|11201|11202)/

export function resetVoiceCache(): void {
  langUnavailable.clear()
}

/**
 * 能力层 speak：文本 → 本地音频路径。
 * 英文合成失败（音色未授权等）→ 降级安卓原生 TTS；此时返回空路径由 player 走原生播放。
 */
export async function synthesize(text: string, opts: SpeakOptions): Promise<string> {
  if (!text.trim()) return ''
  if (langUnavailable.has(opts.lang)) return ''
  // #ifndef APP-PLUS
  // 浏览器预览没有凭据、也不做客户端签名：
  //  - 开发预览走本机 vite 代理（Node 侧签名建 WSS），能听到真正的超拟人音色；
  //  - 静态构建无代理，直接返回空路径，交给浏览器语音合成朗读。
  if (import.meta.env.DEV && devProxyAvailable()) {
    try {
      return await synthViaDevProxy(text, opts)
    } catch (e) {
      const msg = String((e as Error).message || '')
      if (AUTH_FAIL_RE.test(msg)) {
        langUnavailable.add(opts.lang)
        logger.warn('tts.voice.unauthorized', { lang: opts.lang })
      } else {
        logger.warn('tts.browser.proxy', { message: msg })
      }
      return ''
    }
  }
  return ''
  // #endif
  // #ifdef APP-PLUS
  const key = `tts:${text}:${opts.lang}:${speedToXf(opts.speed)}:${opts.volume}`
  try {
    return await dedupe(key, () => withRetry(() => synthOnce(text, opts), { retries: 1 }))
  } catch (e) {
    const code = (e as CloudError).code
    if (AUTH_FAIL_RE.test(`code=${code}`)) {
      langUnavailable.add(opts.lang)
      logger.warn('tts.voice.unauthorized', { lang: opts.lang })
    } else {
      logger.warn('tts.fallback', { lang: opts.lang, code })
    }
    if (nativeAvailable()) return '' // 空路径 = 交给原生 TTS 播放
    throw new CloudError('朗读服务暂不可用，请检查网络后重试', 0, undefined, true)
  }
  // #endif
}

/** 直接播放一段文本（原生降级时使用）。 */
export async function speakNative(text: string, opts: SpeakOptions): Promise<void> {
  await nativeSpeak(text, opts)
}

/** 打断正在朗读的原生 / 浏览器语音（停止播放、切词时调用）。 */
export function stopNative(): void {
  interruptNative()
}

/**
 * 超拟人合成（WSS）。P0 实测要点：
 *  - 签名请求行 GET；三段式请求体；语种靠 vcn 发音人切换（没有 language 字段）
 *  - speed 默认 50 而非 1.0：0.5×–2.0× 需做倍数标定
 *  - 音频分帧返回且顺序不保证，必须按 seq 重排序后再拼接
 *  - 输出 lame(mp3)/16k 可直接给 uni.createInnerAudioContext()
 *  - 英文发音人 `x5_EnUs_Lila_flow`（美式女声）2026-11-21 实测 code=0 可用；
 *    其余英文 vcn 仍 11200 未授权，云调用失败 / 无网时由 player 降级安卓原生 TTS
 *  - 讯飞只授权了美式英文音色：请求 UK 口音时直接交给原生 / 浏览器 TTS，不拿美音冒充
 */
import { openWs, signedWsUrl } from './http.ts'
import { ENDPOINTS, appId, devProxyAvailable } from './runtime-config.ts'
import { base64Decode, utf8ToBase64 } from '../utils/crypto.ts'
import { CloudError, kb, logger } from '../utils/log.ts'
import { cacheKey, lookupAudio, storeAudio } from '../services/tts-cache.ts'
import { toBlob } from '../utils/plus-io.ts'
import { dedupe, withRetry } from '../utils/retry.ts'
import { nativeSpeak, nativeAvailable, interruptNative } from './native-tts.ts'

export interface SpeakOptions {
  lang: 'zh' | 'en'
  speed: number
  volume: number
  /**
   * 口音：讯飞英文只有美式发音人，「UK 英音」请求改走原生 / 浏览器 TTS（en-GB）；
   * 云调用失败降级时同样用这个值。
   */
  accent?: 'US' | 'UK'
}

interface TtsFrame {
  header?: { code?: number; message?: string; sid?: string }
  payload?: { audio?: { audio?: string; seq?: number; status?: number } }
}

/** 讯飞 speed 区间 0–100，50 为 1.0×；需求 0.5×–2.0× 线性映射到 25–100。 */
export function speedToXf(multiplier: number): number {
  const clamped = Math.min(2, Math.max(0.5, multiplier))
  return Math.round(clamped * 50)
}

/**
 * 是否跳过云端合成、直接走原生 / 浏览器 TTS。
 * 讯飞英文只授权了美式音色（`x5_EnUs_Lila_flow`），选 UK 英音时不拿美音冒充。
 * 纯函数，可离线自测。
 */
export function preferNativeVoice(opts: Pick<SpeakOptions, 'lang' | 'accent'>): boolean {
  return opts.lang === 'en' && opts.accent === 'UK'
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

/** 一次合成：返回可直接播放的本地文件路径（先查本地缓存，未命中才计费）。 */
async function synthOnce(text: string, opts: SpeakOptions): Promise<string> {
  const vcn = opts.lang === 'en' ? ENDPOINTS.vcnEn : ENDPOINTS.vcnZh
  const speed = speedToXf(opts.speed)
  const meta = { text, lang: opts.lang, vcn, speed }
  const hash = cacheKey(meta)
  const t0 = Date.now()
  const cached = await lookupAudio(meta)
  if (cached) return cached
  logger.debug('tts.req', { lang: opts.lang, vcn, hash, chars: text.length, speed, volume: opts.volume })

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
          logger.warn('tts.fail', { code, lang: opts.lang, sid: frame.header?.sid, ms: Date.now() - t0 })
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
            logger.debug('tts.ok', { lang: opts.lang, frames: frames.length, kb: kb(merged.length), ms: Date.now() - t0 })
            storeAudio(meta, merged).then(resolve).catch(reject)
          })
        }
      },
      onError: (e) => finish(() => reject(e)),
      onClose: () => finish(() => reject(new CloudError('连接在合成完成前关闭', -2, undefined, true))),
    }, 90000)

    // 一次性发送：header.status=2，payload.text.status=2
    // 音量固定 100：音量在播放侧施加，云端只合成一份，所有音量共用缓存
    const body = {
      header: { app_id: appId(), status: 2 },
      parameter: {
        tts: {
          vcn,
          speed,
          volume: 100,
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
  if (hit) {
    logger.debug('tts.cache.hit', { lang: opts.lang, via: 'h5' })
    return hit
  }
  const t0 = Date.now()
  logger.debug('tts.req', { lang: opts.lang, chars: text.length, speed: opts.speed, via: 'h5' })
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
  logger.debug('tts.ok', { lang: opts.lang, via: 'h5', ms: Date.now() - t0 })
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
 * 中文 / 英文（美音）走讯飞超拟人；UK 英音、音色未授权、无网时返回空路径，
 * 由 player 降级安卓原生 TTS 播放。
 */
export async function synthesize(text: string, opts: SpeakOptions): Promise<string> {
  if (!text.trim()) return ''
  if (preferNativeVoice(opts)) {
    logger.debug('tts.accent.native', { lang: opts.lang, accent: opts.accent })
    return ''
  }
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
  // 同一段文本 / 语速并发只合成一次（音量不进键，音量在播放侧施加）
  const key = cacheKey({ text, lang: opts.lang, vcn: opts.lang === 'en' ? ENDPOINTS.vcnEn : ENDPOINTS.vcnZh, speed: speedToXf(opts.speed) })
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

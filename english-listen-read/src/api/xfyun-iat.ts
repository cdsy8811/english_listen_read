/**
 * 语音听写（经典流式版）V2.0：wss://iat-api.xfyun.cn/v2/iat，16k 单声道，≤60s。
 *
 * 为什么是经典版而不是「听写大模型」：
 * 实测同一组 APPID 下，大模型听写（iat.cn-huabei-1.xf-yun.com/v1）返回
 *   header.code=10404 no category route found（domain=sLMv2 / iat）
 *   header.code=11201 licc failed（domain=slm，路由正确但授权未通过）
 * 而经典听写 wss://iat-api.xfyun.cn/v2/iat 对 zh_cn / en_us、raw / lame 均返回 code=0，
 * 说明该 APPID 开通的是经典听写。故转写统一走经典版；日后若开通大模型再改本文件。
 *
 * 协议差异（与旧实现的区别，排错时看这里）：
 * - 请求：首帧 {common.app_id, business{language, domain:'iat', accent, eos, format, encoding}, data{status:0, audio}}
 *        中间帧 {data{status:1, audio}}，末帧 {data{status:2, audio:''}}
 * - 响应：顶层 {code, message, sid, data:{status, result:{ws:[{cw:[{w}]}]}}}，data.status=2 为结束
 * - 听写只返回文本，没有置信度 / 音素 / 流利度，不能用于发音评分（与既定口径一致）。
 *
 * 2026-11-15 实测（scripts/probe-iat.ts，16k 单声道 PCM + 干净合成音频）：
 * - en_us 设 nbest=5 / wbest=5 后 cw 仍然只有一个候选，词级多候选对英文无效，别指望它救回错词；
 * - 同一条音频里 "two" 被听写成 "To."，即英文单词语音转写的同音歧义是常态。
 *   因此 2.2 的容错做在评价层（utils/phonetic.ts 同音词表 + services/evaluator.ts），不在听写层。
 */
import { openWs, signedWsUrl } from './http.ts'
import { ENDPOINTS, appId } from './runtime-config.ts'
import { CloudError, kb, logger } from '../utils/log.ts'

interface IatResult {
  sn?: number
  ls?: boolean
  ws?: Array<{ cw?: Array<{ w?: string }> }>
}
interface IatFrame {
  code?: number
  message?: string
  sid?: string
  /** 个别错误帧沿用 header 结构 */
  header?: { code?: number; message?: string }
  data?: { status?: number; result?: IatResult }
}

/** 送听写的编码：录音器固定输出 16k 单声道 mp3（讯飞称 lame / audio/mpeg）。 */
export const AUDIO_CFG = { format: 'audio/mpeg', encoding: 'lame', sampleRate: 16000 }

/** 从一帧结果里取出文本片段（不带 wpgs 时，各帧的词按出现顺序拼接即可）。 */
export function resultText(r: IatResult | undefined): string {
  if (!r || !Array.isArray(r.ws)) return ''
  return r.ws.map((w) => (w.cw || []).map((c) => c.w || '').join('')).join('')
}

/** 首帧带 common / business，中间 status=1，末帧 status=2 且 audio 为空。 */
export function buildIatFrames(audioBase64: string, lang: 'zh' | 'en', frameChars = 2048): unknown[] {
  const business: Record<string, unknown> = {
    language: lang === 'en' ? 'en_us' : 'zh_cn',
    domain: 'iat',
    // 后端点参数在 WebAPI 里叫 eos（SDK 里的 vad_eos 不生效，会被忽略）；
    // 客户端本来就会发 status=2 结束帧，这里只兜住句中的停顿，别等太久
    eos: 4000,
  }
  // accent 只对中文听写有意义；英文固定 en_us
  if (lang === 'zh') business.accent = 'mandarin'

  const chunks: string[] = []
  for (let i = 0; i < audioBase64.length; i += frameChars) chunks.push(audioBase64.slice(i, i + frameChars))
  if (!chunks.length) chunks.push('')

  const frames: unknown[] = chunks.map((chunk, i) => {
    const data = { status: i === 0 ? 0 : 1, format: AUDIO_CFG.format, encoding: AUDIO_CFG.encoding, audio: chunk }
    return i === 0 ? { common: { app_id: appId() }, business, data } : { data }
  })
  // 结束帧：status=2 + 空 audio
  frames.push({ data: { status: 2, format: AUDIO_CFG.format, encoding: AUDIO_CFG.encoding, audio: '' } })
  return frames
}

/** 一次转写：录音文件 base64 → 分帧 → 云端文本。 */
export async function transcribeRaw(audioBase64: string, lang: 'zh' | 'en'): Promise<string> {
  if (!audioBase64) throw new CloudError('录音为空，请重试或改用输入框作答', -1)
  const frames = buildIatFrames(audioBase64, lang)
  const t0 = Date.now()
  logger.debug('iat.req', { lang, kb: kb(audioBase64.length), frames: frames.length, api: 'iat-v2' })
  let text = ''
  return new Promise<string>((resolve, reject) => {
    let settled = false
    let session: ReturnType<typeof openWs> | null = null
    const finish = (fn: () => void) => { if (!settled) { settled = true; fn() } }
    session = openWs(signedWsUrl(ENDPOINTS.iatWss), {
      onMessage: (raw) => {
        let f: IatFrame
        try { f = JSON.parse(String(raw)) as IatFrame } catch (_) { return }
        const code = f.code ?? f.header?.code
        const message = f.message ?? f.header?.message
        if (code !== undefined && code !== 0) {
          logger.warn('iat.fail', { code, sid: f.sid, ms: Date.now() - t0 })
          finish(() => { session?.close(); reject(new CloudError(`听写失败（code=${code}）：${message || ''}`, code, f.sid)) })
          return
        }
        if (f.data?.result) text += resultText(f.data.result)
        if (f.data?.status === 2) {
          finish(() => {
            session?.close()
            const out = text.trim()
            if (out) {
              logger.debug('iat.ok', { chars: out.length, ms: Date.now() - t0 })
              resolve(out)
            } else reject(new CloudError('未识别到内容，请说得清楚些或改用输入框作答', -2, f.sid, true))
          })
        }
      },
      onError: (e) => finish(() => reject(e)),
      onClose: () => finish(() => {
        const out = text.trim()
        if (out) {
          logger.debug('iat.ok.close', { chars: out.length, ms: Date.now() - t0 })
          resolve(out)
        } else reject(new CloudError('听写连接已关闭且没有识别结果，请重试或改用输入框作答', -3, undefined, true))
      }),
    }, 60000)
    // 逐帧发送：20ms 间隔，避免一次性塞满导致丢帧
    let i = 0
    const tick = () => {
      if (settled || i >= frames.length) return
      session?.send(frames[i++])
      if (i < frames.length) setTimeout(tick, 20)
    }
    setTimeout(tick, 120)
  })
}

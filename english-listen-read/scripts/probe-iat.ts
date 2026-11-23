/**
 * 语音听写探测：把一段英文音频送 iat，对比「默认参数」与「开多候选（nbest/wbest）」的返回。
 * 用途：确认英文（en_us）是否支持词级多候选 wbest —— 这决定 2.2「看中说英」能不能
 *       从多个发音相近的候选里挑回标准答案所在的词（read / red、write / right 之类）。
 * 密钥只在 Node 进程内使用，不打印任何凭据。
 *
 * 注意：直接用词表合成英文音频这条路可能走不通——英文发音人未授权时合成返回 11200
 * （licc limit）。此时用 `--file` 传 16k 单声道 wav（自动取 data 段当 PCM）或 mp3。
 *
 * 用法：
 *   node --experimental-strip-types scripts/probe-iat.ts read right two ship
 *   node --experimental-strip-types scripts/probe-iat.ts --file sample.wav
 *   node --experimental-strip-types scripts/probe-iat.ts --file sample.wav --host wss://ws-api.xfyun.cn/v2/iat
 */
import fs from 'node:fs'
import path from 'node:path'
import { buildAuthQuery, splitEndpoint } from '../src/api/xfyun-sign.ts'

const ROOT = path.resolve(import.meta.dirname, '..')

function loadEnv(): Record<string, string> {
  const file = path.join(ROOT, '.env.local')
  if (!fs.existsSync(file)) throw new Error('缺少 .env.local，请先运行 npm run prepare:env')
  const out: Record<string, string> = {}
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (m) out[m[1]] = m[2]
  }
  return out
}

const env = loadEnv()

function signedWsUrl(endpoint: string): string {
  const { scheme, host, path: p } = splitEndpoint(endpoint)
  const q = buildAuthQuery({
    path: p, method: 'GET', signHost: host,
    apiKey: env.XFYUN_API_KEY, apiSecret: env.XFYUN_API_SECRET,
  })
  return `${scheme === 'https' ? 'wss' : 'ws'}://${host}${p}?${q}`
}

/** 用超拟人合成一段英文音频（只用于探测，不落盘）。 */
function synthesizeEn(text: string): Promise<Buffer> {
  const endpoint = env.XFYUN_TTS_WSS
  const vcn = env.XFYUN_TTS_VCN_EN
  if (!vcn) return Promise.reject(new Error('XFYUN_TTS_VCN_EN 未配置'))
  return new Promise((resolve, reject) => {
    const frames: Array<{ seq: number; audio: string }> = []
    let done = false
    const ws = new WebSocket(signedWsUrl(endpoint))
    const timer = setTimeout(() => end(() => reject(new Error('合成超时'))), 45000)
    const end = (fn: () => void) => {
      if (done) return
      done = true
      clearTimeout(timer)
      try { ws.close() } catch (_) { /* ignore */ }
      fn()
    }
    ws.onopen = () => {
      ws.send(JSON.stringify({
        header: { app_id: env.XFYUN_APPID, status: 2 },
        parameter: {
          tts: {
            vcn, speed: 50, volume: 80, pitch: 50,
            audio: { encoding: 'lame', sample_rate: 16000, channels: 1, bit_depth: 16 },
          },
        },
        payload: {
          text: { encoding: 'utf8', compress: 'raw', format: 'plain', status: 2, seq: 0, text: Buffer.from(text).toString('base64') },
        },
      }))
    }
    ws.onmessage = (ev: MessageEvent) => {
      let f: { header?: { code?: number; message?: string }; payload?: { audio?: { audio?: string; seq?: number; status?: number } } }
      try { f = JSON.parse(String(ev.data)) } catch (_) { return }
      const code = f.header?.code
      if (code !== undefined && code !== 0) {
        end(() => reject(new Error(`合成失败 code=${code} ${f.header?.message || ''}`)))
        return
      }
      const a = f.payload?.audio
      if (a?.audio) frames.push({ seq: Number(a.seq ?? 0), audio: a.audio })
      if (a?.status === 2) {
        end(() => {
          const merged = frames.sort((x, y) => x.seq - y.seq).map((x) => Buffer.from(x.audio, 'base64'))
          resolve(Buffer.concat(merged))
        })
      }
    }
    ws.onerror = () => end(() => reject(new Error('合成连接出错')))
  })
}

interface IatOut { code: number; message: string; frames: number; texts: string[]; cw: string[][] }

interface AudioCfg { encoding: string; format: string }

/** WAV 文件取 data 段当 16k 单声道 PCM；其它按 mp3(lame) 处理。 */
function loadAudio(p: string): { buf: Buffer; label: string; cfg: AudioCfg } {
  const raw = fs.readFileSync(path.resolve(p))
  const isWav = raw.subarray(0, 4).toString('ascii') === 'RIFF'
  if (!isWav) {
    return { buf: raw, label: path.basename(p), cfg: { encoding: 'lame', format: 'audio/mpeg' } }
  }
  // 找 data chunk（不依赖固定 44 字节头）
  let off = 12
  while (off + 8 <= raw.length) {
    const id = raw.subarray(off, off + 4).toString('ascii')
    const size = raw.readUInt32LE(off + 4)
    if (id === 'data') return { buf: raw.subarray(off + 8, off + 8 + size), label: path.basename(p), cfg: { encoding: 'raw', format: 'audio/L16;rate=16000' } }
    off += 8 + size + (size % 2)
  }
  throw new Error(`${path.basename(p)} 不是合法的 WAV`)
}

/** 送听写；multi=true 时打开 nbest/wbest，返回每个 ws 的候选词表。 */
function iat(audio: Buffer, multi: boolean, cfg: AudioCfg = { encoding: 'lame', format: 'audio/mpeg' }, endpointOverride = ''): Promise<IatOut> {
  const endpoint = endpointOverride || env.XFYUN_IAT_WSS
  const b64 = audio.toString('base64')
  const business: Record<string, unknown> = { language: 'en_us', domain: 'iat', eos: 6000 }
  if (multi) { business.nbest = 5; business.wbest = 5 }
  return new Promise((resolve, reject) => {
    const out: IatOut = { code: 0, message: '', frames: 0, texts: [''], cw: [] }
    const ws = new WebSocket(signedWsUrl(endpoint))
    let done = false
    const timer = setTimeout(() => end(() => reject(new Error('听写超时'))), 60000)
    const end = (fn: () => void) => {
      if (done) return
      done = true
      clearTimeout(timer)
      try { ws.close() } catch (_) { /* ignore */ }
      fn()
    }
    ws.onopen = () => {
      const chunk = 2048
      const chunks: string[] = []
      for (let i = 0; i < b64.length; i += chunk) chunks.push(b64.slice(i, i + chunk))
      let i = 0
      const tick = () => {
        if (done) return
        if (i < chunks.length) {
          const first = i === 0
          const data = {
            status: first ? 0 : 1, format: cfg.format, encoding: cfg.encoding, audio: chunks[i],
          }
          ws.send(JSON.stringify(first ? { common: { app_id: env.XFYUN_APPID }, business, data } : { data }))
          i++
          setTimeout(tick, 40)
          return
        }
        ws.send(JSON.stringify({ data: { status: 2, format: cfg.format, encoding: cfg.encoding, audio: '' } }))
      }
      tick()
    }
    ws.onmessage = (ev: MessageEvent) => {
      let f: { code?: number; message?: string; header?: { code?: number; message?: string }; data?: { status?: number; result?: { ws?: Array<{ cw?: Array<{ w?: string }> }> } } }
      try { f = JSON.parse(String(ev.data)) } catch (_) { return }
      const code = f.code ?? f.header?.code
      if (code !== undefined && code !== 0) {
        out.code = code
        out.message = f.message ?? f.header?.message ?? ''
        end(() => resolve(out))
        return
      }
      const wsList = f.data?.result?.ws || []
      if (wsList.length) {
        out.frames++
        const variants: string[] = []
        for (const w of wsList) {
          const cands = (w.cw || []).map((c) => c.w || '')
          out.cw.push(cands)
          if (!variants.length) variants.push(...cands)
        }
        // 帧内每个 ws 取第一个候选拼成一句，另把「候选总数」记到 texts 里方便对比
        const top = wsList.map((w) => (w.cw || [])[0]?.w || '').join('')
        const prev = out.texts[0]
        out.texts[0] = prev + top
      }
      if (f.data?.status === 2) end(() => resolve(out))
    }
    ws.onerror = () => end(() => reject(new Error('听写连接出错')))
    ws.onclose = () => end(() => resolve(out))
  })
}

async function main() {
  const args = process.argv.slice(2)
  const fileIdx = args.indexOf('--file')
  const hostIdx = args.indexOf('--host')
  const host = hostIdx >= 0 ? args[hostIdx + 1] : ''
  const words = fileIdx >= 0 ? [] : (args.length ? args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--file' && args[i - 1] !== '--host') : ['read', 'right', 'two'])
  const audios: Array<{ label: string; buf: Buffer; cfg: AudioCfg }> = []
  if (fileIdx >= 0) {
    const a = loadAudio(args[fileIdx + 1])
    audios.push(a)
  } else {
    for (const w of words) {
      try {
        const buf = await synthesizeEn(w)
        audios.push({ label: w, buf, cfg: { encoding: 'lame', format: 'audio/mpeg' } })
      } catch (e) {
        console.log(`[${w}] 合成失败：${(e as Error).message}`)
      }
    }
  }
  for (const { label, buf, cfg } of audios) {
    for (const multi of [false, true]) {
      const r = await iat(buf, multi, cfg, host)
      console.log(`\n=== ${label} | ${multi ? 'nbest=5&wbest=5' : '默认参数'} ===`)
      console.log(`code=${r.code} ${r.message} frames=${r.frames} kb=${Math.round(buf.length / 1024)}`)
      console.log(`文本：${r.texts[0] || '（空）'}`)
      if (multi) console.log(`各 ws 候选：${JSON.stringify(r.cw)}`)
    }
  }
}

main().catch((e) => {
  console.error((e as Error).message || e)
  process.exit(1)
})

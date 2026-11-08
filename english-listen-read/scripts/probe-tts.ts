/**
 * 超拟人合成发音人探测：逐个试 vcn，输出业务码与音频字节数。
 * 用途：确认当前 APPID 到底授权了哪些中英文发音人（英文字符量 / 发音人权限是独立授权）。
 * 密钥只在 Node 进程内使用，不打印任何凭据。
 *
 * 用法：
 *   node --experimental-strip-types scripts/probe-tts.ts [zh|en] [自定义 vcn...]
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

function signedWsUrl(endpoint: string, hostOverride?: string): string {
  const { scheme, host, path: p } = splitEndpoint(endpoint)
  const q = buildAuthQuery({
    path: p, method: 'GET', signHost: hostOverride || host,
    apiKey: env.XFYUN_API_KEY, apiSecret: env.XFYUN_API_SECRET,
  })
  return `${scheme === 'https' ? 'wss' : 'ws'}://${host}${p}?${q}`
}

interface Attempt { code: number; message: string; bytes: number }

function synth(vcn: string, text: string): Promise<Attempt> {
  return new Promise((resolve) => {
    const frames: Array<{ seq: number; audio: string }> = []
    let done = false
    const ws = new WebSocket(signedWsUrl(env.XFYUN_TTS_WSS))
    const end = (r: Attempt) => {
      if (done) return
      done = true
      clearTimeout(timer)
      try { ws.close() } catch (_) { /* ignore */ }
      resolve(r)
    }
    const timer = setTimeout(() => end({ code: -1, message: '超时', bytes: 0 }), 45000)
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
          text: { encoding: 'utf8', compress: 'raw', format: 'plain', status: 2, seq: 0, text: Buffer.from(text, 'utf8').toString('base64') },
        },
      }))
    }
    ws.onmessage = (ev: MessageEvent) => {
      let f: { header?: { code?: number; message?: string }; payload?: { audio?: { audio?: string; seq?: number; status?: number } } }
      try { f = JSON.parse(String(ev.data)) } catch (_) { return }
      const code = f.header?.code
      if (code !== undefined && code !== 0) { end({ code, message: f.header?.message || '', bytes: 0 }); return }
      const a = f.payload?.audio
      if (a?.audio) frames.push({ seq: Number(a.seq ?? frames.length), audio: a.audio })
      if ((a?.status ?? 0) === 2) {
        const bytes = [...frames].sort((x, y) => x.seq - y.seq).reduce((n, x) => n + x.audio.length, 0)
        end({ code: 0, message: 'ok', bytes })
      }
    }
    ws.onerror = () => end({ code: -2, message: '连接失败', bytes: 0 })
    ws.onclose = () => end({ code: -3, message: '提前关闭', bytes: 0 })
  })
}

const ZH_CANDIDATES = ['x5_lingxiaoxuan_flow', 'x4_lingxiaoxuan_oral', 'x5_lingxiaoyue_flow', 'x5_lingyuyan_flow', 'x6_lingxiaoyue_pro', 'x4_ziyang_oral', 'x5_lingfeiyi_flow']
const EN_CANDIDATES = ['x5_EnUs_Grant_flow', 'x5_EnUs_Lila_flow', 'x4_EnUs_Lila_emo', 'x6_ap_pro_EN', 'x6_xinyun_pro_EN', 'x7_ap_en_pro', 'x4_EnUs_Grant_emo']

async function main() {
  const args = process.argv.slice(2)
  const lang = args[0] === 'en' ? 'en' : 'zh'
  const custom = args.slice(1)
  const list = custom.length ? custom : (lang === 'en' ? EN_CANDIDATES : ZH_CANDIDATES)
  const text = lang === 'en' ? 'apple, a round fruit' : '苹果，一种圆形水果'
  console.log(`语言：${lang}　候选 ${list.length} 个　（当前配置：${lang === 'en' ? env.XFYUN_TTS_VCN_EN : env.XFYUN_TTS_VCN_ZH}）`)
  for (const vcn of list) {
    const r = await synth(vcn, text)
    const mark = r.code === 0 ? '可用' : '不可用'
    console.log(`${mark.padEnd(4)} ${vcn.padEnd(26)} code=${String(r.code).padEnd(6)} bytes=${String(r.bytes).padEnd(7)} ${r.message.slice(0, 60)}`)
  }
}

void main()

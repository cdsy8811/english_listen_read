import type { IncomingMessage, ServerResponse } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vite'
import type { Plugin, ViteDevServer } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'
import { buildAuthQuery, splitEndpoint } from './src/api/xfyun-sign.ts'

/**
 * 构建期自动分片注入。
 * 不通过 define/import.meta.env 注入明文：密钥只以「分片 + 异或」形式
 * 落在 src/api/generated/credentials.ts（本地、gitignore），运行时拼接。
 * 这样 Vite 产物里也不会出现整串明文。
 */
function credentialShardsPlugin() {
  return {
    name: 'elr-credential-shards',
    enforce: 'pre' as const,
    buildStart() {
      // 延迟 import，避免 CLI 首次解析配置时因 .env.local 缺失而中断
      return import('./scripts/credentials.mjs').then((m) => {
        const r = m.generateCredentials()
        if (!r.ok) {
          // 构建期提示：只说缺文件，不打印任何键名或值
          console.warn('未找到 .env.local：请先运行 npm run prepare:env（打包前必须）')
        }
      })
    },
  }
}

/**
 * H5 仅作界面预览：产物中不得出现任何密钥分片。
 * 方案 C 的授权边界是「密钥只存在于产物 APK」，浏览器包一律换成空占位。
 */
function h5CredentialGuardPlugin() {
  return {
    name: 'elr-h5-no-credentials',
    enforce: 'pre' as const,
    load(id: string) {
      if (id.replace(/\\/g, '/').includes('/src/api/generated/credentials.ts')) {
        return [
          'export const CREDENTIALS_READY = false',
          'export const MISSING_KEYS = ["__H5_PREVIEW__"]',
          'export const PUBLIC_CONFIG = {}',
          'export function reveal() { return "" }',
        ].join('\n')
      }
      return null
    },
  }
}

/**
 * H5 开发预览用的本地云能力代理（仅 dev server 生效，不进任何产物）。
 * 目的：浏览器里也能真正跑「拍照 OCR → 抽取」，同时保证
 *  1) 密钥只在 Node 进程内存里使用，绝不出现在浏览器代码 / 请求里；
 *  2) 浏览器只访问同源 /__dev/xfyun/*，不触发 CORS。
 * 生产构建（build）时本插件完全不注册，APK / H5 产物都不含此逻辑。
 */
function readDevEnv(): Record<string, string> {
  const file = path.join(__dirname, '.env.local')
  if (!fs.existsSync(file)) return {}
  const out: Record<string, string> = {}
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (m) out[m[1]] = m[2]
  }
  return out
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      // 单张图 base64 ≤ 4M，留一倍余量防滥用
      if (size > 12 * 1024 * 1024) { reject(new Error('请求体过大')); return }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', () => reject(new Error('读取请求失败')))
  })
}

/**
 * H5 预览用的超拟人合成转发：Node 侧建 WSS、按 seq 收帧、返回 base64 mp3。
 * 只给 `npm run dev:h5` 用；App 端仍由客户端自己签名直连，产物里没有这段代码。
 */
function ttsOverWs(url: string, body: unknown, timeoutMs = 60000): Promise<string> {
  return new Promise((resolve, reject) => {
    const frames: Array<{ seq: number; audio: string }> = []
    let done = false
    const socket = new WebSocket(url)
    const timer = setTimeout(() => {
      try { socket.close() } catch (_) { /* ignore */ }
      finish(() => reject(new Error('合成超时')))
    }, timeoutMs)
    const finish = (fn: () => void) => {
      if (done) return
      done = true
      clearTimeout(timer)
      fn()
    }
    socket.onopen = () => socket.send(JSON.stringify(body))
    socket.onmessage = (ev: MessageEvent) => {
      let frame: { header?: { code?: number; message?: string }; payload?: { audio?: { audio?: string; seq?: number; status?: number } } }
      try { frame = JSON.parse(String(ev.data)) } catch (_) { return }
      const code = frame.header?.code
      if (code !== undefined && code !== 0) {
        finish(() => {
          try { socket.close() } catch (_) { /* ignore */ }
          reject(new Error(`合成失败 code=${code} ${frame.header?.message || ''}`))
        })
        return
      }
      const a = frame.payload?.audio
      if (a?.audio) frames.push({ seq: Number(a.seq ?? 0), audio: a.audio })
      if ((a?.status ?? 0) === 2) {
        finish(() => {
          try { socket.close() } catch (_) { /* ignore */ }
          if (!frames.length) { reject(new Error('合成未返回音频')); return }
          // 逐帧解码再合并：单帧 base64 自带补位，字符串直接拼接会在补位处截断
          const merged = Buffer.concat([...frames].sort((x, y) => x.seq - y.seq).map((f) => Buffer.from(f.audio, 'base64')))
          resolve(merged.toString('base64'))
        })
      }
    }
    socket.onerror = () => finish(() => reject(new Error('合成连接失败')))
    socket.onclose = () => finish(() => reject(new Error('合成连接提前关闭')))
  })
}

function devCloudProxyPlugin(): Plugin {
  return {
    name: 'elr-dev-cloud-proxy',
    // 只在 vite dev server 挂载；build 阶段不注册
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      const env = readDevEnv()
      const ready = !!(env.XFYUN_APPID && env.XFYUN_API_KEY && env.XFYUN_API_SECRET && env.XFYUN_MAAS_API_KEY && env.XFYUN_OCR_URL)

      server.middlewares.use('/__dev/xfyun', (req: IncomingMessage, res: ServerResponse) => {
        const route = String(req.url || '').replace(/\?.*$/, '').replace(/^\//, '')
        const fail = (code: number, message: string) => {
          res.statusCode = code
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ header: { code, message }, error: { message, code: String(code) } }))
        }
        void (async () => {
          if (!ready) { fail(503, '本机缺少 .env.local 凭据，请先运行 npm run prepare:env'); return }
          const raw = await readRequestBody(req)
          let parsed: { body?: Record<string, unknown> } = {}
          try { parsed = JSON.parse(raw || '{}') as { body?: Record<string, unknown> } } catch (_) { fail(400, '请求体不是合法 JSON'); return }
          const body = (parsed.body || {}) as Record<string, unknown>

          if (route === 'ocr') {
            const header = { ...(body.header as Record<string, unknown> | undefined), app_id: env.XFYUN_APPID, status: 0 }
            const parts = splitEndpoint(env.XFYUN_OCR_URL)
            const q = buildAuthQuery({
              path: parts.path,
              method: 'POST',
              signHost: env.XFYUN_OCR_SIGN_HOST || parts.host,
              apiKey: env.XFYUN_API_KEY,
              apiSecret: env.XFYUN_API_SECRET,
            })
            const r = await fetch(`${parts.scheme}://${parts.host}${parts.path}?${q}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...body, header }),
              signal: AbortSignal.timeout(120000),
            })
            const text = await r.text()
            console.log(`[dev-proxy] ocr → ${r.status}`)
            res.statusCode = r.status
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(text)
            return
          }

          if (route === 'chat') {
            const url = `${String(env.XFYUN_MAAS_BASE_URL || '').replace(/\/$/, '')}/chat/completions`
            const r = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.XFYUN_MAAS_API_KEY}` },
              body: JSON.stringify(body),
              signal: AbortSignal.timeout(150000),
            })
            const text = await r.text()
            console.log(`[dev-proxy] chat → ${r.status}`)
            res.statusCode = r.status
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(text)
            return
          }

          if (route === 'tts') {
            const text = String(body.text || '')
            if (!text.trim()) { fail(400, '缺少待合成文本'); return }
            const lang = body.lang === 'en' ? 'en' : 'zh'
            const vcn = lang === 'en' ? env.XFYUN_TTS_VCN_EN : env.XFYUN_TTS_VCN_ZH
            if (!vcn) { fail(503, '本机缺少对应语种的发音人配置'); return }
            const mult = Math.min(2, Math.max(0.5, Number(body.speed) || 1))
            const volume = Math.min(100, Math.max(0, Number(body.volume ?? 100)))
            const parts = splitEndpoint(env.XFYUN_TTS_WSS)
            const q = buildAuthQuery({
              path: parts.path,
              method: 'GET',
              signHost: parts.host,
              apiKey: env.XFYUN_API_KEY,
              apiSecret: env.XFYUN_API_SECRET,
            })
            const wsUrl = `${parts.scheme === 'https' ? 'wss' : 'ws'}://${parts.host}${parts.path}?${q}`
            const audio = await ttsOverWs(wsUrl, {
              header: { app_id: env.XFYUN_APPID, status: 2 },
              parameter: {
                tts: {
                  vcn,
                  speed: Math.round(mult * 50),
                  volume: Math.round(volume),
                  pitch: 50,
                  audio: { encoding: 'lame', sample_rate: 16000, channels: 1, bit_depth: 16 },
                },
              },
              payload: {
                text: {
                  encoding: 'utf8', compress: 'raw', format: 'plain', status: 2, seq: 0,
                  text: Buffer.from(text, 'utf8').toString('base64'),
                },
              },
            })
            console.log('[dev-proxy] tts → 200')
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ header: { code: 0 }, audio, format: 'mp3' }))
            return
          }

          fail(404, `未知的代理路径：${route}`)
        })().catch((e: Error) => fail(502, `本机代理转发失败：${e.message}`))
      })
    },
  }
}

// UNI_PLATFORM 由 uni CLI 注入；npm script 名带 h5 时再兜一层，避免漏判
const h5Hint = /h5/i.test(process.env.npm_lifecycle_event || '')
const isAppBuild = (process.env.UNI_PLATFORM || (h5Hint ? 'h5' : 'app')) === 'app'

export default defineConfig({
  plugins: [
    credentialShardsPlugin(),
    ...(isAppBuild ? [] : [h5CredentialGuardPlugin(), devCloudProxyPlugin()]),
    uni(),
  ],
  // 本地工程目录；envPrefix 不匹配任何 XFYUN_*，Vite 不会把 .env.local 内联进产物
  envDir: __dirname,
  // 不使用 VITE_ 前缀变量注入，避免任何环境变量被 Vite 明文内联
  envPrefix: 'ELR_NO_INLINE_',
  define: {
    // 只注入非敏感的运行模式标记
    __ELR_BUILD_TARGET__: JSON.stringify(process.env.UNI_PLATFORM || 'app'),
  },
  build: {
    // 云打包开启压缩混淆；本地自测构建也保持同样行为
    minify: 'terser',
    terserOptions: {
      compress: { drop_console: false, drop_debugger: true },
      mangle: true,
      format: { comments: false },
    },
    sourcemap: false,
  },
})

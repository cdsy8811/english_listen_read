/**
 * 本地端到端探测：图片 → OCR → X2.6 抽取 → 清洗。
 * 用途：不需要 APK 也能验证识别链路（密钥只在 Node 进程内使用，不落盘、不打印）。
 *
 * 用法：
 *   node --experimental-strip-types scripts/probe-recognize.ts <图片路径>
 */
import fs from 'node:fs'
import path from 'node:path'
import { buildAuthQuery, splitEndpoint } from '../src/api/xfyun-sign.ts'
import { base64ToUtf8, utf8Decode } from '../src/utils/crypto.ts'
import { extractMessages, normalizeDrafts } from '../src/services/parser.ts'
import { parsePlainTextDrafts } from '../src/services/parser-text.ts'

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

function signedUrlOf(endpoint: string, method: 'GET' | 'POST', signHost?: string): string {
  const parts = splitEndpoint(endpoint)
  const q = buildAuthQuery({
    path: parts.path,
    method,
    signHost: signHost || parts.host,
    apiKey: env.XFYUN_API_KEY,
    apiSecret: env.XFYUN_API_SECRET,
  })
  return `${parts.scheme}://${parts.host}${parts.path}?${q}`
}

async function ocr(imagePath: string): Promise<string> {
  const base64 = fs.readFileSync(imagePath).toString('base64')
  console.log(`图片大小 ${(fs.statSync(imagePath).size / 1024).toFixed(0)}KB，base64 ${(base64.length / 1024).toFixed(0)}KB`)
  const url = signedUrlOf(env.XFYUN_OCR_URL, 'POST', env.XFYUN_OCR_SIGN_HOST)
  const body = {
    header: { app_id: env.XFYUN_APPID, status: 0 },
    parameter: {
      ocr: {
        result_option: 'normal',
        result_format: 'json,markdown',
        output_type: 'one_shot',
        rotation_min_angle: 5,
        result: { encoding: 'utf8', compress: 'raw', format: 'plain' },
      },
    },
    payload: { image: { encoding: 'jpg', image: base64, status: 0, seq: 0 } },
  }
  const t0 = Date.now()
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const json = await r.json() as {
    header?: { code?: number; message?: string; sid?: string }
    payload?: { result?: { text?: string; compress?: string } }
  }
  console.log(`OCR HTTP ${r.status}，耗时 ${Date.now() - t0}ms，header.code=${json.header?.code} ${json.header?.message || ''} sid=${json.header?.sid || ''}`)
  if (json.header?.code !== 0) throw new Error('OCR 失败')
  const text = json.payload?.result?.text
  if (!text) throw new Error('OCR 无 text')
  if (json.payload?.result?.compress === 'gzip') throw new Error('OCR 结果被 gzip 压缩')
  const decoded = base64ToUtf8(text)
  const obj = JSON.parse(decoded) as { document?: Array<{ name?: string; value?: string }> }
  const docs = (obj.document || []).filter((d) => d?.value)
  console.log(`document 段数 ${docs.length}：${docs.map((d) => d.name).join(', ')}`)
  const md = docs.filter((d) => d.name === 'markdown').map((d) => d.value as string)
  return (md.length ? md : docs.map((d) => d.value as string)).join('\n')
}

async function extract(markdown: string): Promise<unknown[]> {
  const url = `${env.XFYUN_MAAS_BASE_URL.replace(/\/$/, '')}/chat/completions`
  const body = {
    model: env.XFYUN_MAAS_MODEL,
    messages: extractMessages(markdown),
    stream: false,
    temperature: 0.1,
    max_tokens: 4096,
    // 与 App 保持一致：关闭思考，否则 reasoning 会吃光 max_tokens 导致 content 为空
    thinking: { type: 'disabled' },
  }
  const t0 = Date.now()
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.XFYUN_MAAS_API_KEY}` },
    body: JSON.stringify(body),
  })
  const json = await r.json() as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } }
  console.log(`抽取 HTTP ${r.status}，耗时 ${Date.now() - t0}ms${json.error ? '，错误：' + json.error.message : ''}`)
  const content = json.choices?.[0]?.message?.content || ''
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    const obj = JSON.parse(cleaned) as { items?: unknown[] }
    return obj.items || []
  } catch (_) {
    console.log('--- 模型原始返回（前 600 字）---')
    console.log(utf8Decode(cleaned.slice(0, 600)))
    throw new Error('模型返回不是合法 JSON')
  }
}

const img = process.argv[2]
if (!img) { console.error('用法：node --experimental-strip-types scripts/probe-recognize.ts <图片路径>'); process.exit(1) }

const markdown = await ocr(img)
console.log('=== OCR markdown（前 1200 字）===')
console.log(markdown.slice(0, 1200))
console.log(`=== 总字符数 ${markdown.length} ===`)

const items = await extract(markdown)
console.log(`=== 模型返回 ${items.length} 条原始词条 ===`)
console.log(JSON.stringify(items, null, 1).slice(0, 1500))

const drafts = normalizeDrafts(items)
console.log(`=== 清洗后 ${drafts.length} 条 ===`)
for (const d of drafts) console.log(`${d.word.padEnd(12)} ${d.phonetic.padEnd(18)} ${d.pos.padEnd(6)} ${d.translation}`)

console.log(`=== 本地纯文本解析对照（${parsePlainTextDrafts(markdown).length} 条）===`)

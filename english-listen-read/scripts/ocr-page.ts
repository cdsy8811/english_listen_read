/**
 * 单页 OCR 探针：图片 → 讯飞通用文档识别 → markdown 文本。
 * 只做 OCR，不做大模型抽取；密钥只在 Node 进程内使用，不打印。
 *
 * 用法：node --experimental-strip-types scripts/ocr-page.ts <图片> [输出md文件]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildAuthQuery, splitEndpoint } from '../src/api/xfyun-sign.ts'
import { base64ToUtf8 } from '../src/utils/crypto.ts'

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

export async function ocrMarkdown(imagePath: string): Promise<string> {
  const base64 = fs.readFileSync(imagePath).toString('base64')
  const parts = splitEndpoint(env.XFYUN_OCR_URL)
  const q = buildAuthQuery({
    path: parts.path, method: 'POST',
    signHost: env.XFYUN_OCR_SIGN_HOST || parts.host,
    apiKey: env.XFYUN_API_KEY, apiSecret: env.XFYUN_API_SECRET,
  })
  const url = `${parts.scheme}://${parts.host}${parts.path}?${q}`
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
  const r = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(120000),
  })
  const json = await r.json() as {
    header?: { code?: number; message?: string; sid?: string }
    payload?: { result?: { text?: string; compress?: string } }
  }
  if (json.header?.code !== 0) {
    throw new Error(`OCR 失败 code=${json.header?.code} ${json.header?.message || ''} sid=${json.header?.sid || ''}`)
  }
  const text = json.payload?.result?.text
  if (!text) throw new Error('OCR 无 text')
  if (json.payload?.result?.compress === 'gzip') throw new Error('OCR 结果为 gzip，暂不支持')
  const decoded = base64ToUtf8(text)
  const obj = JSON.parse(decoded) as { document?: Array<{ name?: string; value?: string }> }
  const docs = (obj.document || []).filter((d) => d?.value)
  const md = docs.filter((d) => d.name === 'markdown').map((d) => d.value as string)
  return (md.length ? md : docs.map((d) => d.value as string)).join('\n')
}

async function main() {
  const img = process.argv[2]
  const out = process.argv[3]
  if (!img) throw new Error('用法：node --experimental-strip-types scripts/ocr-page.ts <图片> [输出md]')
  const md = await ocrMarkdown(img)
  if (out) fs.writeFileSync(out, md, 'utf8')
  console.log(`OCR ${path.basename(img)} → ${md.length} 字${out ? `，已写入 ${out}` : ''}`)
  if (!out) console.log(md.slice(0, 3000))
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  void main().catch((e: Error) => { console.error('错误：' + e.message); process.exitCode = 1 })
}

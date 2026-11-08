/**
 * 通用文档识别（OCR 大模型 se75ocrbm，HTTPS POST）。
 * P0 实测要点：
 *  - 三段式请求体：header.app_id + parameter.ocr + payload.image.image（base64 ≤4M）
 *  - result_format=json,markdown；rotation_min_angle=5 自动旋正
 *  - header.code == 0 才成功；sid 留档排错
 *  - payload.result.text 也是 base64，解码后是含 document[] + image[] 的 JSON，
 *    只取 document[].value 的 markdown（实测 6909 字 vs 190 字），别整包喂模型
 */
import { httpJson, signedPostUrl } from './http.ts'
import { ENDPOINTS, appId } from './runtime-config.ts'
import { base64ToUtf8 } from '../utils/crypto.ts'
import { CloudError, logger } from '../utils/log.ts'
import { dedupe, withRetry } from '../utils/retry.ts'

export interface OcrRawResponse {
  header?: { code?: number; message?: string; sid?: string }
  payload?: { result?: { text?: string; compress?: string; encoding?: string; format?: string } }
}

/** 从 OCR 响应中取出 markdown 原文（纯函数，可离线自测）。 */
export function pickDocumentText(decoded: string): { markdown: string; note: string } {
  try {
    const obj = JSON.parse(decoded) as {
      document?: Array<{ name?: string; value?: string }>
      image?: unknown[]
    }
    const docs = (obj.document || []).filter((d) => d && typeof d.value === 'string')
    if (docs.length) {
      const names = docs.map((d) => d.name || '').join(', ')
      const md = docs.filter((d) => d.name === 'markdown' && d.value).map((d) => d.value as string)
      const chosen = (md.length ? md : docs.map((d) => d.value as string)).join('\n')
      return { markdown: chosen, note: `取 document 文本（${docs.length} 段：${names}）` }
    }
  } catch (_) { /* 解码后不是 JSON，直接当纯文本使用 */ }
  return { markdown: decoded, note: '未解析出 document 结构，原样使用' }
}

/** 解码 payload.result.text：base64 → UTF-8；（gzip 时提示，App 端不引解压库）。 */
export function decodeOcrResult(res: OcrRawResponse): { markdown: string; sid?: string; note: string } {
  const header = res.header || {}
  if (header.code !== 0) {
    throw new CloudError(`识别失败（code=${header.code ?? '?'}）：${header.message || '未知原因'}`, header.code ?? -1, header.sid)
  }
  const result = res.payload?.result
  if (!result?.text) throw new CloudError('识别结果为空', -2, header.sid)
  if (result.compress === 'gzip') {
    // 第一版请求显式 compress=raw，实测返回 raw；若服务端改行为则明确报错而非静默乱码
    throw new CloudError('识别结果被压缩，请重试（本版未启用 gzip 解压）', -3, header.sid, true)
  }
  const decoded = base64ToUtf8(result.text)
  const { markdown, note } = pickDocumentText(decoded)
  return { markdown, sid: header.sid, note: `${note}；base64 解码成功` }
}

/** 真正发一次 OCR 请求；按图片内容做请求合并，避免重复计费。 */
export async function recognizeRaw(imageBase64: string, encoding = 'jpg'): Promise<string> {
  if (!imageBase64) throw new CloudError('没有可识别的图片', -4)
  // base64 编码后 ≤4M（接口保守口径）
  if (imageBase64.length > 4 * 1024 * 1024) throw new CloudError('图片过大，请先压缩后再识别', -5)
  return dedupe(`ocr:${imageBase64.length}:${imageBase64.slice(0, 64)}`, async () => {
    const run = async () => {
      // 现用现签：每次请求重新生成 date 与签名。
      // H5 开发预览没有凭据（也没必要有），URL 由本机代理拼装，这里留空即可。
      const url = ENDPOINTS.ocrUrl ? signedPostUrl(ENDPOINTS.ocrUrl, ENDPOINTS.ocrSignHost || undefined) : ''
      const body = {
        header: { app_id: appId(), status: 0 },
        parameter: {
          ocr: {
            result_option: 'normal',
            result_format: 'json,markdown',
            output_type: 'one_shot',
            rotation_min_angle: 5,
            result: { encoding: 'utf8', compress: 'raw', format: 'plain' },
          },
        },
        payload: { image: { encoding, image: imageBase64, status: 0, seq: 0 } },
      }
      // 日志只打路径，不打完整鉴权 URL / app_id / 图片 base64
      logger.info('ocr.request', { path: ENDPOINTS.ocrUrl.split('?')[0], sizeKB: Math.round(imageBase64.length / 1024) })
      const res = await httpJson<OcrRawResponse>({ url, method: 'POST', data: body, timeout: 30000, retry: false, route: 'ocr' })
      const out = decodeOcrResult(res)
      logger.info('ocr.ok', { note: out.note, chars: out.markdown.length, sid: out.sid })
      return out.markdown
    }
    return withRetry(run, { retries: 2 })
  })
}

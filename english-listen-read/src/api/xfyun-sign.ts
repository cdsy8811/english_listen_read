/**
 * 讯飞私有接口 HMAC-SHA256 签名（OCR / 听写 / 合成共用）。
 * 与 tools/probe_xfyun.py 的 auth_query() 逻辑严格等价，已由 tests/sign.test.ts 对拍验证。
 *
 * 现用现签：不缓存签名 URL（date 容差 ±300s，缓存会过期导致 401）。
 * 本模块只做纯计算，不读配置、不读 uni API，密钥由调用方显式传入。
 */

import { base64Encode, hmacSha256, quotePlus, utf8Encode } from '../utils/crypto.ts'

export interface SignOptions {
  /** 请求路径，如 /v1/private/se75ocrbm */
  path: string
  /** WSS 用 GET，OCR 用 POST */
  method: 'GET' | 'POST'
  /** 参与签名的 host（OCR 默认与实际域名一致，可用 XFYUN_OCR_SIGN_HOST 覆盖） */
  signHost: string
  apiKey: string
  apiSecret: string
  /** 便于测试注入固定时间；生产留空表示取当前 GMT */
  date?: string
}

/** RFC1123 GMT，等价 Python email.utils.formatdate(usegmt=True)。 */
export function rfc1123Gmt(d: Date = new Date()): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const p = (n: number) => String(n).padStart(2, '0')
  return `${days[d.getUTCDay()]}, ${p(d.getUTCDate())} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} GMT`
}

/** 生成签名查询串（不含 ?）。date 与 Python 保持一致：单次签名内复用同一个值。 */
export function buildAuthQuery(o: SignOptions): string {
  const date = o.date ?? rfc1123Gmt()
  const origin = `host: ${o.signHost}\ndate: ${date}\n${o.method} ${o.path} HTTP/1.1`
  const signature = base64Encode(hmacSha256(utf8Encode(o.apiSecret), utf8Encode(origin)))
  const authOrigin =
    `api_key="${o.apiKey}", algorithm="hmac-sha256", ` +
    `headers="host date request-line", signature="${signature}"`
  const authorization = base64Encode(utf8Encode(authOrigin))
  return `host=${quotePlus(o.signHost)}&date=${quotePlus(date)}&authorization=${quotePlus(authorization)}`
}

/**
 * 拼出完整带签名 URL。
 * requestHost 是实际连接域名；signHost 是参与签名的域名（两者可不同，OCR 实测均可用）。
 */
export function signedUrl(o: SignOptions & { scheme: 'https' | 'wss'; requestHost: string }): string {
  const q = buildAuthQuery(o)
  return `${o.scheme}://${o.requestHost}${o.path}?${q}`
}

/** 从完整 URL 提取 host / path，供 .env 配置的地址复用。 */
export function splitEndpoint(url: string): { scheme: 'https' | 'wss'; host: string; path: string } {
  const m = /^(https|wss):\/\/([^/]+)(\/.*)$/.exec(url)
  if (!m) throw new Error('端点地址格式不正确')
  return { scheme: m[1] as 'https' | 'wss', host: m[2], path: m[3] }
}

/**
 * 统一日志脱敏（App 运行时同样生效）。
 * 禁止输出：Authorization、签名串、完整鉴权 URL（含查询参数）、请求体中的 app_id、图片 base64。
 * 只输出方法名 / 路径 / 状态码 / 业务错误码 / sid。
 */

type Level = 'info' | 'warn' | 'error'

const SENSITIVE_KEYS = [
  'authorization', 'api_key', 'apikey', 'apisecret', 'api_secret',
  'signature', 'app_id', 'appid', 'image', 'audio', 'text', 'token', 'secret',
]

/** 去掉 URL 的查询参数，且不保留任何鉴权信息。 */
export function safeUrl(url: string): string {
  try {
    const i = url.indexOf('?')
    const base = i >= 0 ? url.slice(0, i) : url
    // 只保留协议 + host + path，去掉可能的凭据片段
    return base.replace(/\/\/(?:[^/@]+@)/, '//')
  } catch (_) {
    return '<url>'
  }
}

/** 递归脱敏任意对象；返回可安全打印的浅摘要。 */
export function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 3) return '…'
  if (value == null) return value
  if (typeof value === 'string') {
    if (/^https?:\/\//.test(value) || /^wss?:\/\//.test(value)) return safeUrl(value)
    if (value.length > 160) return `<省略 ${value.length} 字符>`
    return value
  }
  if (typeof value !== 'object') return value
  if (Array.isArray(value)) return value.slice(0, 3).map((v) => sanitize(v, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.includes(k.toLowerCase())) out[k] = '<已脱敏>'
    else out[k] = sanitize(v, depth + 1)
  }
  return out
}

function emit(level: Level, tag: string, payload?: unknown) {
  const safe = payload === undefined ? '' : JSON.stringify(sanitize(payload))
  const line = `[${tag}] ${safe}`
  // 生产包保留 warn/error 便于排障，但内容一律经过 sanitize
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const logger = {
  info: (tag: string, p?: unknown) => emit('info', tag, p),
  warn: (tag: string, p?: unknown) => emit('warn', tag, p),
  error: (tag: string, p?: unknown) => emit('error', tag, p),
}

/** 业务错误对象：只暴露给人看的文案，不携带请求上下文。 */
export class CloudError extends Error {
  readonly code: number
  readonly sid?: string
  readonly retryable: boolean
  constructor(message: string, code = 0, sid?: string, retryable = false) {
    super(message)
    this.name = 'CloudError'
    this.code = code
    this.sid = sid
    this.retryable = retryable
  }
}

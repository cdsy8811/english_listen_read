/**
 * 统一日志脱敏（App 运行时同样生效）。
 * 禁止输出：Authorization、签名串、完整鉴权 URL（含查询参数）、请求体中的 app_id、图片 base64。
 * 只输出方法名 / 路径 / 状态码 / 业务错误码 / sid。
 */

export type Level = 'debug' | 'info' | 'warn' | 'error'

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }

/** 默认全开（排障期）：需要安静时在 App.vue / 设置页调 setLogLevel('warn')。 */
let threshold: Level = 'debug'

export function setLogLevel(level: Level): void {
  threshold = level
}

export function getLogLevel(): Level {
  return threshold
}

/**
 * 机内日志环（最近 300 行）：APK 里看不到控制台，练习页的「排障日志」面板读这里，
 * 用户可直接复制回传给开发。写入内容与 console 完全一致（已脱敏）。
 */
const HISTORY_MAX = 300
const history: string[] = []
let version = 0

export function logHistory(): string[] {
  return history.slice()
}

export function logVersion(): number {
  return version
}

export function clearLogHistory(): void {
  history.length = 0
  version++
}

function stamp(): string {
  const d = new Date()
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}

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
  if (ORDER[level] < ORDER[threshold]) return
  const safe = payload === undefined ? '' : JSON.stringify(sanitize(payload))
  const line = `${stamp()} [${tag}] ${safe}`
  history.push(line)
  if (history.length > HISTORY_MAX) history.splice(0, history.length - HISTORY_MAX)
  version++
  // 生产包保留 warn/error 便于排障，但内容一律经过 sanitize
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else if (level === 'debug' && typeof console.debug === 'function') console.debug(line)
  else console.log(line)
}

/** 错误摘要：只取 message / errMsg / code，截断后输出，避免把整个对象带进日志。 */
export function errText(e: unknown): string {
  if (e == null) return ''
  if (typeof e === 'string') return e.slice(0, 160)
  if (typeof e === 'object') {
    const o = e as { message?: unknown; errMsg?: unknown; code?: unknown }
    const v = o.message ?? o.errMsg ?? o.code
    if (v != null) return String(v).slice(0, 160)
  }
  return String(e).slice(0, 160)
}

/** 估算对象体积（不 stringify，避免图片 base64 造成大块临时内存）。 */
export function approxBytes(v: unknown, depth = 0): number {
  if (depth > 4) return 0
  if (v == null) return 0
  if (typeof v === 'string') return v.length
  if (typeof v === 'number' || typeof v === 'boolean') return 8
  if (Array.isArray(v)) return v.reduce<number>((n, x) => n + approxBytes(x, depth + 1), 0)
  if (typeof v === 'object') {
    return Object.values(v as Record<string, unknown>).reduce<number>((n, x) => n + approxBytes(x, depth + 1), 0)
  }
  return 0
}

/** 字节 → 日志用 KB（保留 1 位，负数归零）。 */
export function kb(n: number): number {
  return Math.max(0, Math.round((n / 1024) * 10) / 10)
}

export const logger = {
  debug: (tag: string, p?: unknown) => emit('debug', tag, p),
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

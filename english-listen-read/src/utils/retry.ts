/** 通用退避重试（纯逻辑，可在 Node 侧自测）。免费额度会 429，所有云调用统一走这里。 */

export interface RetryOptions {
  retries?: number
  baseDelayMs?: number
  maxDelayMs?: number
  /** 判定是否可重试；默认 429 / 5xx / 网络错误可重试 */
  shouldRetry?: (err: unknown, attempt: number) => boolean
  /** 注入 sleep 便于测试 */
  sleep?: (ms: number) => Promise<void>
}

export const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** 指数退避 + 抖动，避免多请求同时重试打满额度。 */
export function backoffDelay(attempt: number, base = 600, max = 12000): number {
  const raw = Math.min(max, base * Math.pow(2, attempt))
  return Math.min(max, Math.round(raw * (0.75 + Math.random() * 0.5)))
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 408 || status === 425 || (status >= 500 && status < 600)
}

export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 2
  const sleep = opts.sleep ?? defaultSleep
  let last: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt)
    } catch (err) {
      last = err
      const status = (err as { statusCode?: number; code?: number })?.statusCode
        ?? (err as { statusCode?: number; code?: number })?.code ?? 0
      const retryable = opts.shouldRetry
        ? opts.shouldRetry(err, attempt)
        : status === 0 || isRetryableStatus(status) || (err as { retryable?: boolean })?.retryable === true
      if (attempt >= retries || !retryable) break
      await sleep(backoffDelay(attempt, opts.baseDelayMs, opts.maxDelayMs))
    }
  }
  throw last
}

/**
 * 请求合并：同一 key 的并发请求复用同一个 Promise，避免重复计费。
 * 用于同一段文本的 TTS 合成 / 同一张图的 OCR。
 */
const inflight = new Map<string, Promise<unknown>>()
export function dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = inflight.get(key)
  if (hit) return hit as Promise<T>
  const p = fn().finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

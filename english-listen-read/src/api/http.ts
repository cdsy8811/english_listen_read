/**
 * 统一网络层：uni.request（MaaS / OCR）与 uni.connectSocket（听写 / 合成）。
 * App 端走原生网络栈，不受 CORS 限制；不连任何自建后端。
 * 日志只打方法 / 路径 / 状态码，绝不打带查询参数的 URL、Authorization、app_id、图片 base64。
 */
import { CloudError, approxBytes, errText, kb, logger, safeUrl } from '../utils/log.ts'
import { withRetry } from '../utils/retry.ts'
import { buildAuthQuery, splitEndpoint } from './xfyun-sign.ts'
import { apiKey, apiSecret } from './runtime-config.ts'

export interface RequestOptions {
  url: string
  method?: 'GET' | 'POST'
  data?: unknown
  header?: Record<string, string>
  timeout?: number
  /** 是否对 429 / 5xx 自动退避重试 */
  retry?: boolean
  /**
   * 云端能力标识：H5 开发预览下用来走本机代理（浏览器不自带密钥、也不跨域）。
   * App 端忽略此字段，正常直连讯飞。
   */
  route?: 'ocr' | 'chat'
  /** 内部排障用：同一次 httpJson 调用的关联 ID，不参与请求。 */
  traceId?: number
}

let reqSeq = 0
let wsSeq = 0
const startOf = (t0: number) => Date.now() - t0

interface UniRequestResult {
  statusCode: number
  data: unknown
  header: Record<string, string>
}

/** H5 开发预览：同源转发到 vite 本机代理（密钥只在 dev server 内使用，不进浏览器）。 */
async function requestViaDevProxy(o: RequestOptions): Promise<UniRequestResult> {
  const route = o.route
  if (!route) throw new CloudError('浏览器预览不支持直连讯飞', -1)
  const t0 = Date.now()
  logger.debug('net.proxy.req', { id: o.traceId, route, bodyKB: kb(approxBytes(o.data)) })
  let r: Response
  try {
    r = await fetch(`/__dev/xfyun/${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: o.data, header: o.header }),
    })
  } catch (e) {
    logger.warn('net.proxy.fail', { id: o.traceId, route, ms: startOf(t0), msg: errText(e) })
    throw new CloudError('本机识别代理未响应，请确认 npm run dev:h5 仍在运行', 0, undefined, true)
  }
  const text = await r.text()
  let data: unknown = text
  try { data = JSON.parse(text) } catch (_) { /* 非 JSON 原样交给上层报错 */ }
  logger.debug('net.proxy.res', { id: o.traceId, route, status: r.status, resKB: kb(text.length), ms: startOf(t0) })
  return { statusCode: r.status, data, header: {} }
}

function requestOnce(o: Required<Pick<RequestOptions, 'url' | 'method' | 'timeout'>> & RequestOptions): Promise<UniRequestResult> {
  return new Promise((resolve, reject) => {
    // #ifdef APP-PLUS
    uni.request({
      url: o.url,
      method: o.method,
      data: o.data as never,
      header: o.header,
      timeout: o.timeout,
      dataType: 'json',
      success: (res) => resolve({ statusCode: res.statusCode, data: res.data as unknown, header: res.header as Record<string, string> }),
      fail: (err) => {
        logger.warn('net.fail', { id: o.traceId, path: safeUrl(o.url), errMsg: (err as { errMsg?: string }).errMsg })
        reject(new CloudError('网络连接失败，请检查网络后重试', 0, undefined, true))
      },
    })
    // #endif
    // #ifndef APP-PLUS
    // H5 浏览器预览：讯飞接口不返回 CORS 头，且签名 / 凭据不应出现在浏览器请求里。
    // 开发期改走同源本机代理（vite 中间件里签名），生产构建则直接拒绝、不发请求。
    if (o.route && import.meta.env.DEV) {
      requestViaDevProxy(o).then(resolve).catch(reject)
      return
    }
    reject(new CloudError('浏览器预览不支持直连讯飞，请在 App 真机使用；拍照可切「文本录入」、作答可用输入框', -1))
    // #endif
  })
}

export async function httpJson<T = unknown>(o: RequestOptions): Promise<T> {
  const opts = { method: 'POST' as const, timeout: 30000, retry: true, ...o }
  const id = ++reqSeq
  const path = safeUrl(opts.url)
  const t0 = Date.now()
  opts.traceId = id
  logger.debug('net.req', {
    id, method: opts.method, path, bodyKB: kb(approxBytes(opts.data)),
    timeout: opts.timeout, retry: !!opts.retry,
  })
  const run = async (attempt = 0): Promise<T> => {
    const res = await requestOnce(opts)
    logger.debug('net.res', {
      id, attempt, path, status: res.statusCode,
      resKB: kb(approxBytes(res.data)), ms: startOf(t0),
    })
    if (res.statusCode === 429 || res.statusCode >= 500) {
      const e = new CloudError('服务繁忙，正在重试', res.statusCode, undefined, true)
      ;(e as CloudError & { statusCode: number }).statusCode = res.statusCode
      throw e
    }
    if (res.statusCode >= 400) {
      throw new CloudError(`请求失败（HTTP ${res.statusCode}）`, res.statusCode)
    }
    return res.data as T
  }
  try {
    return opts.retry ? await withRetry(run, { retries: 2 }) : await run()
  } catch (e) {
    const err = e as CloudError
    // -1 = H5 预览不支持云能力，属于预期降级，不刷错误日志
    if (err.code !== -1) logger.error('net.error', { id, path, code: err.code, ms: startOf(t0), msg: errText(err) })
    throw err
  }
}

/** 为私有接口 POST 生成一次性签名 URL；date 现用现签。 */
export function signedPostUrl(endpoint: string, signHost?: string): string {
  const { scheme, host, path } = splitEndpoint(endpoint)
  const q = buildAuthQuery({
    path, method: 'POST', signHost: signHost || host, apiKey: apiKey(), apiSecret: apiSecret(),
  })
  return `${scheme}://${host}${path}?${q}`
}

/** 为 WSS 接口生成一次性签名 URL；请求行方法固定 GET。 */
export function signedWsUrl(endpoint: string): string {
  const { scheme, host, path } = splitEndpoint(endpoint)
  const q = buildAuthQuery({
    path, method: 'GET', signHost: host, apiKey: apiKey(), apiSecret: apiSecret(),
  })
  return `${scheme}://${host}${path}?${q}`
}

/** 轻量 WebSocket 会话封装：按帧收集，超时与错误统一收口。 */
export interface WsSession {
  send: (payload: unknown) => void
  sendText: (text: string) => void
  close: () => void
}

export function openWs(
  url: string,
  handlers: {
    onMessage: (data: string | ArrayBuffer, session: WsSession) => void
    onError: (err: CloudError) => void
    onClose?: () => void
  },
  timeoutMs = 90000,
): WsSession {
  // #ifndef APP-PLUS
  // H5 预览：不建立带签名的 WSS 连接（凭据不进浏览器，也不触发跨域失败）。
  // 立即回调一个不可重试的错误，让上层走输入框 / 静默降级。
  const unsupported: WsSession = { send: () => {}, sendText: () => {}, close: () => {} }
  setTimeout(() => handlers.onError(new CloudError('浏览器预览不支持语音服务，请在 App 真机使用；作答可切输入框', -1)), 0)
  return unsupported
  // #endif
  const id = ++wsSeq
  const path = safeUrl(url)
  const t0 = Date.now()
  const stat = { sent: 0, sentKB: 0, recv: 0, recvKB: 0 }
  let logged = false
  const logClose = (reason: 'normal' | 'timeout' | 'error', level: 'debug' | 'warn' = 'debug') => {
    if (logged) return
    logged = true
    logger[level]('ws.close', { id, path, reason, ms: startOf(t0), ...stat })
  }
  let settled = false
  let timer: ReturnType<typeof setTimeout> | null = null
  /**
   * 关键：uni.connectSocket 在 App 端**握手完成前 send 会把连接打挂**
   * （实测手机端 TLS 握手要 200–400ms，之前 120ms 就发第一帧，133ms 连接就 error 了）。
   * 所以 send 一律先进队列，onOpen 之后再真正发出。
   */
  let opened = false
  const pending: string[] = []
  const socket = uni.connectSocket({
    url,
    method: 'GET',
    success: () => logger.debug('ws.connect.ok', { id, path, ms: startOf(t0), opened }),
    fail: (e) => {
      const raw = e as unknown as Record<string, unknown>
      logger.warn('ws.connect.fail', {
        id, path, ms: startOf(t0), msg: errText(e),
        keys: raw && typeof raw === 'object' ? Object.keys(raw).slice(0, 8) : [],
        errMsg: raw?.errMsg,
      })
    },
  })

  const doSend = (text: string) => {
    stat.sent++
    stat.sentKB = Math.round((stat.sentKB + kb(text.length)) * 10) / 10
    try {
      socket.send({ data: text })
    } catch (e) {
      logger.warn('ws.send.fail', { id, path, msg: errText(e), opened })
    }
  }
  const queueSend = (text: string) => {
    if (settled) return
    if (!opened) {
      if (!pending.length) logger.debug('ws.queue', { id, path, ms: startOf(t0) })
      pending.push(text)
      return
    }
    doSend(text)
  }

  const session: WsSession = {
    send: (p) => queueSend(JSON.stringify(p)),
    sendText: (t) => queueSend(t),
    close: () => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      socket.close({ code: 1000 })
    },
  }
  const arm = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      if (settled) return
      settled = true
      socket.close({ code: 1000 })
      logClose('timeout', 'warn')
      handlers.onError(new CloudError('云端响应超时，请重试或改用输入框作答', 0, undefined, true))
    }, timeoutMs)
  }
  arm()
  // 握手单独设一个较短的超时：连不上要尽快说清楚，别让它挂在 60s 的响应超时上
  let connectTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    if (opened || settled) return
    settled = true
    try { socket.close({ code: 1000 }) } catch (_) { /* ignore */ }
    logClose('error', 'warn')
    logger.error('ws.connect.timeout', { id, path, ms: startOf(t0) })
    handlers.onError(new CloudError('语音服务连接超时（握手未完成），请检查网络后重试', 0, undefined, true))
  }, 15000)
  const clearConnectTimer = () => {
    if (connectTimer) { clearTimeout(connectTimer); connectTimer = null }
  }
  socket.onOpen(() => {
    clearConnectTimer()
    opened = true
    logger.info('ws.open', { id, path, ms: startOf(t0), queued: pending.length })
    const rest = pending.splice(0, pending.length)
    for (const text of rest) doSend(text)
  })
  socket.onMessage((res) => {
    arm()
    stat.recv++
    stat.recvKB = Math.round((stat.recvKB + kb(approxBytes(res.data))) * 10) / 10
    if (!settled) handlers.onMessage(res.data as string | ArrayBuffer, session)
  })
  socket.onError((e) => {
    if (settled) return
    settled = true
    clearConnectTimer()
    if (timer) clearTimeout(timer)
    logClose('error', 'warn')
    const raw = e as unknown as Record<string, unknown>
    logger.warn('ws.fail', {
      id, path, ms: startOf(t0),
      msg: errText(e),
      keys: raw && typeof raw === 'object' ? Object.keys(raw).slice(0, 8) : [],
      // 部分运行时只给 errCode / code，errText 取不到，这里补一手
      code: raw?.errCode ?? raw?.code,
    })
    handlers.onError(new CloudError('语音服务连接失败，请检查网络', 0, undefined, true))
  })
  socket.onClose((res) => {
    clearConnectTimer()
    if (timer) clearTimeout(timer)
    const r = res as { code?: number; reason?: string; wasClean?: boolean } | undefined
    logClose('normal')
    // 握手被拒（签名 / 时钟 / 服务未开通）通常以 1006 + reason 收口，别只记 "normal"
    if (r && r.code && r.code !== 1000) {
      logger.warn('ws.closed.abnormal', { id, path, code: r.code, reason: String(r.reason || '').slice(0, 120), wasClean: r.wasClean })
    }
    handlers.onClose?.()
  })
  return session
}

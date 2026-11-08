/**
 * 设备时间校准检测：讯飞签名允许 ±300s，手机时间不准会直接 401/403。
 * 策略：取一次 HTTP 响应的 Date 头（GMT），与本机时间比较；>120s 弹提示（不阻塞使用）。
 * 只在启动 / 首次 401 时检测，避免每次请求多一次往返。
 */
import { logger } from './log.ts'

const TOLERANCE_MS = 120_000
let checked = false
let warned = false

interface DateHeaderResult { date?: string }

function readServerDate(): Promise<number | null> {
  return new Promise((resolve) => {
    // #ifdef APP-PLUS
    // 只请求根路径取响应头，不携带任何鉴权信息、不打完整 URL
    const url = 'https://maas-api.cn-huabei-1.xf-yun.com/'
    uni.request({
      url,
      method: 'GET',
      timeout: 8000,
      success: (res) => {
        const h = (res.header || {}) as DateHeaderResult
        resolve(Date.parse(h.date || '') || null)
      },
      fail: () => resolve(null),
    })
    // #endif
    // #ifndef APP-PLUS
    // H5 / 浏览器预览：讯飞接口不返回 CORS 头、根路径还会 404。
    // 云能力只在 App 端可用，这里静默跳过，绝不发请求（避免控制台红色报错）。
    resolve(null)
    // #endif
  })
}

export async function checkClockOffset(force = false): Promise<number | null> {
  if ((checked && !force) || warned) return null
  checked = true
  const server = await readServerDate()
  if (!server) return null // 拿不到服务器时间就静默跳过，不打扰用户
  const offset = Date.now() - server
  if (Math.abs(offset) > TOLERANCE_MS) {
    warned = true
    logger.warn('clock.offset', { seconds: Math.round(offset / 1000) })
    uni.showModal({
      title: '手机时间不准确',
      content: `本机时间与标准时间相差约 ${Math.round(Math.abs(offset) / 1000)} 秒，讯飞接口会因此鉴权失败。请到「系统设置 → 日期与时间」开启自动确定时间。`,
      showCancel: false,
      confirmText: '知道了',
    })
  }
  return offset
}

/** 首次收到 401/403 时调用一次。 */
export function noteAuthFailure(): void {
  void checkClockOffset(true)
}

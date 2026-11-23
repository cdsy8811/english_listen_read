/**
 * Android 6+ 动态权限：只在使用相机 / 麦克风 / 读图时申请，不启动时一次性索取。
 * 拒绝后由调用方降级（拍照页可用文本录入，录音可切输入框），不阻塞本地功能。
 */
import { errText, logger } from './log.ts'

export type PermissionKind = 'camera' | 'record' | 'image'

const PERMS: Record<PermissionKind, string[]> = {
  camera: ['android.permission.CAMERA'],
  record: ['android.permission.RECORD_AUDIO'],
  image: ['android.permission.READ_MEDIA_IMAGES'],
}

interface PermResult {
  granted?: string[]
  deniedPresent?: string[]
  deniedPermanently?: string[]
}
interface AndroidPermBridge {
  requestPermissions: (perms: string[], ok: (r: PermResult) => void, fail: (e: unknown) => void) => void
}
function androidPerm(): AndroidPermBridge {
  return plus.android as unknown as AndroidPermBridge
}

export function requestPermission(kind: PermissionKind): Promise<boolean> {
  logger.debug('perm.req', { kind, perms: PERMS[kind].length })
  // #ifdef APP-PLUS
  return new Promise((resolve) => {
    try {
      androidPerm().requestPermissions(PERMS[kind], (r) => {
        const denied = (r.deniedPresent?.length || 0) + (r.deniedPermanently?.length || 0)
        const granted = denied === 0
        logger[granted ? 'debug' : 'warn']('perm.res', { kind, granted, denied })
        resolve(granted)
      }, (e) => {
        logger.warn('perm.fail', { kind, msg: errText(e) })
        resolve(false)
      })
    } catch (e) {
      // 旧 runtime 没有该 API 时，交给系统在真正调用相机 / 录音时弹窗
      logger.warn('perm.unsupported', { kind, msg: errText(e) })
      resolve(true)
    }
  })
  // #endif
  // #ifndef APP-PLUS
  return Promise.resolve(true)
  // #endif
}

/**
 * 带缓存的授权：已经授过的权限不再弹系统框。
 * 目的：按住说话要求「按下即录」，权限弹窗会抢走触摸焦点、让松手事件丢失，
 * 所以进练习页时先预热一次，按住时才能走缓存直接开录（没授权成功则每次都会重弹）。
 */
const grantedCache: Partial<Record<PermissionKind, boolean>> = {}

export async function ensurePermission(kind: PermissionKind): Promise<boolean> {
  if (grantedCache[kind]) {
    logger.debug('perm.cache.hit', { kind })
    return true
  }
  const ok = await requestPermission(kind)
  if (ok) grantedCache[kind] = true
  return ok
}

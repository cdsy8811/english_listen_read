/**
 * Android 6+ 动态权限：只在使用相机 / 麦克风 / 读图时申请，不启动时一次性索取。
 * 拒绝后由调用方降级（拍照页可用文本录入，录音可切输入框），不阻塞本地功能。
 */
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
  // #ifdef APP-PLUS
  return new Promise((resolve) => {
    try {
      androidPerm().requestPermissions(PERMS[kind], (r) => {
        resolve(!(r.deniedPresent?.length || r.deniedPermanently?.length))
      }, () => resolve(false))
    } catch (_) {
      // 旧 runtime 没有该 API 时，交给系统在真正调用相机 / 录音时弹窗
      resolve(true)
    }
  })
  // #endif
  // #ifndef APP-PLUS
  return Promise.resolve(true)
  // #endif
}

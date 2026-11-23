/**
 * 系统分享（仅 Android App 端）：把本地文件交给系统分享面板，
 * 由用户选择微信 / QQ / 蓝牙 / 邮件等目标发到另一台手机。
 *
 * 实现要点：
 * - Android 7+ 禁止用 `file://` 跨应用传文件（FileUriExposedException），
 *   必须用 FileProvider 生成 `content://` URI。
 * - DCloud 基础库自带 FileProvider：
 *     class     = io.dcloud.common.util.DCloud_FileProvider
 *     authority = <applicationId>.dc.fileprovider
 *   云打包默认已配置，不需要改 AndroidManifest，也不需要申请存储权限。
 * - 不支持 / 调用失败时由上层退回复制 JSON，避免功能不可用。
 */
import { logger } from './log'

/** plus.android 的最小约束（与 plus-io.ts 保持一致，any 只留在本文件内）。 */
interface AndroidBridge {
  importClass: (cls: string) => any
  invoke: (cls: string, method: string, ...args: any[]) => any
  runtimeMainActivity: () => any
}

export interface ShareFileOptions {
  /** 系统分享面板标题 */
  title?: string
  /** 文件 MIME，默认 application/json */
  mime?: string
}

/** 当前平台是否支持「分享文件到系统」。目前只有 Android App 端实现。 */
export function fileShareAvailable(): boolean {
  // #ifdef APP-PLUS
  return typeof plus !== 'undefined' && plus.os.name === 'Android'
  // #endif
  // #ifndef APP-PLUS
  return false
  // #endif
}

function baseName(p: string): string {
  const clean = p.split('?')[0]
  return clean.split(/[\\/]/).pop() || clean
}

/**
 * 调起系统分享面板发送一个本地文件。
 * @param filePath 原生绝对路径（用 `nativeFilePath()` 从 `_doc/...` / `file://` 转来）
 */
export function shareFile(filePath: string, opts: ShareFileOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = baseName(filePath)
    // #ifdef APP-PLUS
    try {
      const android = (plus as unknown as { android: AndroidBridge }).android
      const main = android.runtimeMainActivity()
      const Intent = android.importClass('android.content.Intent')
      const File = android.importClass('java.io.File')
      const uri = android.invoke(
        'io.dcloud.common.util.DCloud_FileProvider', 'getUriForFile',
        main, `${main.getPackageName()}.dc.fileprovider`, new File(filePath),
      )
      if (!uri) throw new Error('FileProvider 未生成 URI')

      const intent = new Intent(Intent.ACTION_SEND)
      intent.setType(opts.mime || 'application/json')
      intent.putExtra(Intent.EXTRA_STREAM, uri)
      intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      // 部分接收端（如微信）只读 ClipData 里的 URI，补一份并授权。
      try {
        const ClipData = android.importClass('android.content.ClipData')
        intent.setClipData(ClipData.newUri(main.getContentResolver(), file, uri))
      } catch (_) { /* ClipData 失败不影响 EXTRA_STREAM */ }

      main.startActivity(Intent.createChooser(intent, opts.title || '分享备份文件'))
      logger.debug('share.file.ok', { file })
      resolve()
    } catch (e) {
      logger.warn('share.file.fail', { file })
      reject(new Error('系统分享不可用，已改为复制 JSON'))
    }
    // #endif
    // #ifndef APP-PLUS
    reject(new Error('当前平台不支持系统分享，已改为复制 JSON'))
    // #endif
  })
}

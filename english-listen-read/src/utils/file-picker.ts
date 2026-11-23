/**
 * 系统文件选择 + 读取文本（导入备份用）。
 *
 * - Android App 端：ACTION_OPEN_DOCUMENT 调系统文件选择器，拿到 content:// URI 后
 *   通过 ContentResolver.openInputStream 读取文本。全程走 SAF 授权，不需要存储权限，
 *   也不受 Android 11+ 分区存储限制。
 * - H5：`<input type="file">` 读取本地文件（仅开发预览）。
 * - 其它平台：不支持，由上层提示。
 */
import { errText, logger } from './log'

interface AndroidBridge {
  importClass: (cls: any) => any
  invoke: (obj: any, method: string, ...args: any[]) => any
  runtimeMainActivity: () => any
}

export interface PickedFile {
  /** 文件名，用于提示与日志（失败时给默认值） */
  name: string
  /** UTF-8 文本内容 */
  text: string
}

/** 自定义 requestCode，与其它原生回调区分。 */
const REQUEST_CODE = 0x4a53

/** 当前平台是否支持选择本地文件。 */
export function filePickerAvailable(): boolean {
  // #ifdef APP-PLUS
  return typeof plus !== 'undefined' && plus.os.name === 'Android'
  // #endif
  // #ifdef H5
  return true
  // #endif
  // #ifndef APP-PLUS
  // #ifndef H5
  return false
  // #endif
  // #endif
}

/** 打开系统文件选择器并读取所选文件的 UTF-8 文本。用户取消时 reject('已取消选择')。 */
export function pickTextFile(): Promise<PickedFile> {
  // #ifdef APP-PLUS
  return pickOnAndroid()
  // #endif
  // #ifdef H5
  return pickInBrowser()
  // #endif
  // #ifndef APP-PLUS
  // #ifndef H5
  return Promise.reject(new Error('当前平台不支持文件选择'))
  // #endif
  // #endif
}

// #ifdef APP-PLUS
function pickOnAndroid(): Promise<PickedFile> {
  logger.debug('file.pick.start', { mime: '*/*' })
  return new Promise((resolve, reject) => {
    try {
      const android = (plus as unknown as { android: AndroidBridge }).android
      const main = android.runtimeMainActivity()
      const Intent = android.importClass('android.content.Intent')
      const intent = new Intent(Intent.ACTION_OPEN_DOCUMENT)
      intent.addCategory(Intent.CATEGORY_OPENABLE)
      // 不按 MIME 过滤：微信等来源的 .json 常被标成 octet-stream，按扩展名校验更稳。
      intent.setType('*/*')

      const prev = main.onActivityResult
      let settled = false

      const restore = () => {
        try { main.onActivityResult = prev || null } catch (_) { /* 恢复失败不影响结果 */ }
      }

      main.onActivityResult = (requestCode: number, resultCode: number, data: any) => {
        if (requestCode !== REQUEST_CODE) {
          if (typeof prev === 'function') {
            try { prev(requestCode, resultCode, data) } catch (_) { /* 交给原处理器 */ }
          }
          return
        }
        if (settled) return
        settled = true
        restore()
        logger.debug('file.pick.result', { code: resultCode, hasData: !!data })

        // Activity.RESULT_OK === -1；0 为用户取消
        if (resultCode !== -1) {
          logger.info('file.pick.cancel', { code: resultCode })
          reject(new Error('已取消选择'))
          return
        }
        try {
          const uri = data && data.getData()
          if (!uri) {
            logger.warn('file.pick.fail', { stage: 'uri', msg: 'data.getData() 为空' })
            reject(new Error('没有拿到文件'))
            return
          }
          const resolver = main.getContentResolver()
          const name = queryDisplayName(android, resolver, uri)
          logger.debug('file.pick.file', { file: name })
          const text = readUriText(android, resolver, uri)
          logger.debug('file.pick.ok', { file: name, chars: text.length })
          resolve({ name, text })
        } catch (e) {
          logger.warn('file.pick.fail', { stage: 'read', msg: errText(e) })
          reject(new Error('读取文件失败：' + errText(e)))
        }
      }

      const target = pickIntent(android, main, intent)
      logger.debug('file.pick.open', { fallback: target !== intent })
      main.startActivityForResult(target, REQUEST_CODE)
    } catch (e) {
      logger.warn('file.pick.fail', { stage: 'start', msg: errText(e) })
      reject(new Error('无法打开系统文件选择器：' + errText(e)))
    }
  })
}

/** 优先 ACTION_OPEN_DOCUMENT；没有处理器时退回 ACTION_GET_CONTENT（两者都返回 content://）。 */
function pickIntent(android: AndroidBridge, main: any, intent: any): any {
  try {
    if (intent.resolveActivity(main.getPackageManager())) return intent
  } catch (_) { /* resolveActivity 失败时仍按 OPEN_DOCUMENT 尝试 */ }
  try {
    const Intent = android.importClass('android.content.Intent')
    const fallback = new Intent(Intent.ACTION_GET_CONTENT)
    fallback.addCategory(Intent.CATEGORY_OPENABLE)
    fallback.setType('*/*')
    return fallback
  } catch (_) {
    return intent
  }
}

/** 查询 OpenableColumns.DISPLAY_NAME；查不到时给一个安全默认名。 */
function queryDisplayName(android: AndroidBridge, resolver: any, uri: any): string {
  let cursor: any = null
  try {
    cursor = android.invoke(resolver, 'query', uri, null, null, null, null)
    if (cursor) {
      // 返回的 Cursor 也用 invoke 调用，避免 Native.js 没有代理到实例方法
      if (android.invoke(cursor, 'moveToFirst')) {
        const idx = android.invoke(cursor, 'getColumnIndex', '_display_name')
        if (idx >= 0) {
          const v = android.invoke(cursor, 'getString', idx)
          if (v) return String(v)
        }
      }
    }
  } catch (_) { /* 部分 provider 不支持 query，忽略 */ }
  finally {
    if (cursor) { try { android.invoke(cursor, 'close') } catch (_) { /* ignore */ } }
  }
  return 'backup.json'
}

/** content:// / file:// 统一走 ContentResolver 流式读取（UTF-8）。 */
function readUriText(android: AndroidBridge, resolver: any, uri: any): string {
  // ContentResolver 是 getContentResolver() 返回的实例，直接 .openInputStream 不是函数，
  // 必须用 plus.android.invoke 调用（Native.js 只代理已导入类的方法）。
  let input: any = null
  try {
    input = android.invoke(resolver, 'openInputStream', uri)
  } catch (e) {
    logger.warn('file.pick.stream', { stage: 'open', msg: errText(e) })
    throw new Error('无法打开所选文件：' + errText(e))
  }
  if (!input) {
    logger.warn('file.pick.stream', { stage: 'open', msg: 'openInputStream 返回空' })
    throw new Error('无法打开所选文件（openInputStream 返回空）')
  }
  const InputStreamReader = android.importClass('java.io.InputStreamReader')
  const BufferedReader = android.importClass('java.io.BufferedReader')
  let reader: any = null
  try {
    reader = new BufferedReader(new InputStreamReader(input, 'UTF-8'))
    const parts: string[] = []
    let line = android.invoke(reader, 'readLine')
    while (line !== null && line !== undefined) {
      parts.push(String(line))
      line = android.invoke(reader, 'readLine')
    }
    const text = parts.join('\n')
    logger.debug('file.pick.read', { lines: parts.length, chars: text.length })
    return text
  } catch (e) {
    logger.warn('file.pick.stream', { stage: 'read', msg: errText(e) })
    throw e
  } finally {
    if (reader) { try { android.invoke(reader, 'close') } catch (_) { /* ignore */ } }
    try { android.invoke(input, 'close') } catch (_) { /* ignore */ }
  }
}
// #endif

// #ifdef H5
function pickInBrowser(): Promise<PickedFile> {
  logger.debug('file.pick.start', { mime: '.json' })
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.style.display = 'none'
    document.body.appendChild(input)
    const cleanup = () => { try { input.remove() } catch (_) { /* ignore */ } }
    input.onchange = () => {
      const file = input.files && input.files[0]
      if (!file) {
        logger.info('file.pick.cancel', {})
        cleanup()
        reject(new Error('已取消选择'))
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        cleanup()
        const text = String(reader.result ?? '')
        logger.debug('file.pick.ok', { file: file.name, chars: text.length })
        resolve({ name: file.name, text })
      }
      reader.onerror = () => {
        cleanup()
        logger.warn('file.pick.fail', { stage: 'read.browser', file: file.name })
        reject(new Error('读取文件失败'))
      }
      reader.readAsText(file, 'utf-8')
    }
    // 用户取消时部分浏览器不触发 change，隐藏的 input 留在 DOM 中不影响页面。
    input.click()
  })
}
// #endif

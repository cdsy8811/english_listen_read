/**
 * 5+ 原生文件系统最小封装。
 * @dcloudio/types 各版本对 plus.io 的声明不一致（且没有 `plus.io.*` 这样的 namespace 类型），
 * 这里只约束实际用到的成员，把 any 收敛在本文件内，上层不再直接碰 plus.io。
 *
 * 条件编译：APP-PLUS 走原生文件系统；H5 预览走 fetch / Blob URL（仅本地调试用）。
 */
import { base64Encode } from './crypto.ts'
import { errText, kb, logger } from './log.ts'

/** 日志里只出现文件名，避免打印整条临时路径。 */
function baseName(u: string): string {
  const clean = u.split('?')[0]
  return clean.split('/').pop() || clean
}

interface CreateOpts { create: boolean; exclusive: boolean }
interface IoWriter {
  onwrite: (() => void) | null
  onerror: ((e: unknown) => void) | null
  write: (data: unknown) => void
}
interface IoReader {
  onloadend: (() => void) | null
  onerror: ((e: unknown) => void) | null
  result: unknown
  readAsText: (file: unknown, encoding?: string) => void
  readAsDataURL: (file: unknown) => void
}
interface IoFile {
  size: number
}
interface IoEntry {
  name: string
  toLocalURL: () => string
  file: (ok: (f: IoFile) => void, fail: (e: unknown) => void) => void
  createWriter: (ok: (w: IoWriter) => void, fail: (e: unknown) => void) => void
  /** 5+ 的 Entry.remove；存在性检查用不到，音频缓存淘汰时用 */
  remove?: (ok?: () => void, fail?: (e: unknown) => void) => void
  createReader: () => {
    readEntries: (ok: (entries: IoEntry[]) => void, fail: (e: unknown) => void) => void
  }
  getFile: (path: string, opts: CreateOpts, ok: (e: IoEntry) => void, fail: (e: unknown) => void) => void
  getDirectory: (path: string, opts: CreateOpts, ok: (e: IoEntry) => void, fail: (e: unknown) => void) => void
}
interface IoFileSystem { root: IoEntry }
interface IoStatic {
  PRIVATE_DOC: number
  requestFileSystem: (type: number, ok: (fs: IoFileSystem) => void, fail: (e: unknown) => void) => void
  resolveLocalFileSystemURL: (url: string, ok: (e: IoEntry) => void, fail: (e: unknown) => void) => void
  FileReader: new () => IoReader
}

/** 只在 APP-PLUS 分支调用；H5 构建时这些代码会被条件编译剔除。 */
function io(): IoStatic {
  return (plus as unknown as { io: IoStatic }).io
}

/** plus.android 的最小约束：只用到 importClass。 */
interface AndroidBridge {
  importClass: (cls: string) => any
}

export interface IoFileItem { name: string; url: string }

export function ioAvailable(): boolean {
  // #ifdef APP-PLUS
  return typeof plus !== 'undefined' && !!plus.io
  // #endif
  // #ifndef APP-PLUS
  return false
  // #endif
}

/**
 * 取「相对 dir 的文件名」：调用方可能把目录也写进 relativePath（如 `audio/x.mp3` + dir=`audio`）。
 * 不能原样交给 `DirectoryEntry.getFile()`，否则会在 dir 下再套一层，创建出空占位文件。
 * 纯函数，可离线自测。
 */
export function ioChildPath(dir: string, relativePath: string): string {
  if (!dir) return relativePath
  const prefix = `${dir.replace(/\/+$/, '')}/`
  return relativePath.startsWith(prefix) ? relativePath.slice(prefix.length) : relativePath
}

/** Uint8Array → BlobPart：TS 5.7 的 Uint8Array<ArrayBufferLike> 不直接兼容 BlobPart。
 *  只在浏览器 / H5 分支使用：App 端逻辑层（app-service）没有 Blob。 */
export function toBlob(bytes: Uint8Array, type: string): Blob {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  return new Blob([buf], { type })
}

/**
 * 字节写入 App 私有目录。
 * App 端不能用 Blob（app-service 里 `Blob is not defined`，会直接把调用方回调打崩），
 * 所以走 plus.android：android.util.Base64 解码 → java.io.FileOutputStream 写盘。
 * H5 / 浏览器仍然用 Blob + object URL。
 */
export function writeBytes(relativePath: string, bytes: Uint8Array, dir = ''): Promise<string> {
  const t0 = Date.now()
  logger.debug('io.writeBytes.start', { path: relativePath, kb: kb(bytes.length) })
  return new Promise((resolve, reject) => {
    const bad = (msg: string) => {
      logger.warn('io.writeBytes.fail', { path: relativePath, msg, ms: Date.now() - t0 })
      reject(new Error(msg))
    }
    const ok = (url: string) => {
      logger.debug('io.writeBytes.ok', { path: relativePath, kb: kb(bytes.length), ms: Date.now() - t0 })
      resolve(url)
    }
    // #ifdef APP-PLUS
    const android = (plus as unknown as { android: AndroidBridge }).android
    const ioNs = io() as IoStatic & { convertLocalFileSystemURL?: (url: string) => string }
    // 交给 getFile 的只能是不含 dir 前缀的文件名；写字节的绝对路径要和 entry 完全一致，
    // 否则 entry 是空占位文件、字节写去了另一条路径（首次播放 MediaError 的根因）。
    const name = ioChildPath(dir, relativePath)
    const docPath = dir ? `_doc/${dir}/${name}` : `_doc/${name}`
    ioNs.requestFileSystem(ioNs.PRIVATE_DOC, (fs) => {
      const createFile = (root: IoEntry) => root.getFile(
        name, { create: true, exclusive: false },
        (entry) => {
          try {
            const abs = ioNs.convertLocalFileSystemURL
              ? ioNs.convertLocalFileSystemURL(docPath)
              : docPath
            const Base64 = android.importClass('android.util.Base64')
            const FileOutputStream = android.importClass('java.io.FileOutputStream')
            const data = Base64.decode(base64Encode(bytes), 0)
            const out = new FileOutputStream(abs)
            out.write(data)
            out.flush()
            out.close()
            ok(entry.toLocalURL())
          } catch (e) {
            bad('写入文件失败：' + errText(e))
          }
        },
        () => bad('创建文件失败'),
      )
      if (dir) fs.root.getDirectory(dir, { create: true, exclusive: false }, createFile, () => bad('创建目录失败'))
      else createFile(fs.root)
    }, () => bad('打开文件系统失败'))
    // #endif
    // #ifndef APP-PLUS
    try {
      writeBlob(relativePath, toBlob(bytes, 'application/octet-stream'), dir).then(ok, (e) => bad(errText(e) || '写入失败'))
    } catch (e) {
      bad(errText(e) || '写入失败')
    }
    // #endif
  })
}

/** 把 `_doc/...` 这类相对路径转成播放器 / 原生文件 API 可用的绝对路径（App 端）；其它平台原样返回。 */
export function absolutePath(path: string): string {
  // #ifdef APP-PLUS
  try {
    if (path && path.startsWith('_doc/')) {
      const ioNs = io() as IoStatic & { convertLocalFileSystemURL?: (url: string) => string }
      const abs = ioNs.convertLocalFileSystemURL ? ioNs.convertLocalFileSystemURL(path) : ''
      if (abs) return abs
    }
  } catch (_) { /* 转换失败时退回原路径 */ }
  // #endif
  return path
}

/**
 * 本地 URL（`_doc/...` 或 `file://...`）→ 原生文件 API 可用的绝对路径。
 * 系统分享 / FileProvider 这类 Java 层 API 只认绝对路径，不认 `file://`。
 * 非 App 端原样返回。
 */
export function nativeFilePath(path: string): string {
  // #ifdef APP-PLUS
  try {
    if (!path) return ''
    const ioNs = io() as IoStatic & { convertLocalFileSystemURL?: (url: string) => string }
    const abs = ioNs.convertLocalFileSystemURL ? ioNs.convertLocalFileSystemURL(path) : ''
    if (abs && !abs.startsWith('file://')) return abs
  } catch (_) { /* 继续走下面的 file:// 兜底 */ }
  if (path.startsWith('file://')) {
    try { return decodeURIComponent(path.slice('file://'.length)) } catch (_) { return path.slice('file://'.length) }
  }
  // #endif
  return path
}

/** 文本写入：App 端用 plus.io FileWriter 直接写字符串（同样避开 Blob）。 */
export function writeText(relativePath: string, text: string, dir = ''): Promise<string> {
  const t0 = Date.now()
  logger.debug('io.writeText.start', { path: relativePath, chars: text.length })
  return new Promise((resolve, reject) => {
    const bad = (msg: string) => {
      logger.warn('io.writeText.fail', { path: relativePath, msg, ms: Date.now() - t0 })
      reject(new Error(msg))
    }
    // #ifdef APP-PLUS
    const name = ioChildPath(dir, relativePath)
    io().requestFileSystem(io().PRIVATE_DOC, (fs) => {
      const createFile = (root: IoEntry) => root.getFile(
        name, { create: true, exclusive: false },
        (entry) => entry.createWriter((writer) => {
          writer.onwrite = () => {
            logger.debug('io.writeText.ok', { path: relativePath, chars: text.length, ms: Date.now() - t0 })
            resolve(entry.toLocalURL())
          }
          writer.onerror = () => bad('写入文件失败')
          writer.write(text)
        }, () => bad('创建写入器失败')),
        () => bad('创建文件失败'),
      )
      if (dir) fs.root.getDirectory(dir, { create: true, exclusive: false }, createFile, () => bad('创建目录失败'))
      else createFile(fs.root)
    }, () => bad('打开文件系统失败'))
    // #endif
    // #ifndef APP-PLUS
    try {
      writeBlob(relativePath, new Blob([text], { type: 'application/json' }), dir).then(resolve, (e) => bad(errText(e) || '写入失败'))
    } catch (e) {
      bad(errText(e) || '写入失败')
    }
    // #endif
  })
}

/** 读取本地文件文本。 */export function readText(url: string): Promise<string> {
  const name = baseName(url)
  const t0 = Date.now()
  return new Promise((resolve, reject) => {
    // #ifdef APP-PLUS
    io().resolveLocalFileSystemURL(url, (entry) => {
      entry.file((file) => {
        const reader = new (io().FileReader)()
        reader.onloadend = () => {
          const text = String(reader.result ?? '')
          logger.debug('io.readText', { file: name, chars: text.length, ms: Date.now() - t0 })
          resolve(text)
        }
        reader.onerror = () => reject(new Error('读取文件失败'))
        reader.readAsText(file, 'utf-8')
      }, () => reject(new Error('打开文件失败')))
    }, () => reject(new Error('文件不存在')))
    // #endif
    // #ifndef APP-PLUS
    fetch(url).then((r) => r.text()).then((text) => {
      logger.debug('io.readText', { file: name, chars: text.length, ms: Date.now() - t0 })
      resolve(text)
    }).catch(() => reject(new Error('读取文件失败')))
    // #endif
  })
}

/** 读取本地文件为 data URL，返回逗号后的纯 base64。 */
export function readDataUrl(url: string): Promise<string> {
  const name = baseName(url)
  const t0 = Date.now()
  const done = (b64: string, resolve: (v: string) => void) => {
    logger.debug('io.readDataUrl', { file: name, kb: kb(b64.length), ms: Date.now() - t0 })
    resolve(b64)
  }
  return new Promise((resolve, reject) => {
    // #ifdef APP-PLUS
    io().resolveLocalFileSystemURL(url, (entry) => {
      entry.file((file) => {
        const reader = new (io().FileReader)()
        reader.onloadend = () => {
          const r = String(reader.result ?? '')
          done(r.slice(r.indexOf(',') + 1), resolve)
        }
        reader.onerror = () => reject(new Error('读取文件失败'))
        reader.readAsDataURL(file)
      }, () => reject(new Error('打开文件失败')))
    }, () => reject(new Error('文件不存在')))
    // #endif
    // #ifndef APP-PLUS
    fetch(url)
      .then((r) => r.blob())
      .then((blob) => new Promise<string>((res, rej) => {
        const fr = new FileReader()
        fr.onloadend = () => res(String(fr.result ?? '').split(',')[1] ?? '')
        fr.onerror = () => rej(new Error('读取文件失败'))
        fr.readAsDataURL(blob)
      }))
      .then((b64) => done(b64, resolve)).catch(reject)
    // #endif
  })
}

/** 写文件到 App 私有目录，返回可再次读取的本地 URL。 */
export function writeBlob(relativePath: string, blob: Blob, dir = ''): Promise<string> {
  const t0 = Date.now()
  logger.debug('io.write.start', { path: relativePath, kb: kb(blob.size) })
  return new Promise((resolve, reject) => {
    const ok = (path: string) => {
      logger.debug('io.write.ok', { path: relativePath, kb: kb(blob.size), ms: Date.now() - t0 })
      resolve(path)
    }
    const bad = (msg: string) => {
      logger.warn('io.write.fail', { path: relativePath, msg, ms: Date.now() - t0 })
      reject(new Error(msg))
    }
    // #ifdef APP-PLUS
    const name = ioChildPath(dir, relativePath)
    io().requestFileSystem(io().PRIVATE_DOC, (fs) => {
      const createFile = (root: IoEntry) => root.getFile(
        name, { create: true, exclusive: false },
        (entry) => entry.createWriter((writer) => {
          writer.onwrite = () => ok(entry.toLocalURL())
          writer.onerror = () => bad('写入文件失败')
          writer.write(blob)
        }, () => bad('创建写入器失败')),
        () => bad('创建文件失败'),
      )
      if (dir) {
        fs.root.getDirectory(dir, { create: true, exclusive: false }, createFile,
          () => bad('创建目录失败'))
      } else createFile(fs.root)
    }, () => bad('打开文件系统失败'))
    // #endif
    // #ifndef APP-PLUS
    ok(URL.createObjectURL(blob))
    // #endif
  })
}

/** 列出私有目录下指定后缀的文件。 */
export function listFiles(dir: string, suffix = ''): Promise<IoFileItem[]> {
  const done = (items: IoFileItem[], resolve: (v: IoFileItem[]) => void) => {
    logger.debug('io.list', { dir, suffix, count: items.length })
    resolve(items)
  }
  return new Promise((resolve) => {
    // #ifdef APP-PLUS
    io().requestFileSystem(io().PRIVATE_DOC, (fs) => {
      fs.root.getDirectory(dir, { create: true, exclusive: false }, (folder) => {
        folder.createReader().readEntries(
          (entries) => done(entries
            .filter((e) => !suffix || e.name.endsWith(suffix))
            .map((e) => ({ name: e.name, url: e.toLocalURL() })), resolve),
          () => done([], resolve),
        )
      }, () => done([], resolve))
    }, () => done([], resolve))
    // #endif
    // #ifndef APP-PLUS
    done([], resolve)
    // #endif
  })
}

export interface FileProbe {
  exists: boolean
  bytes: number
}

/**
 * 探测本地文件是否存在及大小（音频缓存命中前的自愈校验）。
 * 只看文件真实状态，不创建任何东西；非 App 端 / 文件不存在统一返回 `exists: false`。
 */
export function probeFile(path: string): Promise<FileProbe> {
  const miss: FileProbe = { exists: false, bytes: 0 }
  if (!path || !ioAvailable()) return Promise.resolve(miss)
  // `_doc/...` 相对路径要先转成系统绝对路径，resolveLocalFileSystemURL 才认
  const url = path.startsWith('_doc/') ? absolutePath(path) : path
  return new Promise((resolve) => {
    try {
      io().resolveLocalFileSystemURL(url, (entry) => {
        entry.file(
          (f) => resolve({ exists: true, bytes: Number(f?.size) || 0 }),
          () => resolve(miss),
        )
      }, () => resolve(miss))
    } catch (_) { resolve(miss) }
  })
}

/**
 * 删除本地文件（音频缓存淘汰 / 清理 / 孤儿清扫）。
 * 文件本来就不存在视为成功 —— 清理流程不该因为「已删过」而中断。
 * 非 App 端（H5 预览 / Node 自测）没有可删的实体文件，直接返回。
 */
export function removeFile(path: string): Promise<void> {
  if (!path || !ioAvailable()) return Promise.resolve()
  // 依次尝试：原样路径 → `_doc` 绝对路径 → 按文件名补回 `_doc/audio/`
  const candidates = path.startsWith('_doc/')
    ? [absolutePath(path), path]
    : [path, absolutePath(`_doc/audio/${baseName(path)}`)]
  const once = (url: string) => new Promise<void>((resolve, reject) => {
    io().resolveLocalFileSystemURL(url, (entry) => {
      // 没有 remove 能力的运行时不报错，避免卡住整轮清理
      if (typeof entry.remove !== 'function') { resolve(); return }
      entry.remove(() => resolve(), () => reject(new Error('删除文件失败')))
    }, () => reject(new Error('文件不存在')))
  })
  return candidates.reduce<Promise<void>>(
    (chain, url) => chain.catch(() => once(url)),
    Promise.reject(new Error('no target')),
  ).catch(() => { /* 已经不存在 = 清理完成 */ })
}

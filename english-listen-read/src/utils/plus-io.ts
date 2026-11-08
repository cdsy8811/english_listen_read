/**
 * 5+ 原生文件系统最小封装。
 * @dcloudio/types 各版本对 plus.io 的声明不一致（且没有 `plus.io.*` 这样的 namespace 类型），
 * 这里只约束实际用到的成员，把 any 收敛在本文件内，上层不再直接碰 plus.io。
 *
 * 条件编译：APP-PLUS 走原生文件系统；H5 预览走 fetch / Blob URL（仅本地调试用）。
 */

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
interface IoEntry {
  name: string
  toLocalURL: () => string
  file: (ok: (f: unknown) => void, fail: (e: unknown) => void) => void
  createWriter: (ok: (w: IoWriter) => void, fail: (e: unknown) => void) => void
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

export interface IoFileItem { name: string; url: string }

export function ioAvailable(): boolean {
  // #ifdef APP-PLUS
  return typeof plus !== 'undefined' && !!plus.io
  // #endif
  // #ifndef APP-PLUS
  return false
  // #endif
}

/** Uint8Array → BlobPart：TS 5.7 的 Uint8Array<ArrayBufferLike> 不直接兼容 BlobPart。 */
export function toBlob(bytes: Uint8Array, type: string): Blob {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  return new Blob([buf], { type })
}

/** 读取本地文件文本。 */
export function readText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // #ifdef APP-PLUS
    io().resolveLocalFileSystemURL(url, (entry) => {
      entry.file((file) => {
        const reader = new (io().FileReader)()
        reader.onloadend = () => resolve(String(reader.result ?? ''))
        reader.onerror = () => reject(new Error('读取文件失败'))
        reader.readAsText(file, 'utf-8')
      }, () => reject(new Error('打开文件失败')))
    }, () => reject(new Error('文件不存在')))
    // #endif
    // #ifndef APP-PLUS
    fetch(url).then((r) => r.text()).then(resolve).catch(() => reject(new Error('读取文件失败')))
    // #endif
  })
}

/** 读取本地文件为 data URL，返回逗号后的纯 base64。 */
export function readDataUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // #ifdef APP-PLUS
    io().resolveLocalFileSystemURL(url, (entry) => {
      entry.file((file) => {
        const reader = new (io().FileReader)()
        reader.onloadend = () => {
          const r = String(reader.result ?? '')
          resolve(r.slice(r.indexOf(',') + 1))
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
      .then(resolve).catch(reject)
    // #endif
  })
}

/** 写文件到 App 私有目录，返回可再次读取的本地 URL。 */
export function writeBlob(relativePath: string, blob: Blob, dir = ''): Promise<string> {
  return new Promise((resolve, reject) => {
    // #ifdef APP-PLUS
    io().requestFileSystem(io().PRIVATE_DOC, (fs) => {
      const createFile = (root: IoEntry) => root.getFile(
        relativePath, { create: true, exclusive: false },
        (entry) => entry.createWriter((writer) => {
          writer.onwrite = () => resolve(entry.toLocalURL())
          writer.onerror = () => reject(new Error('写入文件失败'))
          writer.write(blob)
        }, () => reject(new Error('创建写入器失败'))),
        () => reject(new Error('创建文件失败')),
      )
      if (dir) {
        fs.root.getDirectory(dir, { create: true, exclusive: false }, createFile,
          () => reject(new Error('创建目录失败')))
      } else createFile(fs.root)
    }, () => reject(new Error('打开文件系统失败')))
    // #endif
    // #ifndef APP-PLUS
    resolve(URL.createObjectURL(blob))
    // #endif
  })
}

/** 列出私有目录下指定后缀的文件。 */
export function listFiles(dir: string, suffix = ''): Promise<IoFileItem[]> {
  return new Promise((resolve) => {
    // #ifdef APP-PLUS
    io().requestFileSystem(io().PRIVATE_DOC, (fs) => {
      fs.root.getDirectory(dir, { create: true, exclusive: false }, (folder) => {
        folder.createReader().readEntries(
          (entries) => resolve(entries
            .filter((e) => !suffix || e.name.endsWith(suffix))
            .map((e) => ({ name: e.name, url: e.toLocalURL() }))),
          () => resolve([]),
        )
      }, () => resolve([]))
    }, () => resolve([]))
    // #endif
    // #ifndef APP-PLUS
    resolve([])
    // #endif
  })
}

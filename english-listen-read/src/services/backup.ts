/**
 * 本地词库备份文件（纯本地单机）：导出到 App 私有目录 _doc/backups/，导入从同目录读回。
 * 不联网、不登录、不依赖任何服务；H5 端降级为剪贴板 / 粘贴文本。
 */
import { ioAvailable, listFiles, readText, writeBlob } from '../utils/plus-io.ts'

const DIR = 'backups'

export interface BackupFile { name: string; url: string }

function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/** 是否支持本地文件系统（App 端才支持）。 */
export function fileBackupAvailable(): boolean { return ioAvailable() }

/** 写出备份文件，返回本地 file URL；不支持文件系统的平台返回空串（上层走剪贴板）。 */
export async function writeBackup(json: string): Promise<string> {
  if (!ioAvailable()) return ''
  return writeBlob(`${DIR}/elr-${stamp()}.json`, new Blob([json], { type: 'application/json' }), DIR)
}

/** 列出已导出的备份（按文件名倒序，即最新在前）。 */
export async function listBackups(): Promise<BackupFile[]> {
  const files = await listFiles(DIR, '.json')
  return files.sort((a, b) => b.name.localeCompare(a.name))
}

/** 读取备份文件文本。 */
export function readBackup(url: string): Promise<string> {
  if (!ioAvailable()) return Promise.reject(new Error('当前平台不支持读取本地备份文件，请直接粘贴 JSON'))
  return readText(url)
}

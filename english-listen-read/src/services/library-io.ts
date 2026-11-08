/** 词库导入导出门面：两处入口（首页 / 错词本）共用同一套校验与落盘逻辑。纯本地，无账号无同步。 */
import { exportBundle, importBundle } from './storage.ts'
import { writeBackup } from './backup.ts'
import type { ExportBundle } from './types.ts'

export interface ExportOutcome {
  units: number
  words: number
  /** App 私有目录下的备份文件路径；不支持文件系统的平台为空串 */
  path: string
  json: string
}

/** 导出：写 _doc/backups/ 备份文件 + 返回可复制到剪贴板的 JSON。 */
export async function exportLibrary(): Promise<ExportOutcome> {
  const bundle = await exportBundle()
  const json = JSON.stringify(bundle)
  const path = await writeBackup(json)
  return { units: bundle.units.length, words: bundle.words.length, path, json }
}

/** 严格校验：只接受本应用导出的 v1 JSON，避免脏数据写坏本地库。 */
export function parseLibraryJson(text: string): ExportBundle {
  let data: unknown
  try { data = JSON.parse(text.trim()) } catch (_) { throw new Error('不是合法的 JSON 文本') }
  const b = data as ExportBundle
  if (b.version !== 1 || !Array.isArray(b.units) || !Array.isArray(b.words)) {
    throw new Error('文件格式不正确（需要本应用导出的 JSON）')
  }
  return b
}

/** 导入：同 id 覆盖、不同 id 追加。 */
export function importLibraryJson(text: string): Promise<{ units: number; words: number }> {
  return importBundle(parseLibraryJson(text))
}

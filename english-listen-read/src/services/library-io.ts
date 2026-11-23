/** 词库导入导出门面：两处入口（首页 / 错词本）共用同一套校验与落盘逻辑。纯本地，无账号无同步。 */
import { exportBundle, importBundle } from './storage.ts'
import { writeBackup } from './backup.ts'
import { errText, logger } from '../utils/log.ts'
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
  logger.debug('io.export', { units: bundle.units.length, words: bundle.words.length, jsonKB: Math.round(json.length / 1024), file: !!path })
  return { units: bundle.units.length, words: bundle.words.length, path, json }
}

/** 严格校验：只接受本应用导出的 v1 JSON，避免脏数据写坏本地库。 */
export function parseLibraryJson(text: string): ExportBundle {
  let data: unknown
  // 手机文件选择 / 微信转存的文件可能带 UTF-8 BOM，先去掉再解析。
  try { data = JSON.parse(text.replace(/^\uFEFF/, '').trim()) } catch (e) {
    logger.warn('io.import.parse.fail', { chars: text.length, msg: errText(e) })
    throw new Error('不是合法的 JSON 文本')
  }
  const b = data as ExportBundle
  if (b.version !== 1 || !Array.isArray(b.units) || !Array.isArray(b.words)) {
    logger.warn('io.import.schema.fail', {
      version: b && (b as { version?: unknown }).version,
      unitsArray: Array.isArray(b && b.units),
      wordsArray: Array.isArray(b && b.words),
    })
    throw new Error('文件格式不正确（需要本应用导出的 JSON）')
  }
  return b
}

/** 导入：同 id 覆盖、不同 id 追加。 */
export async function importLibraryJson(text: string): Promise<{ units: number; words: number }> {
  logger.debug('io.import.req', { chars: text.length })
  try {
    const bundle = parseLibraryJson(text)
    const result = await importBundle(bundle)
    logger.debug('io.import.ok', { units: result.units, words: result.words })
    return result
  } catch (e) {
    logger.warn('io.import.fail', { chars: text.length, msg: errText(e) })
    throw e
  }
}

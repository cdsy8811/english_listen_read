/**
 * 朗读音频缓存：文本 → 本地 mp3，命中直接播放，不重复计费。
 *
 * 设计（2026-11-21）：
 *  - 键 = 归一化文本 + 语言 + 发音人 + 语速。音量**不进键**：云端固定 100 合成，
 *    音量在播放侧（`InnerAudioContext.volume`）施加，一句话在所有音量下共用一份音频。
 *  - 条目不过期（`expired_at = 0`），改为按总容量 LRU 淘汰，避免 30 天 TTL 到期又付一次钱。
 *  - 命中前校验文件仍存在且非空：死条目直接删掉并按未命中处理（自愈），
 *    不会出现「DB 说有、播放器放不出、永远降级原生」的状态。
 *  - 只归一空白与 Unicode 形式，不动标点：标点影响停顿和语调。
 */
import { textHash, saveAudioBytes } from '../utils/audio-file.ts'
import { probeFile, removeFile, listFiles } from '../utils/plus-io.ts'
import { errText, kb, logger } from '../utils/log.ts'
import {
  audioCacheTotals,
  clearAudioCacheRows,
  deleteAudioCacheRowByPath,
  getAudioCacheRow,
  listAudioCacheRows,
  putAudioCacheRow,
  type AudioCacheRow,
} from './storage.ts'

/** 缓存总容量上限：300 MB（16k 单声道 mp3 约 3 KB/s，够存上万条词句）。 */
export const CACHE_LIMIT_BYTES = 300 * 1024 * 1024
/** 触发淘汰后回落到上限的这个比例，避免每次合成都被反复淘汰。 */
export const CACHE_EVICT_RATIO = 0.8
/** 同一条音频 60 秒内重复播放不重复回写命中次数，省掉高频 SQL。 */
const TOUCH_MIN_INTERVAL_MS = 60_000

export interface CacheMeta {
  text: string
  lang: 'zh' | 'en'
  vcn: string
  speed: number
}

/** 归一化：全角空格 → 半角、连续空白折叠、首尾去空、NFC 组合。标点保留。 */
export function normText(text: string): string {
  return String(text ?? '')
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .normalize('NFC')
}

/**
 * 缓存键。键结构与历史版本完全一致（`文本:语种:发音人:语速`），
 * 因此已经是干净文本的老条目仍然命中，不需要一次性全量失效。
 */
export function cacheKey(meta: Pick<CacheMeta, 'text' | 'lang' | 'vcn' | 'speed'>): string {
  return textHash(`${normText(meta.text)}:${meta.lang}:${meta.vcn}:${meta.speed}`)
}

export interface CacheStats {
  count: number
  bytes: number
  /** 本次运行（App 启动以来）的命中 / 未命中次数 */
  hit: number
  miss: number
  limit: number
}

let sessionHit = 0
let sessionMiss = 0

export function resetCacheCounters(): void {
  sessionHit = 0
  sessionMiss = 0
}

/** 缓存占用 + 本次运行命中率；读库失败按 0 处理，设置页不该因此报错。 */
export async function cacheStats(): Promise<CacheStats> {
  try {
    const totals = await audioCacheTotals()
    return { ...totals, hit: sessionHit, miss: sessionMiss, limit: CACHE_LIMIT_BYTES }
  } catch (e) {
    logger.warn('tts.cache.stats.fail', { msg: errText(e) })
    return { count: 0, bytes: 0, hit: sessionHit, miss: sessionMiss, limit: CACHE_LIMIT_BYTES }
  }
}

/** 字节数 → 人读字符串（设置页用）。 */
export function formatBytes(bytes: number): string {
  const n = Math.max(0, Number(bytes) || 0)
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/** 可注入的副作用：自测里不碰真实文件系统。 */
export interface CacheIo {
  probe?: (path: string) => Promise<{ exists: boolean; bytes: number }>
  remove?: (path: string) => Promise<void>
  save?: (bytes: Uint8Array, hash: string) => Promise<string>
  list?: () => Promise<Array<{ name: string; url: string }>>
}

/**
 * 查缓存：命中返回本地路径，否则 null（由调用方去合成）。
 * 死条目（文件丢了 / 0 字节 / 老库已过期）当场删除，下次播放会重新合成并回填。
 */
export async function lookupAudio(meta: CacheMeta, deps: CacheIo = {}): Promise<string | null> {
  const hash = cacheKey(meta)
  let row: AudioCacheRow | null = null
  try {
    row = await getAudioCacheRow(hash, meta.lang, meta.vcn, meta.speed)
  } catch (e) {
    logger.warn('tts.cache.lookup.fail', { lang: meta.lang, msg: errText(e) })
    sessionMiss++
    return null
  }
  if (!row) { sessionMiss++; return null }

  const expired = Number(row.expired_at) > 0 && Number(row.expired_at) < Date.now()
  const probe = deps.probe ?? probeFile
  const file = await probe(row.path).catch(() => ({ exists: false, bytes: 0 }))
  if (!file.exists || file.bytes <= 0) {
    sessionMiss++
    logger.warn('tts.cache.stale', {
      lang: meta.lang, hash, expired, exists: file.exists, kb: kb(file.bytes),
    })
    await deleteAudioCacheRowByPath(row.path).catch((e) => logger.debug('tts.cache.drop.fail', { msg: errText(e) }))
    return null
  }
  // 老库的按天 TTL 到期后不重合成：文件还在就复活成本地永久缓存（新口径不过期）
  if (expired) logger.debug('tts.cache.revive', { lang: meta.lang, hash })

  sessionHit++
  logger.debug('tts.cache.hit', { lang: meta.lang, hash, hits: Number(row.hits) || 0, kb: kb(file.bytes) })
  // 命中回写失败不影响播放；老库行的 bytes 与 TTL 也要借这次命中修正
  void touchAudio(row, file.bytes, expired)
  return row.path
}

/** 命中回写：hits + 1、last_used_at = now、老库 TTL 清零、缺字节数的补齐。 */
async function touchAudio(row: AudioCacheRow, bytes: number, force = false): Promise<void> {
  const now = Date.now()
  const needBytes = Number(row.bytes) <= 0 && bytes > 0
  if (!force && !needBytes && now - Number(row.last_used_at || 0) < TOUCH_MIN_INTERVAL_MS) return
  try {
    await putAudioCacheRow({
      ...row,
      expired_at: 0,
      bytes: bytes > 0 ? bytes : Number(row.bytes) || 0,
      hits: (Number(row.hits) || 0) + 1,
      last_used_at: now,
    })
  } catch (e) {
    logger.debug('tts.cache.touch.fail', { msg: errText(e) })
  }
}

/**
 * 合成成功后落盘 + 写索引。返回可播放的本地路径。
 * 索引写失败不抛出：音频已经在本地，本次先播，代价只是下次再合成一次。
 */
export async function storeAudio(meta: CacheMeta, bytes: Uint8Array, deps: CacheIo = {}): Promise<string> {
  const hash = cacheKey(meta)
  const save = deps.save ?? saveAudioBytes
  const path = await save(bytes, hash)
  const now = Date.now()
  try {
    await putAudioCacheRow({
      text_hash: hash,
      lang: meta.lang,
      vcn: meta.vcn,
      speed: meta.speed,
      path,
      expired_at: 0,
      bytes: bytes.length,
      hits: 0,
      last_used_at: now,
    })
  } catch (e) {
    logger.warn('tts.cache.index.fail', { lang: meta.lang, hash, msg: errText(e) })
  }
  // 容量检查放到本次播放之后，不阻塞播放
  void evictIfNeeded(deps).catch((e) => logger.debug('tts.cache.evict.skip', { msg: errText(e) }))
  return path
}

export interface Evictable {
  bytes: number
  last_used_at: number
  path: string
}

/**
 * 纯函数：算出该淘汰哪些行。按 last_used_at 升序删到 `limit * targetRatio` 以下。
 * 老库行 bytes 为 0 时不会减少剩余量，淘汰会顺延到后面的行，不会被卡住。
 */
export function pickEvictions<T extends Evictable>(
  rows: T[], total: number, limit = CACHE_LIMIT_BYTES, targetRatio = CACHE_EVICT_RATIO,
): T[] {
  if (limit <= 0 || total <= limit) return []
  const target = Math.floor(limit * targetRatio)
  const out: T[] = []
  let remaining = total
  for (const row of [...rows].sort((a, b) => (Number(a.last_used_at) || 0) - (Number(b.last_used_at) || 0))) {
    if (remaining <= target) break
    out.push(row)
    remaining -= Math.max(0, Number(row.bytes) || 0)
  }
  return out
}

let evicting = false
/** 容量检查节流：每合成一条就统计全表太浪费，一分钟查一次足够 */
let lastEvictCheckAt = 0
const EVICT_CHECK_INTERVAL_MS = 60_000

/** 超过上限就按 LRU 淘汰，行与文件一起删。返回删除条数。 */
export async function evictIfNeeded(deps: CacheIo = {}, force = false): Promise<number> {
  if (evicting) return 0
  const now = Date.now()
  if (!force && now - lastEvictCheckAt < EVICT_CHECK_INTERVAL_MS) return 0
  lastEvictCheckAt = now
  evicting = true
  try {
    const { bytes } = await audioCacheTotals()
    if (bytes <= CACHE_LIMIT_BYTES) return 0
    const drop = pickEvictions(await listAudioCacheRows(), bytes)
    const remove = deps.remove ?? removeFile
    for (const row of drop) {
      await remove(row.path).catch(() => { /* 文件已不在也要删索引 */ })
      await deleteAudioCacheRowByPath(row.path).catch((e) => logger.debug('tts.cache.evict.fail', { msg: errText(e) }))
    }
    logger.info('tts.cache.evict', {
      removed: drop.length, kb: kb(bytes), limitMb: Math.round(CACHE_LIMIT_BYTES / 1048576),
    })
    return drop.length
  } finally {
    evicting = false
  }
}

let swept = false

/**
 * 孤儿清扫：`_doc/audio` 里有、`media_cache` 里没有的 mp3（写文件成功但写索引失败留下的）。
 * 每次启动只跑一次，且只在启动阶段调用 —— 播放中不会误删正在写的文件。
 */
export async function sweepOrphanAudio(deps: CacheIo = {}): Promise<number> {
  if (swept) return 0
  swept = true
  try {
    const files = deps.list ? await deps.list() : await listFiles('audio', '.mp3')
    if (!files.length) return 0
    const known = new Set((await listAudioCacheRows()).map((r) => String(r.path).split('/').pop() || ''))
    const remove = deps.remove ?? removeFile
    let removed = 0
    for (const f of files) {
      if (known.has(f.name)) continue
      await remove(f.url || f.name).catch(() => { /* 删不掉下次再扫 */ })
      removed++
    }
    if (removed) logger.info('tts.cache.sweep', { removed, files: files.length })
    return removed
  } catch (e) {
    logger.warn('tts.cache.sweep.fail', { msg: errText(e) })
    return 0
  }
}

/** 设置页「清理朗读缓存」：删全部音频文件 + 索引行。词库 / 记录 / 设置不受影响。 */
export async function clearAudioCache(deps: CacheIo = {}): Promise<number> {
  const rows = await listAudioCacheRows().catch(() => [] as AudioCacheRow[])
  const remove = deps.remove ?? removeFile
  for (const row of rows) {
    await remove(row.path).catch(() => { /* 文件已不在也要清索引 */ })
  }
  const removed = await clearAudioCacheRows().catch(() => 0)
  logger.info('tts.cache.clear', { rows: rows.length, index: removed })
  return removed
}

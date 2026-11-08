/** 仓储服务：页面 / store 只调这里，不写 SQL，不碰 plus.sqlite 细节。 */
import { getDb, type DbAdapter } from '../utils/db.ts'
import type { ExportBundle, PracticeRecord, Settings, Unit, Word, WordDraft } from './types.ts'
import { DEFAULT_SETTINGS } from './types.ts'

export function newId(prefix = 'w'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

const db = (): DbAdapter => getDb()

/* ---------------- 学习单元 ---------------- */

export async function listUnits(): Promise<Unit[]> {
  return db().all<Unit>('SELECT * FROM unit ORDER BY created_at DESC')
}

export async function getUnit(id: string): Promise<Unit | null> {
  const rows = await db().all<Unit>('SELECT * FROM unit WHERE id = ? LIMIT 1', [id])
  return rows[0] || null
}

export async function createUnit(title: string, sourceImg = ''): Promise<Unit> {
  const unit: Unit = { id: newId('u'), title, source_img: sourceImg, created_at: Date.now() }
  await db().exec(
    'INSERT OR REPLACE INTO unit (id, title, source_img, created_at) VALUES (?, ?, ?, ?)',
    [unit.id, unit.title, unit.source_img, unit.created_at],
  )
  return unit
}

export async function renameUnit(id: string, title: string): Promise<void> {
  await db().exec('UPDATE unit SET title = ? WHERE id = ?', [title, id])
}

export async function deleteUnit(id: string): Promise<void> {
  await db().tx([
    { sql: 'DELETE FROM word WHERE unit_id = ?', params: [id] },
    { sql: 'DELETE FROM unit WHERE id = ?', params: [id] },
  ])
}

/* ---------------- 词条 ---------------- */

export async function listWords(unitId: string): Promise<Word[]> {
  return db().all<Word>('SELECT * FROM word WHERE unit_id = ? ORDER BY sort ASC', [unitId])
}

export async function searchWords(keyword: string): Promise<Word[]> {
  const k = `%${keyword.trim()}%`
  // 分两次查询再合并：内存降级库不支持 OR，SQLite 也避免全表扫描中文列
  const byWord = await db().all<Word>(
    'SELECT * FROM word WHERE word LIKE ? ORDER BY sort ASC LIMIT 200', [k],
  )
  const byTranslation = await db().all<Word>(
    'SELECT * FROM word WHERE translation LIKE ? ORDER BY sort ASC LIMIT 200', [k],
  )
  const merged = new Map<string, Word>()
  for (const w of [...byWord, ...byTranslation]) merged.set(w.id, w)
  return [...merged.values()].sort((a, b) => a.sort - b.sort)
}

export async function getWord(id: string): Promise<Word | null> {
  const rows = await db().all<Word>('SELECT * FROM word WHERE id = ? LIMIT 1', [id])
  return rows[0] || null
}

const WORD_COLS = 'id, unit_id, word, phonetic_uk, phonetic_us, pos, translation, example, audio_path, sort, wrong, wrong_count'
const WORD_HOLDERS = '?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?'

function wordArgs(w: Word): unknown[] {
  return [w.id, w.unit_id, w.word, w.phonetic_uk, w.phonetic_us, w.pos, w.translation,
    w.example, w.audio_path, w.sort, w.wrong, w.wrong_count]
}

export function draftToWord(d: WordDraft, unitId: string, sort: number): Word {
  return {
    id: newId(), unit_id: unitId, word: d.word.trim(),
    phonetic_uk: '', phonetic_us: d.phonetic.trim(), pos: d.pos.trim(),
    translation: d.translation.trim(), example: (d.example || '').trim(),
    audio_path: '', sort, wrong: 0, wrong_count: 0,
  }
}

export async function saveWords(words: Word[]): Promise<void> {
  await db().tx(words.map((w) => ({
    sql: `INSERT OR REPLACE INTO word (${WORD_COLS}) VALUES (${WORD_HOLDERS})`,
    params: wordArgs(w),
  })))
}

export async function saveWord(w: Word): Promise<void> {
  await saveWords([w])
}

export async function deleteWord(id: string): Promise<void> {
  await db().exec('DELETE FROM word WHERE id = ?', [id])
}

/* ---------------- 练习记录 / 错词本 ---------------- */

export async function addRecord(r: PracticeRecord): Promise<void> {
  await db().exec(
    'INSERT OR REPLACE INTO practice_record (id, word_id, mode, input_type, raw_text, asr_text, score, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [r.id, r.word_id, r.mode, r.input_type, r.raw_text, r.asr_text, r.score, r.detail_json, r.created_at],
  )
  // 低分自动进错词本；「已掌握」记录用于移出错词本
  const w = await getWord(r.word_id)
  if (w) {
    if (r.input_type === 'mastered') {
      await db().exec('UPDATE word SET wrong = 0, wrong_count = 0 WHERE id = ?', [w.id])
    } else if (r.score < DEFAULT_SETTINGS.wrongThreshold) {
      await db().exec('UPDATE word SET wrong = 1, wrong_count = wrong_count + 1 WHERE id = ?', [w.id])
    }
  }
}

export async function listRecords(wordId: string, limit = 20): Promise<PracticeRecord[]> {
  return db().all<PracticeRecord>(
    'SELECT * FROM practice_record WHERE word_id = ? ORDER BY created_at DESC LIMIT ?', [wordId, limit],
  )
}

export async function listWrongWords(): Promise<Word[]> {
  return db().all<Word>('SELECT * FROM word WHERE wrong = 1 ORDER BY wrong_count DESC')
}

export async function markMastered(wordId: string): Promise<void> {
  await addRecord({
    id: newId('r'), word_id: wordId, mode: '2.2', input_type: 'mastered',
    raw_text: '', asr_text: '', score: 100, detail_json: '{}', created_at: Date.now(),
  })
}

/* ---------------- 设置 ---------------- */

export async function loadSettings(): Promise<Settings> {
  const rows = await db().all<{ key: string; value: string }>('SELECT * FROM settings')
  const out = { ...DEFAULT_SETTINGS }
  for (const r of rows) {
    try {
      const v = JSON.parse(r.value)
      if (r.key in out) (out as unknown as Record<string, unknown>)[r.key] = v
    } catch (_) { /* 损坏的设置项用默认值 */ }
  }
  return out
}

export async function saveSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
  await db().exec('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, JSON.stringify(value)])
}

/* ---------------- 音频缓存 ---------------- */

export async function getCachedAudio(hash: string, lang: string, vcn: string, speed: number): Promise<string | null> {
  const rows = await db().all<{ path: string; expired_at: number }>(
    'SELECT path, expired_at FROM media_cache WHERE text_hash = ? AND lang = ? AND vcn = ? AND speed = ?',
    [hash, lang, vcn, speed],
  )
  const hit = rows[0]
  if (!hit) return null
  if (hit.expired_at > 0 && hit.expired_at < Date.now()) return null
  return hit.path
}

export async function putCachedAudio(
  hash: string, lang: string, vcn: string, speed: number, path: string, ttlDays = 30,
): Promise<void> {
  await db().exec(
    'INSERT OR REPLACE INTO media_cache (text_hash, lang, vcn, speed, path, expired_at) VALUES (?, ?, ?, ?, ?, ?)',
    [hash, lang, vcn, speed, path, Date.now() + ttlDays * 86400000],
  )
}

/* ---------------- 导入导出（纯本地） ---------------- */

export async function exportBundle(): Promise<ExportBundle> {
  const units = await listUnits()
  const words: Word[] = []
  for (const u of units) words.push(...(await listWords(u.id)))
  return { version: 1, exported_at: Date.now(), units, words }
}

/** 导入：同 id 覆盖，不同 id 追加；返回新增单元数 / 词条数。 */
export async function importBundle(bundle: ExportBundle): Promise<{ units: number; words: number }> {
  if (!bundle || bundle.version !== 1 || !Array.isArray(bundle.units) || !Array.isArray(bundle.words)) {
    throw new Error('文件格式不正确（需要本应用导出的 JSON）')
  }
  const stmts: Array<{ sql: string; params?: unknown[] }> = []
  for (const u of bundle.units) {
    stmts.push({
      sql: 'INSERT OR REPLACE INTO unit (id, title, source_img, created_at) VALUES (?, ?, ?, ?)',
      params: [u.id, u.title, u.source_img || '', u.created_at || Date.now()],
    })
  }
  for (const w of bundle.words) {
    stmts.push({
      sql: `INSERT OR REPLACE INTO word (${WORD_COLS}) VALUES (${WORD_HOLDERS})`,
      params: wordArgs({
        ...w, phonetic_uk: w.phonetic_uk || '', phonetic_us: w.phonetic_us || '',
        pos: w.pos || '', example: w.example || '', audio_path: '',
        sort: Number(w.sort) || 0, wrong: Number(w.wrong) || 0, wrong_count: Number(w.wrong_count) || 0,
      }),
    })
  }
  await db().tx(stmts)
  return { units: bundle.units.length, words: bundle.words.length }
}

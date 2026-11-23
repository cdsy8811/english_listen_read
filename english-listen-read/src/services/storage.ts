/** 仓储服务：页面 / store 只调这里，不写 SQL，不碰 plus.sqlite 细节。 */
import { getDb, type DbAdapter } from '../utils/db.ts'
import { logger } from '../utils/log.ts'
import type { ExportBundle, PracticeRecord, ReadArticle, ReadRecord, Settings, StudySession, Unit, Word, WordDraft } from './types.ts'
import { DEFAULT_SETTINGS } from './types.ts'
import { parseSentences, parseTranslations } from './passage.ts'

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

/**
 * 朗读音频缓存行。`expired_at = 0` 表示永不过期；老库里按天过期的行仍按原语义判失效。
 * 容量与命中统计在 `services/tts-cache.ts`，这里只做 SQL 原语。
 */
export interface AudioCacheRow {
  text_hash: string
  lang: string
  vcn: string
  speed: number
  path: string
  expired_at: number
  bytes: number
  hits: number
  last_used_at: number
}

const AUDIO_COLS = 'text_hash, lang, vcn, speed, path, expired_at, bytes, hits, last_used_at'
const AUDIO_HOLDERS = '?, ?, ?, ?, ?, ?, ?, ?, ?'

function audioArgs(r: AudioCacheRow): unknown[] {
  return [
    r.text_hash, r.lang, r.vcn, r.speed, r.path, r.expired_at,
    Math.max(0, Math.floor(r.bytes || 0)), Math.max(0, Math.floor(r.hits || 0)),
    Math.max(0, Math.floor(r.last_used_at || 0)),
  ]
}

export async function getAudioCacheRow(
  hash: string, lang: string, vcn: string, speed: number,
): Promise<AudioCacheRow | null> {
  const rows = await db().all<AudioCacheRow>(
    'SELECT * FROM media_cache WHERE text_hash = ? AND lang = ? AND vcn = ? AND speed = ? LIMIT 1',
    [hash, lang, vcn, speed],
  )
  return rows[0] || null
}

export async function putAudioCacheRow(row: AudioCacheRow): Promise<void> {
  await db().exec(
    `INSERT OR REPLACE INTO media_cache (${AUDIO_COLS}) VALUES (${AUDIO_HOLDERS})`,
    audioArgs(row),
  )
}

/** 按 path 删除：path = `_doc/audio/<hash>.mp3`，对每行唯一，且单条件 WHERE 两端实现都支持。 */
export async function deleteAudioCacheRowByPath(path: string): Promise<void> {
  await db().exec('DELETE FROM media_cache WHERE path = ?', [path])
}

/** 淘汰顺序：最久没播过的在前。 */
export async function listAudioCacheRows(): Promise<AudioCacheRow[]> {
  return db().all<AudioCacheRow>('SELECT * FROM media_cache ORDER BY last_used_at ASC')
}

/** 总量：行数 + 已知字节数（老库行 bytes 为 0，首次命中时会回填）。 */
export async function audioCacheTotals(): Promise<{ count: number; bytes: number }> {
  const rows = await db().all<{ bytes?: number }>('SELECT bytes FROM media_cache')
  return {
    count: rows.length,
    bytes: rows.reduce((n, r) => n + Math.max(0, Number(r.bytes) || 0), 0),
  }
}

export async function clearAudioCacheRows(): Promise<number> {
  const { count } = await audioCacheTotals()
  if (count) await db().exec('DELETE FROM media_cache')
  return count
}

/* ---------------- 跟读文章 / 跟读记录 ---------------- */

interface ArticleRow {
  id: string
  title: string
  source_img: string
  content: string
  /** 老库没有这一列（migrate 会补），读不到按无译文处理 */
  translations?: string
  created_at: number
}

function rowToArticle(row: ArticleRow): ReadArticle {
  const sentences = parseSentences(row.content)
  const zh = parseTranslations(row.translations || '[]')
  return {
    id: row.id,
    title: row.title || '跟读短文',
    source_img: row.source_img || '',
    sentences,
    translations: sentences.map((_, i) => zh[i] || ''),
    created_at: Number(row.created_at) || 0,
  }
}

export async function listArticles(): Promise<ReadArticle[]> {
  const rows = await db().all<ArticleRow>('SELECT * FROM read_article ORDER BY created_at DESC')
  return rows.map(rowToArticle)
}

export async function getArticle(id: string): Promise<ReadArticle | null> {
  const rows = await db().all<ArticleRow>('SELECT * FROM read_article WHERE id = ? LIMIT 1', [id])
  return rows[0] ? rowToArticle(rows[0]) : null
}

export async function createArticle(input: {
  title: string
  sentences: string[]
  /** 逐句中文译文（可选，与 sentences 等长；缺的补空） */
  translations?: string[]
  sourceImg?: string
}): Promise<ReadArticle> {
  const sentences = input.sentences.map((s) => String(s).trim()).filter(Boolean)
  const article: ReadArticle = {
    id: newId('ra'),
    title: (input.title || '').trim().slice(0, 40) || '跟读短文',
    source_img: input.sourceImg || '',
    sentences,
    translations: sentences.map((_, i) => String(input.translations?.[i] ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)),
    created_at: Date.now(),
  }
  await db().exec(
    'INSERT OR REPLACE INTO read_article (id, title, source_img, content, translations, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [
      article.id, article.title, article.source_img,
      JSON.stringify(article.sentences), JSON.stringify(article.translations), article.created_at,
    ],
  )
  logger.info('read.article.create', {
    sentences: article.sentences.length, translated: article.translations.filter(Boolean).length,
  })
  return article
}

export async function renameArticle(id: string, title: string): Promise<void> {
  const name = String(title || '').trim().slice(0, 40)
  if (!name) return
  await db().exec('UPDATE read_article SET title = ? WHERE id = ?', [name, id])
}

/** 补写逐句中文译文（学习页为老文章生成翻译后回写）。 */
export async function updateArticleTranslations(id: string, translations: string[]): Promise<void> {
  const list = translations.map((t) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, 300))
  await db().exec('UPDATE read_article SET translations = ? WHERE id = ?', [JSON.stringify(list), id])
  logger.info('read.article.translations', { id, translated: list.filter(Boolean).length })
}

export async function deleteArticle(id: string): Promise<void> {
  await db().tx([
    { sql: 'DELETE FROM read_record WHERE article_id = ?', params: [id] },
    { sql: 'DELETE FROM read_article WHERE id = ?', params: [id] },
  ])
}

export async function addReadRecord(r: ReadRecord): Promise<void> {
  await db().exec(
    'INSERT OR REPLACE INTO read_record (id, article_id, sentence_index, asr_text, score, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [r.id, r.article_id, r.sentence_index, r.asr_text, r.score, r.detail_json, r.created_at],
  )
}

/* ---------------- 学习记录（练习 / 跟读的时长与概况） ---------------- */

export async function addStudySession(s: StudySession): Promise<void> {
  await db().exec(
    `INSERT OR REPLACE INTO study_session
      (id, kind, mode, unit_id, title, started_at, ended_at, duration_sec, total, answered, passed, avg_score, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      s.id, s.kind, s.mode, s.unit_id, s.title, s.started_at, s.ended_at, s.duration_sec,
      s.total, s.answered, s.passed, s.avg_score, s.created_at,
    ],
  )
  logger.info('study.session.add', {
    kind: s.kind, mode: s.mode, sec: s.duration_sec, answered: s.answered, avg: s.avg_score,
  })
}

export async function listStudySessions(limit = 100): Promise<StudySession[]> {
  const n = Math.max(1, Math.min(500, Math.floor(limit)))
  const rows = await db().all<StudySession>(
    `SELECT * FROM study_session ORDER BY started_at DESC LIMIT ${n}`,
  )
  return rows.map((r) => ({
    ...r,
    started_at: Number(r.started_at) || 0,
    ended_at: Number(r.ended_at) || 0,
    duration_sec: Number(r.duration_sec) || 0,
    total: Number(r.total) || 0,
    answered: Number(r.answered) || 0,
    passed: Number(r.passed) || 0,
    avg_score: Number(r.avg_score) || 0,
    created_at: Number(r.created_at) || 0,
  }))
}

export async function clearStudySessions(): Promise<void> {
  await db().exec('DELETE FROM study_session')
  logger.info('study.session.clear', {})
}

/** 按时间倒序取跟读记录；内存降级库只认字面量 LIMIT，所以限制值内联。 */
export async function listReadRecords(articleId: string, limit = 300): Promise<ReadRecord[]> {
  const n = Math.max(1, Math.min(500, Math.floor(limit)))
  const rows = await db().all<ReadRecord>(
    `SELECT * FROM read_record WHERE article_id = ? ORDER BY created_at DESC LIMIT ${n}`,
    [articleId],
  )
  return rows.map((r) => ({
    ...r,
    sentence_index: Number(r.sentence_index) || 0,
    score: Number(r.score) || 0,
    created_at: Number(r.created_at) || 0,
  }))
}

/** 每句取最近一次得分，供学习页显示「这句已经读到多少分」。 */
export async function latestSentenceScores(articleId: string): Promise<Record<number, number>> {
  const records = await listReadRecords(articleId)
  const out: Record<number, number> = {}
  for (const r of records) {
    if (out[r.sentence_index] === undefined) out[r.sentence_index] = r.score
  }
  return out
}

export interface ReadArticleSummary extends ReadArticle {
  /** 已检查过的句子数 */
  checked: number
  /** 已检查句子的平均分；未检查为 0 */
  lastScore: number
  /** 最近一次检查时间 */
  lastAt: number
}

export async function listArticleSummaries(): Promise<ReadArticleSummary[]> {
  const articles = await listArticles()
  const out: ReadArticleSummary[] = []
  for (const a of articles) {
    const records = await listReadRecords(a.id)
    const latest = new Map<number, number>()
    for (const r of records) {
      if (!latest.has(r.sentence_index)) latest.set(r.sentence_index, r.score)
    }
    const scores = [...latest.values()]
    out.push({
      ...a,
      checked: latest.size,
      lastScore: scores.length ? Math.round(scores.reduce((x, y) => x + y, 0) / scores.length) : 0,
      lastAt: records[0]?.created_at || 0,
    })
  }
  return out
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

/**
 * 清空词库：单元 / 词条 / 练习记录（错词本由记录与词条字段决定）全部删除。
 * 设置与音频缓存保留——缓存按文本哈希索引，重新导入同样的词可直接复用。
 */
export async function clearLibrary(): Promise<{ units: number; words: number; records: number }> {
  const units = await db().all<Unit>('SELECT * FROM unit')
  const words = await db().all<Word>('SELECT * FROM word')
  const records = await db().all<PracticeRecord>('SELECT * FROM practice_record')
  await db().tx([
    { sql: 'DELETE FROM practice_record' },
    { sql: 'DELETE FROM word' },
    { sql: 'DELETE FROM unit' },
  ])
  logger.info('library.clear', { units: units.length, words: words.length, records: records.length })
  return { units: units.length, words: words.length, records: records.length }
}

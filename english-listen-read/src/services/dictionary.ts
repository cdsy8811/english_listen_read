/**
 * 电子词典：中英互查 + 本地缓存 + 查询历史。
 *
 * 数据来源分两层：
 *  1. 我的词库（离线，`services/storage.searchWords`）；页面层直接查，先命中先展示。
 *  2. Spark X2.6 生成的双语词典条目（联网，查过即写 `dict_cache`，断网可复看）。
 *
 * 本文件里的 prompt / 清洗都是纯函数，可离线自测；云调用走 `api/xfyun-dict.ts`。
 */
import type { ChatMessage } from '../api/xfyun-maas.ts'
import { dictChatJson } from '../api/xfyun-dict.ts'
import { getDb } from '../utils/db.ts'
import { CloudError, logger } from '../utils/log.ts'
import { cleanPhonetic, cleanPos } from './parser.ts'
import { searchWords } from './storage.ts'
import type { Accent } from './types.ts'

export type DictLanguage = 'en' | 'zh'

export interface DictExample { en: string; zh: string }

export interface DictSense {
  pos: string
  def_zh: string
  def_en: string
  examples: DictExample[]
}

export interface DictEntry {
  /** 规范拼写（查变形时已还原为原形） */
  word: string
  /** 查询词本身是变形时给出原形，否则为空 */
  base: string
  phonetic_uk: string
  phonetic_us: string
  /** 词形变化：复数 / 过去式 / 现在分词 / 比较级… */
  forms: string[]
  senses: DictSense[]
  phrases: Array<{ en: string; zh: string }>
  synonyms: string[]
  antonyms: string[]
  /** 用法提示 / 易混提醒，可为空 */
  notes: string
}

export interface DictCandidate {
  word: string
  phonetic_us: string
  pos: string
  brief: string
}

/** 跟读页点词用的速览：只有单词 / 音标 / 中文释义。 */
export interface DictGloss {
  word: string
  phonetic: string
  brief: string
}

/** 速览 + 来源：library = 我的词库；cache = 查过并缓存（离线可用）；cloud = 本次联网查到 */
export interface DictGlossResult extends DictGloss {
  source: 'library' | 'cache' | 'cloud'
}

export type DictLookup =
  | { kind: 'en'; query: string; entry: DictEntry; cached: boolean; at: number }
  | { kind: 'zh'; query: string; candidates: DictCandidate[]; cached: boolean; at: number }

export interface DictHistoryItem {
  id: string
  query: string
  lang: DictLanguage
  created_at: number
}

/* ---------------- 纯函数：查询识别 / prompt ---------------- */

/** 含汉字按中文查，其余按英文查（英文短语、缩写都归英文）。 */
export function detectQueryLang(query: string): DictLanguage {
  return /[\u3400-\u9fff]/.test(query) ? 'zh' : 'en'
}

/** 规范化查询词：去首尾空白、压缩空白、全角转半角（中文释义常带全角标点）。 */
export function normalizeQuery(raw: string): string {
  return String(raw ?? '')
    .replace(/[\u3000]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
}

export function dictCacheId(lang: DictLanguage, query: string): string {
  const q = normalizeQuery(query)
  return `${lang}:${lang === 'en' ? q.toLowerCase() : q}`
}

export const DICT_SYSTEM = '你是英汉双解词典编写助手。只输出严格 JSON，不要解释、不要代码块。'

export function buildEntryPrompt(query: string): string {
  return [
    `请为英文单词或短语“${query}”编写一条英汉双解词典条目，只输出 JSON。`,
    '格式：{"entry":{"word":"","base":"","phonetic_uk":"","phonetic_us":"","forms":[""],',
    '"senses":[{"pos":"","def_zh":"","def_en":"","examples":[{"en":"","zh":""}]}],',
    '"phrases":[{"en":"","zh":""}],"synonyms":[""],"antonyms":[""],"notes":""}}',
    '要求：',
    '1. word 写规范原形；若查询词是变形（running / children / went），word 还原为原形，base 也写原形；否则 base 留空。',
    '2. phonetic_uk / phonetic_us 写标准 IPA，用 /.../ 包裹，英式与美式分开；不确定就留空，不要编造。',
    '3. senses 按词性分组，最多 5 组；每组 1–3 条中文释义，def_zh 用简体中文、简洁准确，def_en 用不超过 15 个词的简单英文解释。',
    '4. 每组给 1–2 个例句：en 是自然英文（8–18 词），zh 是准确的中文翻译；例句要体现该词性下的典型用法。',
    '5. phrases 最多 6 条常用搭配；synonyms / antonyms 各最多 6 个单词；notes 可写用法提示或易混词，没有就留空。',
    '6. 只输出与查询词相关的内容，不要输出其他词条；无法确认的字段用空字符串或空数组。',
  ].join('\n')
}

export function buildCandidatePrompt(query: string): string {
  return [
    `用户输入的中文是“${query}”。请给出它最可能对应的英语单词，只输出 JSON。`,
    '格式：{"candidates":[{"word":"","phonetic_us":"","pos":"","brief":""}]}',
    '要求：',
    '1. 给 6–8 个候选，按常用度从高到低排序；word 一律用原形。',
    '2. brief 是 20 字以内的中文简释（如“放弃；抛弃”），pos 用 v. / n. / adj. 等缩写。',
    '3. phonetic_us 写标准美式 IPA，用 /.../ 包裹；不确定留空。',
    '4. 只输出单词候选，不要输出例句或解释段落。',
  ].join('\n')
}

export function entryMessages(query: string): ChatMessage[] {
  return [
    { role: 'system', content: DICT_SYSTEM },
    { role: 'user', content: buildEntryPrompt(query) },
  ]
}

export function candidateMessages(query: string): ChatMessage[] {
  return [
    { role: 'system', content: DICT_SYSTEM },
    { role: 'user', content: buildCandidatePrompt(query) },
  ]
}

/* ---------------- 纯函数：模型结果清洗 ---------------- */

const MAX_SENSES = 6
const MAX_EXAMPLES = 3
const MAX_PHRASES = 8
const MAX_LIST = 8

function text(v: unknown, max = 240): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : ''
}

function headword(v: unknown): string {
  return text(v, 48).replace(/[^A-Za-z' -]/g, '').replace(/\s+/g, ' ').trim()
}

function list(v: unknown, max: number, eachMax = 48): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of v) {
    const s = text(item, eachMax)
    const key = s.toLowerCase()
    if (!s || seen.has(key)) continue
    seen.add(key)
    out.push(s)
    if (out.length >= max) break
  }
  return out
}

export function normalizeExamples(v: unknown): DictExample[] {
  if (!Array.isArray(v)) return []
  const out: DictExample[] = []
  const seen = new Set<string>()
  for (const item of v) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const en = text(r.en, 220)
    if (!en || seen.has(en.toLowerCase())) continue
    seen.add(en.toLowerCase())
    out.push({ en, zh: text(r.zh, 220) })
    if (out.length >= MAX_EXAMPLES) break
  }
  return out
}

export function normalizeSenses(v: unknown): DictSense[] {
  if (!Array.isArray(v)) return []
  const out: DictSense[] = []
  for (const item of v) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const defZh = text(r.def_zh, 180)
    const defEn = text(r.def_en, 220)
    if (!defZh && !defEn) continue
    out.push({
      pos: cleanPos(text(r.pos, 16)),
      def_zh: defZh,
      def_en: defEn,
      examples: normalizeExamples(r.examples),
    })
    if (out.length >= MAX_SENSES) break
  }
  return out
}

export function normalizePhrases(v: unknown): Array<{ en: string; zh: string }> {
  if (!Array.isArray(v)) return []
  const out: Array<{ en: string; zh: string }> = []
  const seen = new Set<string>()
  for (const item of v) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const en = text(r.en, 120)
    if (!en || seen.has(en.toLowerCase())) continue
    seen.add(en.toLowerCase())
    out.push({ en, zh: text(r.zh, 120) })
    if (out.length >= MAX_PHRASES) break
  }
  return out
}

/**
 * 清洗一条词典条目。模型偶尔会把 JSON 包在 `{entry:{...}}` 里，也偶尔直接给条目对象；
 * 两种都接。拿不到 word 时视为无效结果（交上层提示重试）。
 */
export function normalizeEntry(raw: unknown): DictEntry {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const inner = (obj.entry && typeof obj.entry === 'object' ? obj.entry : obj) as Record<string, unknown>
  const word = headword(inner.word)
  const senses = normalizeSenses(inner.senses)
  if (!word || !senses.length) {
    logger.warn('dict.normalize.empty', { hasWord: !!word, senses: senses.length })
    throw new CloudError('词典没有返回有效释义，请换个词试试', 0, undefined, true)
  }
  const base = headword(inner.base)
  return {
    word,
    base: base && base.toLowerCase() !== word.toLowerCase() ? base : '',
    phonetic_uk: cleanPhonetic(text(inner.phonetic_uk, 60)),
    phonetic_us: cleanPhonetic(text(inner.phonetic_us, 60)),
    forms: list(inner.forms, MAX_LIST, 60),
    senses,
    phrases: normalizePhrases(inner.phrases),
    synonyms: list(inner.synonyms, MAX_LIST),
    antonyms: list(inner.antonyms, MAX_LIST),
    notes: text(inner.notes, 400),
  }
}

export function normalizeCandidates(raw: unknown): DictCandidate[] {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const arr = Array.isArray(obj.candidates) ? obj.candidates
    : Array.isArray(obj.items) ? obj.items
      : Array.isArray(raw) ? raw
        : []
  const out: DictCandidate[] = []
  const seen = new Set<string>()
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const word = headword(r.word)
    if (!word || seen.has(word.toLowerCase())) continue
    seen.add(word.toLowerCase())
    out.push({
      word,
      phonetic_us: cleanPhonetic(text(r.phonetic_us, 60)),
      pos: cleanPos(text(r.pos, 16)),
      brief: text(r.brief ?? r.def_zh ?? r.translation, 80),
    })
    if (out.length >= MAX_LIST) break
  }
  if (!out.length) throw new CloudError('没有找到对应的英文单词，换个说法试试', 0, undefined, true)
  return out
}

/* ---------------- 缓存 / 历史（走本地库，断网可用） ---------------- */

interface CacheRow {
  id: string
  query: string
  lang: string
  payload: string
  created_at: number
}

async function readCache(id: string): Promise<DictLookup | null> {
  const rows = await getDb().all<CacheRow>('SELECT * FROM dict_cache WHERE id = ? LIMIT 1', [id])
  const row = rows[0]
  if (!row) return null
  try {
    const payload = JSON.parse(row.payload) as Record<string, unknown>
    const at = Number(row.created_at) || 0
    if (row.lang === 'en') {
      return { kind: 'en', query: row.query, entry: normalizeEntry(payload.entry), cached: true, at }
    }
    return { kind: 'zh', query: row.query, candidates: normalizeCandidates(payload.candidates), cached: true, at }
  } catch (e) {
    logger.warn('dict.cache.broken', { name: (e as Error).name })
    return null
  }
}

export async function putDictCache(lookup: DictLookup): Promise<void> {
  const id = dictCacheId(lookup.kind, lookup.query)
  const payload = JSON.stringify(
    lookup.kind === 'en' ? { v: 1, entry: lookup.entry } : { v: 1, candidates: lookup.candidates },
  )
  await getDb().exec(
    'INSERT OR REPLACE INTO dict_cache (id, query, lang, payload, created_at) VALUES (?, ?, ?, ?, ?)',
    [id, lookup.query, lookup.kind, payload, lookup.at],
  )
}

export async function clearDictCache(): Promise<void> {
  await getDb().exec('DELETE FROM dict_cache')
}

/** 只读缓存（不做云调用）；页面「重新查询」与自测都用得到。 */
export async function readCachedDictionary(rawQuery: string): Promise<DictLookup | null> {
  const q = normalizeQuery(rawQuery)
  if (!q) return null
  return readCache(dictCacheId(detectQueryLang(q), q))
}

/** 最近查询：同一个词只留一条，重复查询更新时间。 */
export async function pushDictHistory(query: string, lang: DictLanguage): Promise<void> {
  const q = normalizeQuery(query)
  if (!q) return
  await getDb().exec(
    'INSERT OR REPLACE INTO dict_history (id, query, lang, created_at) VALUES (?, ?, ?, ?)',
    [dictCacheId(lang, q), q, lang, Date.now()],
  )
}

export async function listDictHistory(limit = 12): Promise<DictHistoryItem[]> {
  return getDb().all<DictHistoryItem>(
    'SELECT * FROM dict_history ORDER BY created_at DESC LIMIT ?', [limit],
  )
}

export async function clearDictHistory(): Promise<void> {
  await getDb().exec('DELETE FROM dict_history')
}

/* ---------------- 查询入口 ---------------- */

/**
 * 查词：先读本地缓存（断网可复看），再走模型。
 * 中文查询返回候选词；英文查询返回完整条目。
 */
export async function lookupDictionary(rawQuery: string, opts: { force?: boolean } = {}): Promise<DictLookup> {
  const query = normalizeQuery(rawQuery)
  if (!query) throw new CloudError('请输入要查询的英文单词或中文释义', 0, undefined, false)
  const lang = detectQueryLang(query)
  const id = dictCacheId(lang, query)

  const cached = opts.force ? null : await readCache(id)
  if (cached) {
    logger.debug('dict.cache.hit', { lang, chars: query.length })
    return cached
  }

  const t0 = Date.now()
  logger.debug('dict.req', { lang, chars: query.length })
  try {
    const raw = await dictChatJson<unknown>(lang === 'en' ? entryMessages(query) : candidateMessages(query))
    const at = Date.now()
    const result: DictLookup = lang === 'en'
      ? { kind: 'en', query, entry: normalizeEntry(raw), cached: false, at }
      : { kind: 'zh', query, candidates: normalizeCandidates(raw), cached: false, at }
    await putDictCache(result)
    logger.debug('dict.ok', {
      lang,
      senses: result.kind === 'en' ? result.entry.senses.length : 0,
      candidates: result.kind === 'zh' ? result.candidates.length : 0,
      ms: Date.now() - t0,
    })
    return result
  } catch (e) {
    if ((e as CloudError).code === -1) throw e
    logger.warn('dict.fail', { lang, ms: Date.now() - t0 })
    throw new CloudError('网络或词典服务暂时不可用，请稍后重试', 0, undefined, true)
  }
}

/* ---------------- 点词速览：跟读页用 ---------------- */

/* 只问「音标 + 1–3 条中文释义」，输出 ~50 个 token；完整词条要例句 / 搭配 / 同义词，慢一个量级。 */
const MAX_GLOSS_WORDS = 10

export const GLOSS_SYSTEM = '你是英汉词典速查助手。只输出严格 JSON，不要解释、不要代码块。'

export function buildGlossPrompt(words: string[]): string {
  return [
    `给出下列英文单词的词典速览，只输出 JSON：${JSON.stringify(words)}`,
    '格式：{"items":[{"word":"","phonetic_us":"","brief":""}]}',
    '要求：',
    '1. 每个输入词输出一条，word 原样返回输入（是 walked / children 这类变形也保留原形拼写）。',
    '2. brief 只写 1–3 条最常用的简体中文释义，用「；」分隔，不超过 30 字；不要词性、不要例句、不要搭配。',
    '3. phonetic_us 写这个输入词实际读音的美式 IPA，用 /.../ 包裹；不确定留空，不要编造。',
    '4. 不要输出同义词、反义词、用法说明或任何解释性文字。',
  ].join('\n')
}

export function glossMessages(words: string[]): ChatMessage[] {
  return [
    { role: 'system', content: GLOSS_SYSTEM },
    { role: 'user', content: buildGlossPrompt(words) },
  ]
}

/** 速览结果清洗：保留不会说话的字段只留 word / phonetic / brief。 */
export function normalizeGlosses(raw: unknown): DictGloss[] {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const arr = Array.isArray(obj.items) ? obj.items
    : Array.isArray(obj.words) ? obj.words
      : Array.isArray(raw) ? raw
        : []
  const out: DictGloss[] = []
  const seen = new Set<string>()
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const word = headword(r.word)
    const brief = text(r.brief ?? r.def_zh ?? r.translation, 80)
    if (!word || !brief) continue
    const key = word.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ word, phonetic: cleanPhonetic(text(r.phonetic_us ?? r.phonetic, 60)), brief })
    if (out.length >= MAX_GLOSS_WORDS) break
  }
  return out
}

/* ---------------- 速览缓存（与完整词典分开，断网可复看） ---------------- */

interface GlossRow {
  id: string
  word: string
  payload: string
  created_at: number
}

async function readGlossCache(word: string): Promise<DictGloss | null> {
  const rows = await getDb().all<GlossRow>('SELECT * FROM gloss_cache WHERE id = ? LIMIT 1', [word])
  const row = rows[0]
  if (!row) return null
  try {
    const p = JSON.parse(row.payload) as Partial<DictGloss>
    const brief = text(p.brief, 80)
    if (!brief) return null
    return { word: row.word || word, phonetic: cleanPhonetic(text(p.phonetic, 60)), brief }
  } catch (e) {
    logger.warn('gloss.cache.broken', { name: (e as Error).name })
    return null
  }
}

async function writeGlossCache(items: DictGloss[]): Promise<void> {
  if (!items.length) return
  const now = Date.now()
  await getDb().tx(items.map((g) => ({
    sql: 'INSERT OR REPLACE INTO gloss_cache (id, word, payload, created_at) VALUES (?, ?, ?, ?)',
    params: [g.word.toLowerCase(), g.word, JSON.stringify({ phonetic: g.phonetic, brief: g.brief }), now],
  })))
}

export async function clearGlossCache(): Promise<void> {
  await getDb().exec('DELETE FROM gloss_cache')
}

/** 单次速览请求：输出很短，20s 超时足够；批量最多 10 个词。 */
async function fetchGlosses(words: string[]): Promise<DictGloss[]> {
  const raw = await dictChatJson<unknown>(glossMessages(words), { maxTokens: 900, timeout: 20000 })
  const items = normalizeGlosses(raw)
  if (items.length) await writeGlossCache(items)
  logger.debug('gloss.ok', { asked: words.length, got: items.length })
  return items
}

/**
 * 跟读页点词/预取用的速览：按代价从低到高，一次调用可查一组词。
 * 1. 我的词库精确命中（纯离线、即时，不消耗模型额度）；
 * 2. `gloss_cache` 查过的速览（离线可复看，永不过期）；
 * 3. 一次批量请求 X2.6 速览 prompt（句内单词合并成一条请求）。
 * 返回的列表按请求顺序的命中项排列；模型漏掉的词由上层显示「未收录」。
 */
export async function lookupGlosses(
  rawWords: string[],
  opts: { accent?: Accent } = {},
): Promise<DictGlossResult[]> {
  const wantUk = opts.accent === 'UK'
  const asked: string[] = []
  const seen = new Set<string>()
  for (const raw of rawWords) {
    const w = normalizeQuery(raw)
    const key = w.toLowerCase()
    if (!w || !/^[A-Za-z][A-Za-z' -]*$/.test(w) || seen.has(key)) continue
    seen.add(key)
    asked.push(w)
    if (asked.length >= MAX_GLOSS_WORDS) break
  }
  if (!asked.length) return []

  const hits: DictGlossResult[] = []
  const pending: string[] = []
  for (const word of asked) {
    const key = word.toLowerCase()
    const local = (await searchWords(word)).find((w) => w.word.toLowerCase() === key)
    if (local && local.translation.trim()) {
      hits.push({
        word: local.word,
        phonetic: wantUk ? local.phonetic_uk || local.phonetic_us : local.phonetic_us || local.phonetic_uk,
        brief: local.translation.trim(),
        source: 'library',
      })
      continue
    }
    const cached = await readGlossCache(key)
    if (cached) { hits.push({ ...cached, source: 'cache' }); continue }
    pending.push(word)
  }

  if (!pending.length) return hits
  const t0 = Date.now()
  logger.debug('gloss.req', { words: pending.length })
  try {
    const fetched = await fetchGlosses(pending)
    const byKey = new Map(fetched.map((g) => [g.word.toLowerCase(), g]))
    const out = [...hits]
    for (const word of pending) {
      const hit = byKey.get(word.toLowerCase())
      if (hit) out.push({ ...hit, source: 'cloud' })
    }
    logger.debug('gloss.done', { asked: pending.length, got: fetched.length, ms: Date.now() - t0 })
    return out
  } catch (e) {
    if ((e as CloudError).code === -1) throw e
    logger.warn('gloss.fail', { words: pending.length, ms: Date.now() - t0 })
    throw new CloudError('网络或词典服务暂时不可用，请稍后重试', 0, undefined, true)
  }
}

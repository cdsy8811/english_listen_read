/**
 * 结构化抽取：把 OCR 的 markdown 交给 Spark X2.6 整理成严格词条 JSON。
 * P0 实测关键结论：
 *  - OCR 对 IPA 音标 3/3 损坏（☐ / $\square），prompt 必须显式要求「忽略 OCR 音标，
 *    按单词重新生成标准 IPA」，否则模型会照抄乱码；
 *  - 词性可能被 markdown 公式污染成 `v.$`，必须清洗；
 *  - temperature 0.1 才能稳定返回严格 JSON。
 * 本文件的清洗逻辑是纯函数，可离线自测；云调用走能力层注入。
 */
import type { ChatMessage } from '../api/xfyun-maas.ts'
import { logger } from '../utils/log.ts'
import type { WordDraft } from './types.ts'

export const EXTRACT_SYSTEM = '你是英语单词表整理助手。只输出严格 JSON，不要解释、不要代码块。'

export function buildExtractPrompt(markdown: string): string {
  logger.debug('extract.prompt', { markdownChars: markdown.length, usedChars: Math.min(4000, markdown.length) })
  return [
    '下面是从单词表图片 OCR 出来的 markdown 文本。请抽取每个词条，只输出 JSON，不要解释、不要代码块。',
    '格式：{"items":[{"word":"","phonetic":"","pos":"","translation":""}]}',
    '要求：',
    '1. OCR 会把 IPA 音标识别成方框 / LaTeX 公式等乱码，因此 phonetic 必须**完全忽略原文里的音标**，根据单词重新写出标准英式 IPA 音标，并用 /.../ 包裹。',
    '2. word 只保留英文单词本身（去掉序号、音标、词性、中文）；大小写按单词表惯例（一般小写）。',
    '3. pos 统一用词性缩写（v. / n. / adj. / adv. / prep. 等）；原文若带公式符号（如 v.$）一律去掉，只保留缩写；无法判断则留空。',
    '4. translation 只保留中文释义，去掉英文例句与音标；多个义项沿用原文标点（逗号就写逗号，别硬改成别的符号）。',
    '5. 每个词一条，不要合并、不要编造；不确定的字段留空字符串。',
    '6. OCR 常把右侧页码（如 40、41、48）粘在释义后面，或在释义中间插入空行把一句话断开：页码一律丢弃，被换行拆开的释义要接成一句完整的，不能截断。',
    '7. 像「## Unit 3」这样的标题、页码、页眉页脚、勾选记号（✓、T 等）都不是词条，不要输出。',
    '',
    'OCR 文本：',
    markdown.slice(0, 4000),
  ].join('\n')
}

export function extractMessages(markdown: string): ChatMessage[] {
  return [
    { role: 'system', content: EXTRACT_SYSTEM },
    { role: 'user', content: buildExtractPrompt(markdown) },
  ]
}

/** 清洗词性：实测 `v.$` / `n.$` / `v．` 等污染，统一成 `v.` 形式。 */
export function cleanPos(raw: string): string {
  if (!raw) return ''
  let s = String(raw).trim()
    .replace(/[．。]/g, '.')
    .replace(/\\?\$?square|□|☐|\\\$/g, '')  // 去掉 LaTeX 公式残留
    .replace(/\$[^A-Za-z]*$/g, '')          // 去掉结尾的 $
    .replace(/[（(].*?[)）]/g, '')
    .replace(/[^A-Za-z.]/g, '')
    .trim()
  // 长缩写优先（vt. / vi. / adj. …），避免 `vt` 被 `v` 抢先匹配
  const m = /(vt|vi|adj|adv|prep|pron|conj|int|num|art|aux|abbr|n|v)\.?/i.exec(s)
  if (!m) return ''
  return m[1].toLowerCase() + '.'
}

/** 音标：只接受 /.../ 包裹且含 IPA 字符的结果；乱码一律丢弃（宁可留空由校对页补）。 */
export function cleanPhonetic(raw: string): string {
  if (!raw) return ''
  const s = String(raw).trim()
  // 只要出现方框、反斜杠、$ 或 LaTeX 残留就丢弃；正常 IPA 不含这些字符
  if (/[☐□$\\]|square/i.test(s)) return ''
  const m = /^\/?([^/]+)\/?$/.exec(s)
  if (!m) return ''
  const inner = m[1].trim()
  if (!inner || inner.length > 40) return ''
  return `/${inner}/`
}

/** 词条清洗：丢弃 OCR 音标残留、规范化单词与释义，去重。 */
export function normalizeDrafts(items: unknown[]): WordDraft[] {
  const out: WordDraft[] = []
  const seen = new Set<string>()
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const word = String(r.word ?? '').trim()
      .replace(/^\d+[.、)]\s*/, '')
      .replace(/[^A-Za-z'-]/g, '')
      .trim()
    if (!word || seen.has(word.toLowerCase())) continue
    seen.add(word.toLowerCase())
    const translation = String(r.translation ?? '').trim()
      .replace(/[|]+/g, '；')
      .replace(/\s{2,}/g, ' ')
    out.push({
      word,
      phonetic: cleanPhonetic(String(r.phonetic ?? '')),
      pos: cleanPos(String(r.pos ?? '')),
      translation,
      example: String(r.example ?? '').trim(),
    })
  }
  return out
}

export function parseExtraction(raw: string): WordDraft[] {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let obj: { items?: unknown[] }
  try {
    obj = JSON.parse(cleaned) as { items?: unknown[] }
  } catch (e) {
    logger.error('extract.json.fail', { chars: raw.length, msg: (e as Error).message })
    throw e
  }
  if (!Array.isArray(obj.items)) {
    logger.error('extract.items.missing', { keys: Object.keys(obj).slice(0, 5) })
    throw new Error('抽取结果缺少 items 数组')
  }
  const drafts = normalizeDrafts(obj.items)
  logger.debug('extract.parse', { raw: obj.items.length, kept: drafts.length })
  return drafts
}

/* ---------------- 文本导入：按单元切段 ---------------- */
/**
 * 整本书的单词文本长度远超一次模型请求的可用上下文，也不能靠模型自己「分单元」，
 * 所以先在本地按 Unit 标题切段（纯函数、可离线自测），再逐段交给 X2.6 抽取。
 */
export interface UnitSection {
  /** 单元标题（来自标题行），没有标题时为空串，由上层补默认名 */
  title: string
  /** 该单元对应的原始文本（已去掉标题行） */
  text: string
}

/** 单段最大字符数：略低于 prompt 的 4000 字截断线，避免内容被静默丢掉 */
export const MAX_SECTION_CHARS = 3500

const UNIT_HEADING = /^(?:(?:starter\s*)?unit\s*\d+|module\s*\d+|第\s*[一二三四五六七八九十百零两\d]+\s*单元|[七八九]\s*[上下]\s*(?:starter\s*)?unit\s*\d+)/i

/** 去掉 markdown 记号与序号，只留标题文字。 */
export function cleanUnitTitle(line: string): string {
  return String(line)
    .replace(/^#{1,6}\s*/, '')
    .replace(/[*_`>]/g, '')
    .replace(/^\s*[-\d]+[.、)]\s*/, '')
    .replace(/\s*[:：]\s*$/, '')
    .trim()
    .slice(0, 40)
}

/** 是否单元标题行：短、且形如 Unit 3 / Starter Unit 2 / 第 3 单元 / 七上 Unit 1。 */
export function isUnitHeading(line: string): boolean {
  const s = cleanUnitTitle(line)
  if (!s || s.length > 40) return false
  return UNIT_HEADING.test(s)
}

function splitByLines(lines: string[], maxChars: number): string[][] {
  const out: string[][] = []
  let cur: string[] = []
  let size = 0
  for (const line of lines) {
    const add = line.length + 1
    if (cur.length && size + add > maxChars) {
      out.push(cur)
      cur = []
      size = 0
    }
    cur.push(line)
    size += add
  }
  if (cur.length) out.push(cur)
  return out
}

/**
 * 文本 → 按 Unit 切好的段落。没有标题时整体作为一段；单段过长时再按行切成多段，
 * 多段共用同一个标题（上层按标题复用单元，于是仍然写进同一个单元）。
 */
export function splitUnitSections(raw: string, maxChars = MAX_SECTION_CHARS): UnitSection[] {
  const lines = String(raw).replace(/\r\n?/g, '\n').split('\n')
  const groups: Array<{ title: string; lines: string[] }> = []
  let cur = { title: '', lines: [] as string[] }

  for (const line of lines) {
    if (isUnitHeading(line)) {
      if (cur.lines.some((l) => l.trim())) groups.push(cur)
      cur = { title: cleanUnitTitle(line), lines: [] }
      continue
    }
    cur.lines.push(line)
  }
  if (cur.lines.some((l) => l.trim())) groups.push(cur)

  const out: UnitSection[] = []
  for (const g of groups) {
    for (const chunk of splitByLines(g.lines, maxChars)) {
      const text = chunk.join('\n').trim()
      if (text) out.push({ title: g.title, text })
    }
  }
  logger.debug('text.split', { chars: String(raw).length, sections: out.length })
  return out
}

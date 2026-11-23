/**
 * 跟读短文：OCR markdown → 干净的英文句子列表。
 *
 * 这里只做「纯函数 + 提示词」：
 *  - 云端用 Spark X2.6 整理（去中文注释 / 页码 / 页眉、修复断行、按句切分）；
 *  - 云不可用时用本地 markdownToSentences() 兜底，断网也能开始跟读。
 * 英文原文一律保留，不改写、不翻译、不扩写。
 */
import type { ChatMessage } from '../api/xfyun-maas.ts'
import { logger } from '../utils/log.ts'

export const MAX_SENTENCES = 60
export const MAX_SENTENCE_CHARS = 300
/** 送进模型的 markdown 上限：再长就不是一页短文了，截断避免白烧额度 */
const MAX_PROMPT_CHARS = 8000

export const PASSAGE_SYSTEM = '你是英语短文整理助手。只输出严格 JSON，不要解释、不要代码块，不要翻译。'

export function buildPassageMessages(markdown: string): ChatMessage[] {
  const text = markdown.slice(0, MAX_PROMPT_CHARS)
  logger.debug('passage.prompt', { markdownChars: markdown.length, usedChars: text.length })
  return [
    { role: 'system', content: PASSAGE_SYSTEM },
    {
      role: 'user',
      content: [
        '下面是一张图片 OCR 出来的 markdown。请把它整理成可以跟读的英文短文，只输出 JSON。',
        '格式：{"title":"","sentences":["第一句","第二句"]}',
        '要求：',
        '1. 只保留正文英文；删除中文翻译 / 生词注释 / 题目说明 / 页码 / 页眉页脚 / 单元标题里的中文、编号和符号。',
        '2. 原文不能改写、不能扩写、不能翻译，也不要补造内容；只做清理和断行修复。',
        '3. OCR 常把单词从中间断行（如 exam- 换行 ple），要接回一个单词；被换行拆开的句子要接成完整句子。',
        '4. 按完整句子切分，一句一项，保留原有标点；每句不超过 300 个字符。',
        '5. 最多输出 40 句，超出的截断；不要输出音标，不要输出中文。',
        '6. title 用文章标题；没有明显标题时，用第一句的前几个词作为标题。',
        '',
        'OCR 文本：',
        text,
      ].join('\n'),
    },
  ]
}

/** 中文 / 中文标点是否占多数：中文释义行、页眉说明行整行丢弃。 */
function isMostlyChinese(line: string): boolean {
  const cjk = (line.match(/[\u4e00-\u9fa5]/g) || []).length
  const latin = (line.match(/[A-Za-z]/g) || []).length
  return cjk > latin
}

/** 常见缩写：这些词后面的句点不是句末，不能在那里断句。 */
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'eg', 'ie', 'e.g', 'i.e', 'no', 'fig', 'p', 'pp',
])

/** 英文文本清洗：去 markdown 记号、中文注释、页码，修复断词，合并空白。 */
export function cleanEnglishText(raw: string): string {
  let s = String(raw ?? '').replace(/\r\n?/g, '\n')
  s = s.replace(/```[a-z]*/gi, ' ')
  s = s.replace(/^#{1,6}\s*/gm, '')
  // 行内中文括号注释（如 apple（苹果））整段去掉
  s = s.replace(/[（(][^)）]*[\u4e00-\u9fa5][^)）]*[)）]/g, ' ')
  // markdown 链接只留文字
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  s = s.replace(/[*_`>]/g, ' ')
  // 断词：exam-\nple → example
  s = s.replace(/([A-Za-z])-\s*\n\s*([a-z])/g, '$1$2')

  const kept: string[] = []
  for (const rawLine of s.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    // 纯页码 / 纯符号行
    if (/^\d{1,4}$/.test(line)) continue
    if (isMostlyChinese(line)) continue
    // 行内的中文残留（注释、单元标题、全角标点）去掉，只留英文
    const noCjk = line.replace(/[\u4e00-\u9fa5\u3000-\u303f\uff01-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff65]+/g, ' ')
    if (!/[A-Za-z]{2}/.test(noCjk)) continue
    const plain = noCjk.replace(/\s+/g, ' ').trim()
    // 「Unit 3」「Lesson 2」这类短标题不是正文（带句末标点的真句子不丢）
    if (/^(?:starter\s*)?unit\s*\d+|^module\s*\d+|^lesson\s*\d+|^chapter\s*\d+/i.test(plain)
      && plain.length <= 30 && !/[.!?]/.test(plain)) continue
    kept.push(plain)
  }
  return kept.join(' ').replace(/\s+/g, ' ').trim()
}

function isAbbreviationAt(text: string, dotIndex: number): boolean {
  // 取句点前最后一个词
  const before = text.slice(0, dotIndex)
  const m = /([A-Za-z.]+)$/.exec(before)
  if (!m) return false
  const word = m[1].toLowerCase().replace(/\./g, '')
  return ABBREVIATIONS.has(word)
}

/**
 * 按句末标点切句。只在小数点 / 缩写之后不断句：
 * `2.5`、`Mr. Smith`、`e.g.` 都保留在同一句里。
 */
export function splitSentences(text: string): string[] {
  const s = String(text ?? '').replace(/\r\n?/g, '\n').replace(/\s+/g, ' ').trim()
  if (!s) return []
  const out: string[] = []
  let buf = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    buf += ch
    if (!/[.!?…]/.test(ch)) continue
    const next = s[i + 1]
    if (next && !/\s/.test(next)) continue          // 2.5 / e.g. 这类不切
    if (ch === '.' && isAbbreviationAt(s, i)) continue
    const trimmed = buf.trim()
    if (trimmed && /[A-Za-z]/.test(trimmed)) out.push(trimmed)
    buf = ''
  }
  const tail = buf.trim()
  if (tail && /[A-Za-z]/.test(tail)) out.push(tail)
  return out
}

/** 显示 / 取词用的单词切分：保留缩写与连字符（don't / well-known / 2024）。 */
export function tokenizeWords(sentence: string): string[] {
  return String(sentence ?? '').match(/[A-Za-z0-9]+(?:['’\-][A-Za-z0-9]+)*/g) || []
}

export function countWords(sentences: string[]): number {
  return sentences.reduce((n, s) => n + tokenizeWords(s).length, 0)
}

function clampSentence(raw: string): string {
  let s = String(raw ?? '').trim()
    .replace(/^[(（]?\d{1,3}[.)）、]\s*/, '')     // 题号 1. / (2)
    .replace(/\s+/g, ' ')
  if (s.length > MAX_SENTENCE_CHARS) s = s.slice(0, MAX_SENTENCE_CHARS).trim()
  if (s && !/[.!?…:;"”’]$/.test(s)) s += '.'
  return s
}

export function fallbackTitle(sentences: string[]): string {
  const first = sentences[0] || ''
  const words = tokenizeWords(first).slice(0, 6)
  return words.length ? words.join(' ') : '跟读短文'
}

/** 本地兜底：直接从 OCR markdown 提取英文句子，不联网。 */
export function markdownToSentences(markdown: string): string[] {
  const text = cleanEnglishText(markdown)
  const out = splitSentences(text)
    .map(clampSentence)
    .filter((s) => tokenizeWords(s).length > 0)
  logger.debug('passage.local', { markdownChars: markdown.length, sentences: out.length })
  return out.slice(0, MAX_SENTENCES)
}

/** 清洗模型返回：标题 / 句子都做兜底与截断，空结果抛错由上层降级。 */
export function normalizePassageResult(obj: unknown): { title: string; sentences: string[] } {
  const r = (obj || {}) as Record<string, unknown>
  const list = Array.isArray(r.sentences) ? r.sentences : []
  const sentences: string[] = []
  for (const item of list) {
    if (sentences.length >= MAX_SENTENCES) break
    if (typeof item !== 'string') continue
    for (const s of splitSentences(cleanEnglishText(item))) {
      const line = clampSentence(s)
      if (!tokenizeWords(line).length) continue
      sentences.push(line)
      if (sentences.length >= MAX_SENTENCES) break
    }
  }
  if (!sentences.length) throw new Error('没有识别到英文短文')
  const rawTitle = typeof r.title === 'string' ? r.title : ''
  const title = rawTitle.trim().replace(/\s+/g, ' ').slice(0, 40) || fallbackTitle(sentences)
  logger.debug('passage.normalize', { titleChars: title.length, sentences: sentences.length })
  return { title, sentences }
}

/** 存储层用：content 是句子数组的 JSON，坏数据按空数组处理。 */
export function parseSentences(raw: string): string[] {
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : []
  } catch (_) {
    return []
  }
}

/** 存储层用：译文要保留位置（空串表示这句没有译文），不能把空项过滤掉。 */
export function parseTranslations(raw: string): string[] {
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x.trim() : '')) : []
  } catch (_) {
    return []
  }
}


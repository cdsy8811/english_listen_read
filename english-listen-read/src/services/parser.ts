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
import type { WordDraft } from './types.ts'

export const EXTRACT_SYSTEM = '你是英语单词表整理助手。只输出严格 JSON，不要解释、不要代码块。'

export function buildExtractPrompt(markdown: string): string {
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
  const obj = JSON.parse(cleaned) as { items?: unknown[] }
  if (!Array.isArray(obj.items)) throw new Error('抽取结果缺少 items 数组')
  return normalizeDrafts(obj.items)
}

/**
 * 本地纯文本词条解析：无网 / 云能力失败时的降级档。
 * 支持常见的「单词 音标 词性 中文释义」行，-tolerant 处理表格分隔符与序号。
 */
import { cleanPhonetic, cleanPos } from './parser.ts'
import type { WordDraft } from './types.ts'

const EN = /^[A-Za-z][A-Za-z'-]*/
const ZH = /[\u4e00-\u9fa5]/

export function parsePlainTextDrafts(text: string): WordDraft[] {
  const out: WordDraft[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^\s*\|?\s*\d+[.、)]\s*/, '').replace(/\|/g, ' ').trim()
    if (!line || !ZH.test(line) || !EN.test(line)) continue
    const m = EN.exec(line)
    const word = m ? m[0].trim() : ''
    if (!word) continue
    const rest = line.slice(word.length).trim()
    const phoneticMatch = /\/([^/]{1,40})\//.exec(rest)
    // 先移除音标，避免 `/əˈbændən/` 里的字母被误判成词性 n./v.
    const withoutPhonetic = rest.replace(/\/[^/]{1,40}\//, ' ')
    const posMatch = /\b(vt|vi|adj|adv|prep|pron|conj|int|num|art|abbr|n|v)\b\.?/i.exec(withoutPhonetic)
    const zhStart = rest.search(/[\u4e00-\u9fa5]/)
    const translation = zhStart >= 0
      ? rest.slice(zhStart).trim().replace(/[。；;，,]+$/, '')
      : ''
    out.push({
      word: word.toLowerCase(),
      phonetic: phoneticMatch ? cleanPhonetic(phoneticMatch[0]) : '',
      pos: posMatch ? cleanPos(posMatch[1]) : '',
      translation,
    })
  }
  return out
}

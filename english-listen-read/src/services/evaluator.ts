/**
 * 内容正确度评价（纯逻辑层，可离线自测）。
 * 2.2：英文文本比对（归一化 + 编辑距离），云端语义判分只作为「近似拼写 / 同义」兜底。
 * 2.3：中文释义关键词覆盖 + 语义兜底，同义表述也算对。
 * 硬约束：不接 ISE、不给发音分；highlights 只表示文本对错；评分严格度影响阈值。
 */
import type { EvalInput, EvalResult, Strictness, Word } from './types.ts'

const THRESHOLD: Record<Strictness, { high: number; pass: number; distance: number }> = {
  loose: { high: 0.9, pass: 0.6, distance: 3 },
  normal: { high: 0.95, pass: 0.72, distance: 2 },
  strict: { high: 1.0, pass: 0.85, distance: 1 },
}

/** 英文归一化：小写、去标点、去多余空格。 */
export function normalizeEn(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9'\-\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** 中文归一化：去标点与空白，保留汉字 / 字母。 */
export function normalizeZh(s: string): string {
  return s.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').toLowerCase()
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}

export function similarity(a: string, b: string): number {
  if (!a && !b) return 1
  const max = Math.max(a.length, b.length)
  return max ? 1 - levenshtein(a, b) / max : 0
}

/** 中文释义切成义项（分号 / 顿号 / 逗号 / 「或」）。 */
export function splitMeanings(s: string): string[] {
  return s.split(/[；;，,、。/｜|]|\s+或\s+/).map((x) => normalizeZh(x)).filter(Boolean)
}

/** 2.3 关键词覆盖：用户答案命中标准答案的义项即算对。 */
export function meaningCoverage(expected: string, answer: string): number {
  const meanings = splitMeanings(expected)
  const a = normalizeZh(answer)
  if (!meanings.length || !a) return 0
  let hit = 0
  for (const m of meanings) {
    if (a.includes(m) || m.includes(a) || similarity(a, m) >= 0.6) hit++
  }
  return hit / meanings.length
}

/** 逐词高亮：英文按词、中文按义项，只标记「文本对错」。 */
function highlightEn(expected: string, answer: string): Array<{ text: string; ok: boolean }> {
  const exp = normalizeEn(expected).split(' ').filter(Boolean)
  const ans = new Set(normalizeEn(answer).split(' ').filter(Boolean))
  if (!exp.length) return []
  return exp.map((w) => ({ text: w, ok: ans.has(w) }))
}

function highlightZh(expected: string, answer: string): Array<{ text: string; ok: boolean }> {
  const a = normalizeZh(answer)
  return splitMeanings(expected).map((m) => ({ text: m, ok: a.includes(m) || m.includes(a) }))
}

/** 本地评分（不发网络请求，输入框作答 / 无网降级都能用）。 */
export function localEvaluate(input: EvalInput): EvalResult {
  const t = THRESHOLD[input.strictness]
  const isEn = input.mode === '2.2'
  const expected = isEn ? input.word.word : input.word.translation
  const answer = (input.answer || input.asrText || '').trim()
  const normalizedExpected = isEn ? normalizeEn(expected) : normalizeZh(expected)
  const normalizedAnswer = isEn ? normalizeEn(answer) : normalizeZh(answer)

  let score = 0
  if (normalizedAnswer) {
    if (isEn) {
      const sim = similarity(normalizedExpected, normalizedAnswer)
      const dist = levenshtein(normalizedExpected, normalizedAnswer)
      score = sim >= t.high ? 100
        : sim >= t.pass ? Math.round(60 + (sim - t.pass) / (t.high - t.pass) * 35)
        : dist <= t.distance ? Math.round(45 + (1 - dist / (t.distance + 1)) * 15)
        : 0
    } else {
      const cover = meaningCoverage(expected, answer)
      const sim = similarity(normalizedExpected, normalizedAnswer)
      score = cover >= 1 || sim >= t.high ? 100
        : cover >= t.pass ? Math.round(60 + cover * 35)
        : cover > 0 ? Math.round(35 + cover * 30)
        : sim >= 0.5 ? Math.round(40 + sim * 30) : 0
    }
  }
  const feedback = score >= 90 ? '答对了'
    : score >= 60 ? '基本正确，注意与标准答案的差异'
    : score > 0 ? '还差一点，看看标准答案'
    : answer ? '没有答对，可以重试或跳过' : '没有收到作答内容'

  return {
    score,
    highlights: isEn ? highlightEn(expected, answer) : highlightZh(expected, answer),
    expected: expected || '',
    answer,
    asrText: input.asrText || '',
    feedback,
    semantic: false,
  }
}

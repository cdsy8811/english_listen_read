/**
 * 内容正确度评价（纯逻辑层，可离线自测）。
 * 2.2：英文文本比对（归一化 + 编辑距离 + 同音词/拆词容错），云端语义判分只作为「近似拼写 / 同义」兜底。
 * 2.3：中文释义关键词覆盖 + 语义兜底，同义表述也算对。
 * 硬约束：不接 ISE、不给发音分；highlights 只表示文本对错；评分严格度影响阈值。
 * 同音词容错的原因见 utils/phonetic.ts 顶部（听写只给文字，两个/tuː/无法区分）。
 */
import { logger } from '../utils/log.ts'
import { expandNumbers, isHomophone } from '../utils/phonetic.ts'
import type { EvalInput, EvalResult, Strictness, Word } from './types.ts'

const THRESHOLD: Record<Strictness, { high: number; pass: number; distance: number }> = {
  loose: { high: 0.9, pass: 0.6, distance: 3 },
  normal: { high: 0.95, pass: 0.72, distance: 2 },
  strict: { high: 1.0, pass: 0.85, distance: 1 },
}

/** 英文归一化：数字转数词、小写、去标点、去多余空格。 */
export function normalizeEn(s: string): string {
  return expandNumbers(s).toLowerCase().replace(/[^a-z0-9'\-\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** 去空格的紧凑拼写：听写常把单词拆开或粘在一起（abandon → a band on）。 */
function compactEn(s: string): string {
  return normalizeEn(s).replace(/[^a-z0-9]/g, '')
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
  const ans = normalizeEn(answer).split(' ').filter(Boolean)
  if (!exp.length) return []
  // 只差词间空格（听写拆词 / 粘词）时整句算对
  const compactSame = compactEn(expected) === compactEn(answer)
  return exp.map((w) => ({ text: w, ok: compactSame || ans.some((a) => a === w || isHomophone(w, a)) }))
}

function highlightZh(expected: string, answer: string): Array<{ text: string; ok: boolean }> {
  const a = normalizeZh(answer)
  return splitMeanings(expected).map((m) => ({ text: m, ok: a.includes(m) || m.includes(a) }))
}

/**
 * 找出答案里与标准答案「同音但拼写不同」的词，没有则返回空串。
 * 只用于英文（2.2）：听写对同一读音会挑一个更常见的拼法，那是转写的歧义，不是答错。
 * 近音不同词（ship / sheep）不在此列，仍然算错。
 */
export function homophoneHit(expected: string, answer: string): string {
  const exp = normalizeEn(expected).split(' ').filter(Boolean)
  const ans = normalizeEn(answer).split(' ').filter(Boolean)
  if (!exp.length || !ans.length) return ''
  // 词数相同：逐位比，至少有一处拼写不同但读音相同
  if (exp.length === ans.length) {
    const identical = exp.every((e, i) => e === ans[i])
    if (!identical && exp.every((e, i) => isHomophone(e, ans[i]))) return ans.join(' ')
    return ''
  }
  // 词数不同（听写多给了 a / the 之类）：目标是单词时，答案里任一词同音即可
  if (exp.length === 1) return ans.find((a) => a !== exp[0] && isHomophone(exp[0], a)) || ''
  return ''
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
  /** 命中「同音词 / 拆词」容错时给用户的说明（不含任何发音评分口径） */
  let note = ''
  /** 录音走「转写」，输入框走「作答」，别把用户打的字也叫转写 */
  const said = input.inputType === 'record' ? '转写' : '作答'
  if (normalizedAnswer) {
    if (isEn) {
      const homo = homophoneHit(expected, answer)
      // 只差词间空格：abandon ↔ "a band on"、blackboard ↔ "black board"（完全一致走正常评分）
      const compactSame = normalizedAnswer !== normalizedExpected
        && compactEn(expected) === compactEn(answer)
      if (homo) {
        score = 100
        note = `${said}「${homo}」与答案「${normalizedExpected}」同音，按正确计`
      } else if (compactSame) {
        score = 100
        note = `${said}与答案只差词间空格，按正确计`
      } else {
        const sim = similarity(normalizedExpected, normalizedAnswer)
        const dist = levenshtein(normalizedExpected, normalizedAnswer)
        score = sim >= t.high ? 100
          : sim >= t.pass ? Math.round(60 + (sim - t.pass) / (t.high - t.pass) * 35)
          : dist <= t.distance ? Math.round(45 + (1 - dist / (t.distance + 1)) * 15)
          : 0
      }
    } else {
      const cover = meaningCoverage(expected, answer)
      const sim = similarity(normalizedExpected, normalizedAnswer)
      score = cover >= 1 || sim >= t.high ? 100
        : cover >= t.pass ? Math.round(60 + cover * 35)
        : cover > 0 ? Math.round(35 + cover * 30)
        : sim >= 0.5 ? Math.round(40 + sim * 30) : 0
    }
  }
  const feedback = note ? `答对了：${note}`
    : score >= 90 ? '答对了'
    : score >= 60 ? '基本正确，注意与标准答案的差异'
    : score > 0 ? '还差一点，看看标准答案'
    : answer ? '没有答对，可以重试或跳过' : '没有收到作答内容'

  logger.debug('eval.local', {
    mode: input.mode, strictness: input.strictness, homophone: !!note,
    expectedChars: expected.length, answerChars: answer.length, asrChars: (input.asrText || '').length,
    score,
  })
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

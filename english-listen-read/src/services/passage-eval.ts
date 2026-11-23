/**
 * 跟读句子评分（纯逻辑，可离线自测）：
 * ASR 转写与原文逐词对齐（加权 LCS），漏读扣分、多读轻扣、大小写与标点忽略；
 * 同音词（two → to）与一个字母的转写误差算「近似读对」。
 *
 * 硬约束：只表示内容正确度，不含任何发音维度；words 的状态是文本对错，
 * 不是音素级发音评分（本工程未接 ISE）。
 */
import { levenshtein } from './evaluator.ts'
import { tokenizeWords } from './passage.ts'
import { isHomophone } from '../utils/phonetic.ts'
import { logger } from '../utils/log.ts'
import type { PassageEval } from './types.ts'

export type WordStatus = 'ok' | 'near' | 'missed'

/** 原词 → 比对形式：小写、弯引号归一、去首尾标点。 */
export function normalizeToken(token: string): string {
  return String(token ?? '')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
}

/** ASR 文本 → 比对词：去标点、压空白。 */
export function answerTokens(asrText: string): string[] {
  return String(asrText ?? '')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9'\- ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
}

/** 近似读对：同音词，或长度 ≥4 时只差一个字母（听写转写常见）。 */
export function nearToken(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  if (isHomophone(a, b)) return true
  return a.length >= 4 && b.length >= 4 && levenshtein(a, b) <= 1
}

export interface Alignment {
  words: Array<{ text: string; status: WordStatus }>
  extra: string[]
  /** 读对的词数：完全读对按 1、近似读对按 0.85 */
  hit: number
  total: number
}

/**
 * 加权 LCS：完全匹配得分 2，近似匹配 1，跳词 0；回溯得到每个原文词的状态。
 * 原文词数很有限（一句 ≤ 300 字符），二维 DP 足够。
 */
export function alignPassage(expected: string, asrText: string): Alignment {
  const display = tokenizeWords(expected)
  const exp = display.map(normalizeToken)
  const ans = answerTokens(asrText)
  const n = exp.length
  const m = ans.length
  const total = n

  if (!n) return { words: [], extra: ans, hit: 0, total: 0 }
  if (!m) {
    return { words: display.map((text) => ({ text, status: 'missed' })), extra: [], hit: 0, total }
  }

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const skipExp = dp[i - 1][j]
      const skipAns = dp[i][j - 1]
      let best = Math.max(skipExp, skipAns)
      if (exp[i - 1] === ans[j - 1]) best = Math.max(best, dp[i - 1][j - 1] + 2)
      else if (nearToken(exp[i - 1], ans[j - 1])) best = Math.max(best, dp[i - 1][j - 1] + 1)
      dp[i][j] = best
    }
  }

  const statuses: WordStatus[] = new Array(n).fill('missed')
  const extra: string[] = []
  let i = n
  let j = m
  while (i > 0 && j > 0) {
    const cur = dp[i][j]
    if (exp[i - 1] === ans[j - 1] && cur === dp[i - 1][j - 1] + 2) {
      statuses[i - 1] = 'ok'
      i--; j--
      continue
    }
    if (nearToken(exp[i - 1], ans[j - 1]) && cur === dp[i - 1][j - 1] + 1) {
      statuses[i - 1] = 'near'
      i--; j--
      continue
    }
    if (cur === dp[i - 1][j]) { i--; continue }
    extra.push(ans[j - 1])
    j--
  }
  while (j > 0) extra.push(ans[--j])

  let hit = 0
  for (const st of statuses) hit += st === 'ok' ? 1 : st === 'near' ? 0.85 : 0

  return {
    words: display.map((text, idx) => ({ text, status: statuses[idx] })),
    extra,
    hit: Math.round(hit * 100) / 100,
    total,
  }
}

function feedbackOf(score: number, missed: number, extra: number): string {
  if (score >= 90 && !missed) return '读得很完整'
  if (score >= 75) return missed ? `大部分读对了，有 ${missed} 个词没读出来` : '读得比较完整，注意多读的词'
  if (score >= 50) return missed ? `漏读了 ${missed} 个词，对照标记再读一遍` : '有一半左右没对上，对照原文再读一遍'
  if (score > 0) return '只读对了少部分，慢一点、逐词读'
  return extra ? '没有对上原文，可能是录音太短或环境太吵' : '没有识别到朗读内容，按住录音读完再松手'
}

/** 本地句子评分：不联网，输入框 / 无网降级都能用。 */
export function localPassageEvaluate(expected: string, asrText: string): PassageEval {
  const align = alignPassage(expected, asrText)
  const answer = String(asrText ?? '').trim()
  const base = align.total ? Math.min(1, align.hit / align.total) : 0
  const penalty = Math.min(0.15, align.extra.length * 0.03)
  const score = Math.round(base * (1 - penalty) * 100)
  const missed = align.words.filter((w) => w.status === 'missed').length

  logger.debug('passage.eval.local', {
    words: align.total, hit: align.hit, missed, extra: align.extra.length, score,
  })

  return {
    score,
    expected,
    answer,
    asrText: answer,
    words: align.words,
    extra: align.extra,
    hit: align.hit,
    total: align.total,
    feedback: feedbackOf(score, missed, align.extra.length),
    semantic: false,
  }
}

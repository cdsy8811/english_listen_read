/** Spark X2.6 语义判分（2.2 英文近义 / 拼写、2.3 中文同义表述兜底）。 */
import { chatJson } from './xfyun-maas.ts'
import { CloudError } from '../utils/log.ts'
import type { EvalInput, EvalResult, Word } from '../services/types.ts'

interface SemanticVerdict { score?: number; reason?: string }

function semanticMessages(input: EvalInput, local: EvalResult) {
  const isEn = input.mode === '2.2'
  return [
    {
      role: 'system' as const,
      content: '你是英语练习的内容正确度判分助手。只输出严格 JSON：{"score":0-100,"reason":"简短中文说明"}。不要解释、不要代码块。只判断文字内容是否答对，不评价发音。',
    },
    {
      role: 'user' as const,
      content: isEn
        ? `题目：看中文释义说英文。\n标准答案：${input.word.word}\n中文释义：${input.word.translation}\n` +
          `用户作答（${input.inputType === 'record' ? '录音转写' : '输入框'}）：${local.answer}\n` +
          `本地文本比对得分：${local.score}（严格度 ${input.strictness}）。\n` +
          '请判断内容是否答对：拼写轻微误差、大小写、单复数、时态变化、同义单词可酌情给分；完全无关给 0。'
        : `题目：看英文说中文。\n英文单词：${input.word.word}\n标准中文释义：${input.word.translation}\n` +
          `用户作答（${input.inputType === 'record' ? '录音转写' : '输入框'}）：${local.answer}\n` +
          `本地关键词覆盖得分：${local.score}（严格度 ${input.strictness}）。\n` +
          '请判断中文意思是否答对：同义表述、近义词、只答出其中一个义项都算部分正确；无关内容给 0。',
    },
  ]
}

/**
 * 云判分只作用于「本地分不为满分且不为 0」的模糊区间，避免每次都计费。
 * 云调用失败时静默回退本地分，UI 不崩。
 */
export async function semanticEvaluate(input: EvalInput, local: EvalResult): Promise<EvalResult> {
  if (!local.answer || local.score >= 100 || local.score === 0) return local
  try {
    // thinking=disabled：判分是一次短 JSON 输出，开着思考会把 256 额度吃光导致空 content
    const v = await chatJson<SemanticVerdict>(semanticMessages(input, local), { maxTokens: 512, thinking: 'disabled' })
    const raw = Number(v.score)
    if (!Number.isFinite(raw)) return local
    const score = Math.max(0, Math.min(100, Math.round(raw)))
    return {
      ...local,
      score: Math.max(local.score, score),
      feedback: score >= 90 ? '答对了' : score >= 60 ? '基本正确' : (v.reason || local.feedback),
      semantic: true,
    }
  } catch (e) {
    // 429 / 超时 / 无网：本地分已经可用，不向上抛
    if (!(e instanceof CloudError)) return local
    return local
  }
}

/** 标准答案文案（结果页用，措辞不含发音维度）。 */
export function answerLabel(mode: EvalInput['mode'], word: Word): string {
  return mode === '2.2' ? `标准英文：${word.word}` : `标准释义：${word.translation}`
}

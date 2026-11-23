/** Spark X2.6 语义判分（2.2 英文近义 / 拼写、2.3 中文同义表述兜底）。 */
import { chatJson } from './xfyun-maas.ts'
import { CloudError, errText, logger } from '../utils/log.ts'
import type { EvalInput, EvalResult, PassageEval, Word } from '../services/types.ts'

interface SemanticVerdict { score?: number; reason?: string }

function semanticMessages(input: EvalInput, local: EvalResult) {
  const isEn = input.mode === '2.2'
  return [
    {
      role: 'system' as const,
      content: '你是英语练习的内容正确度判分助手。只输出严格 JSON：{"score":0-100,"reason":"简短中文说明"}。不要解释、不要代码块。只判断文字内容是否答对，不评价发音。' +
        '注意：录音转写只给文字，可能把词写成同音词（英文 two→to、read→red；中文「放弃」→「放汽」）或把单词拆开/粘连（abandon→a band on）。' +
        '这类与标准答案读音相同或拼写只差空格的转写要按正确给分；仅读音相近但不同的词（ship/sheep）不算对。',
    },
    {
      role: 'user' as const,
      content: isEn
        ? `题目：看中文释义说英文。\n标准答案：${input.word.word}\n中文释义：${input.word.translation}\n` +
          `用户作答（${input.inputType === 'record' ? '录音转写' : '输入框'}）：${local.answer}\n` +
          `本地文本比对得分：${local.score}（严格度 ${input.strictness}）。\n` +
          '请判断内容是否答对：拼写轻微误差、大小写、单复数、时态变化、同义单词可酌情给分；' +
          '若转写只是标准答案的同音词或只差词间空格，给 100；完全无关给 0。'
        : `题目：看英文说中文。\n英文单词：${input.word.word}\n标准中文释义：${input.word.translation}\n` +
          `用户作答（${input.inputType === 'record' ? '录音转写' : '输入框'}）：${local.answer}\n` +
          `本地关键词覆盖得分：${local.score}（严格度 ${input.strictness}）。\n` +
          '请判断中文意思是否答对：同义表述、近义词、只答出其中一个义项都算部分正确；' +
          '转写里的同音错字按意思一致处理；无关内容给 0。',
    },
  ]
}

/**
 * 云判分只作用于「本地分不为满分且不为 0」的模糊区间，避免每次都计费。
 * 云调用失败时静默回退本地分，UI 不崩。
 */
export async function semanticEvaluate(input: EvalInput, local: EvalResult): Promise<EvalResult> {
  if (!local.answer || local.score >= 100 || local.score === 0) return local
  logger.debug('eval.semantic.req', { mode: input.mode, localScore: local.score, answerChars: local.answer.length })
  try {
    // thinking=disabled：判分是一次短 JSON 输出，开着思考会把 256 额度吃光导致空 content
    const v = await chatJson<SemanticVerdict>(semanticMessages(input, local), { maxTokens: 512, thinking: 'disabled' })
    const raw = Number(v.score)
    if (!Number.isFinite(raw)) {
      logger.warn('eval.semantic.bad', { score: v.score })
      return local
    }
    const score = Math.max(0, Math.min(100, Math.round(raw)))
    logger.debug('eval.semantic.res', { localScore: local.score, cloudScore: score, reasonChars: (v.reason || '').length })
    return {
      ...local,
      score: Math.max(local.score, score),
      feedback: score >= 90 ? '答对了' : score >= 60 ? '基本正确' : (v.reason || local.feedback),
      semantic: true,
    }
  } catch (e) {
    // 429 / 超时 / 无网：本地分已经可用，不向上抛
    logger.warn('eval.semantic.fallback', { code: (e as CloudError).code, msg: errText(e) })
    return local
  }
}

/** 标准答案文案（结果页用，措辞不含发音维度）。 */
export function answerLabel(mode: EvalInput['mode'], word: Word): string {
  return mode === '2.2' ? `标准英文：${word.word}` : `标准释义：${word.translation}`
}

/* ---------------- 跟读句子：内容正确度云兜底 ---------------- */

function passageMessages(expected: string, local: PassageEval) {
  return [
    {
      role: 'system' as const,
      content: '你是英语跟读的内容正确度判分助手。只输出严格 JSON：{"score":0-100,"reason":"简短中文说明"}。' +
        '不要解释、不要代码块。只判断学生读出的词是否覆盖原文，不评价发音、语调或流利度。' +
        '语音听写只给文字，可能把词写成同音词（two→to、read→red）、把缩写拆开（don\'t→don t）或漏掉虚词，' +
        '这类转写误差要按内容对错合理给分；原文没有的词（多读）轻微扣分。',
    },
    {
      role: 'user' as const,
      content: `原文句子：${expected}\n` +
        `学生朗读的语音听写：${local.answer}\n` +
        `本地逐词对齐得分：${local.score}（原句 ${local.total} 词，对齐命中 ${local.hit} 词）。\n` +
        '请判断学生读出的内容是否覆盖原文：大部分词对上给 80-100；漏掉少量实词给 60-85；' +
        '只对上一部分给 30-60；完全无关或没读到内容给 0。多读原文没有的词按轻微扣分处理。',
    },
  ]
}

/**
 * 只在本地分处于 1–99 的模糊区间才调云端，避免每次跟读都计费；
 * 云调用失败静默保留本地分，UI 不崩。
 */
export async function semanticPassageEvaluate(expected: string, local: PassageEval): Promise<PassageEval> {
  if (!local.answer || local.score >= 100 || local.score === 0) return local
  logger.debug('passage.semantic.req', { localScore: local.score, answerChars: local.answer.length })
  try {
    const v = await chatJson<SemanticVerdict>(passageMessages(expected, local), { maxTokens: 512, thinking: 'disabled' })
    const raw = Number(v.score)
    if (!Number.isFinite(raw)) {
      logger.warn('passage.semantic.bad', { score: v.score })
      return local
    }
    const score = Math.max(0, Math.min(100, Math.round(raw)))
    logger.debug('passage.semantic.res', { localScore: local.score, cloudScore: score, reasonChars: (v.reason || '').length })
    return {
      ...local,
      score: Math.max(local.score, score),
      feedback: score >= 90 ? '内容读得完整' : (v.reason || local.feedback),
      semantic: true,
    }
  } catch (e) {
    logger.warn('passage.semantic.fallback', { code: (e as CloudError).code, msg: errText(e) })
    return local
  }
}

/**
 * 能力层门面（唯一入口）。
 * 页面 / store 只 import 本文件，不得直接引用 src/api/ 下的讯飞地址、模型名、发音人或签名逻辑。
 * 日后迁云函数（方案 B）只改 src/api/ 实现，本文件与 UI 不动。
 *
 * 各能力按里程碑接入：P2 拍照识别 / 抽取，P3 合成播放，P4 录音转写与评价。
 * 上层只依赖本文件；底层换成云函数时 UI 不动。
 */
import { recognizeRaw } from '../api/xfyun-ocr.ts'
import { chatJson } from '../api/xfyun-maas.ts'
import { extractMessages, normalizeDrafts, parseExtraction } from './parser.ts'
import {
  buildPassageMessages, fallbackTitle, markdownToSentences, normalizePassageResult,
} from './passage.ts'
import { localPassageEvaluate } from './passage-eval.ts'
import { synthesize, speakNative } from '../api/xfyun-tts.ts'
import { transcribeRaw } from '../api/xfyun-iat.ts'
import { semanticEvaluate, semanticPassageEvaluate } from '../api/xfyun-eval.ts'
import { localEvaluate } from './evaluator.ts'
import { CloudError, kb, logger } from '../utils/log.ts'
import * as recorder from './recorder.ts'
import type { EvalInput, EvalResult, PassageEval, WordDraft } from './types.ts'

/** 拍照 OCR → 返回 document[].value 的 markdown（不是整包 JSON）。 */
export async function recognize(imageBase64: string, encoding = 'jpg'): Promise<string> {
  const t0 = Date.now()
  logger.debug('cap.recognize.req', { kb: kb(imageBase64.length), encoding })
  const markdown = await recognizeRaw(imageBase64, encoding)
  logger.debug('cap.recognize.ok', { chars: markdown.length, ms: Date.now() - t0 })
  return markdown
}

/** markdown → 可编辑词条草稿；音标由模型按单词重生成，OCR 音标一律丢弃。 */
export async function extractWords(markdown: string): Promise<WordDraft[]> {
  if (!markdown.trim()) throw new CloudError('没有可抽取的文本，请重新拍照')
  const t0 = Date.now()
  logger.debug('cap.extract.req', { chars: markdown.length })
  try {
    // chatJson 直接拿结构化对象，避免二次解析。
    // thinking=disabled：X2.6 默认先输出思考过程并占用 max_tokens，关掉才不会出现空 content。
    const obj = await chatJson<{ items?: unknown[] }>(extractMessages(markdown), { maxTokens: 4096, thinking: 'disabled' })
    if (!Array.isArray(obj.items)) throw new Error('缺少 items')
    const drafts = normalizeDrafts(obj.items)
    if (!drafts.length) throw new Error('没有识别到词条')
    logger.debug('cap.extract.ok', { drafts: drafts.length, ms: Date.now() - t0 })
    return drafts
  } catch (e) {
    // H5 / 真机的平台限制直接透传，别再重试、也别换成笼统文案
    if ((e as CloudError).code === -1) throw e
    logger.warn('cap.extract.retry', { code: (e as CloudError).code, ms: Date.now() - t0 })
    // 兼容模型把 JSON 当字符串返回、或思考未被关闭的情况：加大额度再试一次
    try {
      const retry = await chatJson<{ items?: unknown[]; content?: string }>(extractMessages(markdown), {
        maxTokens: 8192, thinking: 'disabled',
      })
      const drafts = Array.isArray(retry.items)
        ? normalizeDrafts(retry.items)
        : parseExtraction(String(retry.content ?? ''))
      if (drafts.length) {
        logger.debug('cap.extract.ok', { drafts: drafts.length, retried: true, ms: Date.now() - t0 })
        return drafts
      }
    } catch (_) { /* fallthrough */ }
    logger.error('cap.extract.fail', { ms: Date.now() - t0 })
    throw new CloudError('词条抽取失败，请重试或手动添加', 0, undefined, true)
  }
}

/** 离线自检用：只做本地清洗，不联网（校对页导入纯文本时也复用）。 */
export function parseDraftsLocally(raw: string): WordDraft[] {
  return parseExtraction(raw)
}

/* ---------------- 跟读：图片 → 英文短文 ---------------- */

/**
 * OCR markdown → 可跟读的英文句子。
 * 云端 X2.6 负责去中文注解 / 页码、修断行、按句切分；云失败时本地兜底，
 * 断网也能开始跟读（本地不做改写，只清洗）。
 */
export async function extractPassage(markdown: string): Promise<{ title: string; sentences: string[] }> {
  if (!markdown.trim()) throw new CloudError('没有可抽取的文本，请重新拍照')
  const t0 = Date.now()
  logger.debug('cap.passage.req', { chars: markdown.length })
  try {
    const obj = await chatJson<{ title?: string; sentences?: unknown[] }>(
      buildPassageMessages(markdown), { maxTokens: 4096, thinking: 'disabled' },
    )
    const passage = normalizePassageResult(obj)
    logger.debug('cap.passage.ok', { sentences: passage.sentences.length, ms: Date.now() - t0 })
    return passage
  } catch (e) {
    // 平台限制（H5 无云能力）直接透传；其余错误走本地兜底
    if ((e as CloudError).code === -1) throw e
    const sentences = markdownToSentences(markdown)
    if (!sentences.length) {
      logger.error('cap.passage.fail', { chars: markdown.length, ms: Date.now() - t0 })
      throw new CloudError('没有识别到英文短文，请换一张更清晰的图片', 0, undefined, true)
    }
    logger.warn('cap.passage.local', { sentences: sentences.length, ms: Date.now() - t0 })
    return { title: fallbackTitle(sentences), sentences }
  }
}

/** 跟读句子评分：本地逐词对齐，模糊区间再用 X2.6 语义兜底（无网时只有本地分）。 */
export async function evaluatePassage(expected: string, asrText: string): Promise<PassageEval> {
  const local = localPassageEvaluate(expected, asrText)
  // #ifdef APP-PLUS
  const result = await semanticPassageEvaluate(expected, local)
  logger.debug('cap.passage.eval', { score: result.score, semantic: result.semantic })
  return result
  // #endif
  // #ifndef APP-PLUS
  logger.debug('cap.passage.eval', { score: local.score, semantic: false })
  return local
  // #endif
}

/* ---------------- P3 合成 / 播放 ---------------- */

/** 文本 → 本地音频路径；空路径表示已降级安卓原生 TTS。 */
export async function speak(text: string, opts: { lang: 'zh' | 'en'; speed: number; volume: number }): Promise<string> {
  const t0 = Date.now()
  logger.debug('cap.speak.req', { lang: opts.lang, chars: text.length, speed: opts.speed })
  const path = await synthesize(text, opts)
  logger.debug('cap.speak.ok', { lang: opts.lang, native: !path, ms: Date.now() - t0 })
  return path
}

/** 原生 TTS 降级播放（由能力层决定是否启用）。 */
export async function speakFallback(text: string, opts: { lang: 'zh' | 'en'; speed: number; volume: number }): Promise<void> {
  await speakNative(text, opts)
}

export { PlayQueue, playQueue, buildReadSegments, buildPromptSegment } from './player.ts'
export type { Segment, PlayOptions } from './player.ts'

/* ---------------- P4 录音 / 听写 / 评价 ---------------- */

/** 录音 → 转写文本；失败时抛错，由 UI 切到输入框作答。 */
export async function transcribe(audioBase64: string, lang: 'zh' | 'en'): Promise<string> {
  const t0 = Date.now()
  logger.debug('cap.transcribe.req', { lang, kb: kb(audioBase64.length) })
  const text = await transcribeRaw(audioBase64, lang)
  logger.debug('cap.transcribe.ok', { lang, chars: text.length, ms: Date.now() - t0 })
  return text
}

export const startRecording = recorder.startRecording
export const stopRecording = recorder.stopRecording
export const recordAvailable = recorder.recordAvailable

/** 内容正确度评价：先本地比对，模糊区间再用 X2.6 语义兜底（无网时只有本地分）。 */
export async function evaluate(input: EvalInput): Promise<EvalResult> {
  const local = localEvaluate(input)
  // #ifdef APP-PLUS
  const result = await semanticEvaluate(input, local)
  logger.debug('cap.evaluate.ok', { mode: input.mode, score: result.score, semantic: result.semantic })
  return result
  // #endif
  // #ifndef APP-PLUS
  // H5 预览只用本地文本比对：不发云端语义判分，练习闭环仍可完整体验
  logger.debug('cap.evaluate.ok', { mode: input.mode, score: local.score, semantic: local.semantic })
  return local
  // #endif
}

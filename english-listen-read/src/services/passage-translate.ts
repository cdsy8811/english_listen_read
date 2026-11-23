/**
 * 跟读短文：英文句子 → 逐句中文译文。
 *
 * 手工添加短文时由本服务调用 Spark X2.6 翻译（整句翻译，不依赖原文里是否有中文）；
 * 已保存但没有译文的文章，学习页也可以补一次。结果写回 `read_article.translations`。
 * prompt / 清洗是纯函数，可离线自测；云调用走 `api/xfyun-maas.ts`。
 */
import { chatJson, type ChatMessage } from '../api/xfyun-maas.ts'
import { CloudError, logger } from '../utils/log.ts'
import { MAX_SENTENCE_CHARS } from './passage.ts'

/** 一批最多 15 句：输出可控，60 句的短文最多 4 次请求。 */
const BATCH_SIZE = 15

export const TRANSLATE_SYSTEM = '你是英语教材翻译助手。只输出严格 JSON，不要解释、不要代码块。'

export function buildTranslatePrompt(sentences: string[]): string {
  return [
    '把下面每一句英文翻译成自然、准确的简体中文，只输出 JSON。',
    '格式：{"translations":["第一句的中文","第二句的中文"]}',
    '要求：',
    '1. 严格按输入顺序输出，条目数量必须与输入句子数完全一致，一句一条。',
    '2. 每条只写中文译文，不要英文原文、不要序号、不要音标、不要解释。',
    '3. 译得自然通顺，符合中文表达习惯，不要逐词硬译；人名、地名前后保持一致。',
    '4. 每句译文不超过 120 字。',
    '输入句子：',
    ...sentences.map((s, i) => `${i + 1}. ${s}`),
  ].join('\n')
}

export function translateMessages(sentences: string[]): ChatMessage[] {
  return [
    { role: 'system', content: TRANSLATE_SYSTEM },
    { role: 'user', content: buildTranslatePrompt(sentences) },
  ]
}

function cleanZh(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw
    .replace(/^\s*\d{1,3}[.)、)]\s*/, '')       // 模型偶尔带序号
    .replace(/^["“'‘]+|["”'’]+$/g, '')          // 去掉包裹的引号
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SENTENCE_CHARS)
}

/** 清洗模型返回：按顺序取译文，数量不足补空、超出截掉。 */
export function normalizeTranslations(raw: unknown, count: number): string[] {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const arr = Array.isArray(obj.translations) ? obj.translations
    : Array.isArray(obj.items) ? obj.items
      : Array.isArray(raw) ? raw
        : []
  const out: string[] = []
  for (let i = 0; i < count; i++) out.push(cleanZh(arr[i]))
  return out
}

/** 一批翻译：模型漏项 / 数量不符时重试一次，仍不一致就按顺序尽量对齐并留空。 */
async function translateBatch(sentences: string[]): Promise<string[]> {
  const run = async () => {
    const raw = await chatJson<unknown>(translateMessages(sentences), {
      temperature: 0.1, maxTokens: 2000, thinking: 'disabled', timeout: 60000,
    })
    return normalizeTranslations(raw, sentences.length)
  }
  let list = await run()
  if (list.filter(Boolean).length < sentences.length) {
    logger.warn('p2.zh.partial', { sentences: sentences.length, got: list.filter(Boolean).length })
    list = await run()
  }
  if (!list.some(Boolean)) throw new CloudError('翻译服务没有返回内容，请稍后重试', 0, undefined, true)
  return list
}

/**
 * 逐句翻译整篇短文。按 15 句一批串行调用，避免一次输出过长被截断；
 * 云失败抛 CloudError，由页面决定「先存英文、稍后补译文」还是提示重试。
 */
export async function translateSentences(sentences: string[]): Promise<string[]> {
  const list = sentences.map((s) => String(s ?? '').trim())
  if (!list.length) return []
  const t0 = Date.now()
  const out: string[] = []
  for (let i = 0; i < list.length; i += BATCH_SIZE) {
    const batch = list.slice(i, i + BATCH_SIZE)
    logger.debug('p2.zh.req', { batch: Math.floor(i / BATCH_SIZE) + 1, sentences: batch.length })
    out.push(...await translateBatch(batch))
  }
  logger.info('p2.zh.ok', { sentences: list.length, translated: out.filter(Boolean).length, ms: Date.now() - t0 })
  return out
}

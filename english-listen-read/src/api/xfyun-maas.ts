/**
 * Spark X2.6（MaaS，OpenAI 兼容 / Bearer 鉴权）。
 * 注意：base_url 只填到 /v2，本文件自己拼 /chat/completions；填全路径会 404。
 * X2.6 是纯文本模型，不支持图片输入 —— 图片必须先走 OCR。
 *
 * P2 实测（2026-11-07）：X2.6 默认会先输出 reasoning_content（思考过程），
 * 思考同样消耗 max_tokens。额度给小了（如 1536）会被思考吃光，
 * 导致 content 为空且 finish_reason=length —— 表现就是「模型未返回内容」。
 * 因此结构化任务（抽取 / 判分）统一 `thinking: disabled`：不再被截断，且 20s → 2s。
 */
import { httpJson } from './http.ts'
import { ENDPOINTS, maasApiKey } from './runtime-config.ts'
import { CloudError, logger } from '../utils/log.ts'
import { withRetry } from '../utils/retry.ts'

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

interface ChatResponse {
  choices?: Array<{ finish_reason?: string; message?: { content?: string; reasoning_content?: string } }>
  error?: { message?: string; code?: string }
}

export interface ChatOptions {
  temperature?: number
  maxTokens?: number
  timeout?: number
  /** 结构化任务建议关闭思考：更快、且不会被思考过程截断输出 */
  thinking?: 'enabled' | 'disabled'
}

/** 纯函数：便于单测校验「关闭思考 + 额度」不被悄悄改回去。 */
export function buildChatBody(messages: ChatMessage[], opts: ChatOptions, model: string): Record<string, unknown> {
  return {
    model,
    messages,
    stream: false,
    temperature: opts.temperature ?? 0.1,
    max_tokens: opts.maxTokens ?? 1024,
    ...(opts.thinking ? { thinking: { type: opts.thinking } } : {}),
  }
}

/** 长输出（抽取 / 判分）在 20s 会超时，客户端给到 90s。 */
export async function chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
  const url = `${ENDPOINTS.maasBase.replace(/\/$/, '')}/chat/completions`
  const body = buildChatBody(messages, opts, ENDPOINTS.maasModel)
  const run = async (): Promise<string> => {
    const res = await httpJson<ChatResponse>({
      url,
      method: 'POST',
      data: body,
      header: { 'Content-Type': 'application/json', Authorization: `Bearer ${maasApiKey()}` },
      timeout: opts.timeout ?? 90000,
      retry: false, // 重试由本层统一控制，便于解析业务错误
      route: 'chat', // H5 开发预览走本机代理
    })
    if (res.error) throw new CloudError(`模型服务返回错误：${res.error.message || '未知'}`, 0)
    const choice = res.choices?.[0]
    const content = choice?.message?.content
    if (!content) {
      // 区分「被思考截断」与「真空结果」，给出可操作提示而不是笼统失败
      if (choice?.finish_reason === 'length' && choice?.message?.reasoning_content) {
        throw new CloudError('模型思考过程占满了输出额度，请重试（或改用文本录入）', 0, undefined, true)
      }
      throw new CloudError('模型未返回内容', 0, undefined, true)
    }
    return content
  }
  try {
    return await withRetry(run, { retries: 2 })
  } catch (e) {
    logger.error('maas.error', { code: (e as CloudError).code })
    throw e
  }
}

/** 要求模型返回严格 JSON；去掉可能出现的代码块围栏后解析。 */
export async function chatJson<T>(messages: ChatMessage[], opts: ChatOptions = {}): Promise<T> {
  const raw = await chat(messages, opts)
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    return JSON.parse(cleaned) as T
  } catch (_) {
    // 容错：截取第一个 { 到最后一个 }，避免模型夹带解释文字
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try { return JSON.parse(cleaned.slice(start, end + 1)) as T } catch (_) { /* fallthrough */ }
    }
    throw new CloudError('模型返回内容不是有效的 JSON', 0, undefined, true)
  }
}

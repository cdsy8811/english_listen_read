/**
 * 电子词典的模型调用层（只做传输，不拼业务 prompt）。
 * 与抽取 / 判分共用 Spark X2.6：结构化输出必须关思考，否则长输出会被
 * reasoning_content 吃掉 max_tokens，content 为空。
 */
import { chatJson, type ChatMessage } from './xfyun-maas.ts'

/**
 * 查词：返回严格的词典 JSON。
 * 词典条目比判分结果长（多义项 + 例句 + 短语），默认 max_tokens 3000、超时 60s；
 * 跟读页的「点词速览」只要几十个 token，调用方可以传入更小的额度与更短的超时。
 */
export async function dictChatJson<T>(
  messages: ChatMessage[],
  opts: { maxTokens?: number; timeout?: number } = {},
): Promise<T> {
  return chatJson<T>(messages, {
    temperature: 0.1,
    maxTokens: opts.maxTokens ?? 3000,
    thinking: 'disabled',
    timeout: opts.timeout ?? 60000,
  })
}

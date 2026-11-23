/** 音频文件与文本哈希工具：合成结果落本地缓存，避免重复计费。 */
import { base64Decode, sha256, utf8Encode } from './crypto.ts'
import { writeBytes } from './plus-io.ts'
import { kb, logger } from './log.ts'

export function textHash(text: string): string {
  const bytes = sha256(utf8Encode(text))
  return Array.from(bytes.slice(0, 10)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function audioFilePath(hash: string): string {
  return `_doc/audio/${hash}.mp3`
}

/**
 * 把音频字节写到 App 私有目录，返回可播放的本地路径。
 * 注意：App 端逻辑层没有 Blob（`Blob is not defined` 会把 onMessage 回调打崩），
 * 所以走 plus-io 的 writeBytes（Android FileOutputStream），不要在这里构造 Blob。
 */
export async function saveAudioBytes(bytes: Uint8Array, hash: string): Promise<string> {
  logger.debug('audio.save', { hash, kb: kb(bytes.length) })
  // 文件名与 dir 分开传：writeBytes 会把它拼成 _doc/audio/<hash>.mp3，
  // 与 audioFilePath() / media_cache 里存的路径保持一致
  const url = await writeBytes(`${hash}.mp3`, bytes, 'audio')
  // #ifdef APP-PLUS
  // 统一返回与 media_cache 相同的相对路径，播放时由 absolutePath() 转系统绝对路径。
  // 不返回 entry.toLocalURL() 的 file:// URL：部分 ROM 的 MediaPlayer 直接报 MediaError，
  // 而缓存命中的第二次播放走的是这条相对路径，所以表现为「第一次失败、第二次正常」。
  return audioFilePath(hash)
  // #endif
  // #ifndef APP-PLUS
  return url
  // #endif
}

/** 兼容入口：base64 → 文件（分帧拼接请先解码再合并，见 mergeFrames）。 */
export function saveAudio(base64: string, hash: string): Promise<string> {
  logger.debug('audio.saveBase64', { hash, kb: kb(base64.length) })
  return saveAudioBytes(base64Decode(base64), hash)
}

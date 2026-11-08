/** 音频文件与文本哈希工具：合成结果落本地缓存，避免重复计费。 */
import { base64Decode, sha256, utf8Encode } from './crypto.ts'
import { toBlob, writeBlob } from './plus-io.ts'

export function textHash(text: string): string {
  const bytes = sha256(utf8Encode(text))
  return Array.from(bytes.slice(0, 10)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function audioFilePath(hash: string): string {
  return `_doc/audio/${hash}.mp3`
}

/** 把音频字节写到 App 私有目录，返回可播放的本地路径。 */
export function saveAudioBytes(bytes: Uint8Array, hash: string): Promise<string> {
  const blob = toBlob(bytes, 'audio/mpeg')
  return writeBlob(`audio/${hash}.mp3`, blob, 'audio')
}

/** 兼容入口：base64 → 文件（分帧拼接请先解码再合并，见 mergeFrames）。 */
export function saveAudio(base64: string, hash: string): Promise<string> {
  return saveAudioBytes(base64Decode(base64), hash)
}

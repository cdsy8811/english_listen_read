/**
 * 图片读取与压缩（App 端用 5+ 原生文件读，H5 预览用 fetch）。
 * OCR 要求 base64 编码后 ≤ 4M；拍照图通常 3–10M，必须先压缩。
 */
import { readDataUrl } from './plus-io.ts'

export interface ImagePayload { base64: string; encoding: 'jpg' | 'png' }

const MAX_B64 = 4 * 1024 * 1024

function readAsBase64(filePath: string): Promise<string> {
  return readDataUrl(filePath).catch(() => Promise.reject(new Error('读取图片失败')))
}

function compress(filePath: string, quality: number): Promise<string> {
  return new Promise((resolve) => {
    // #ifdef APP-PLUS
    uni.compressImage({
      src: filePath, quality, compressedWidth: 1600,
      success: (r) => resolve(r.tempFilePath),
      fail: () => resolve(filePath), // 压缩失败仍用原图，后续按大小判断
    })
    // #endif
    // #ifndef APP-PLUS
    resolve(filePath)
    // #endif
  })
}

/** 拍照 / 相册选出的临时路径 → 满足 4M 限制的 base64。 */
export async function prepareImage(filePath: string): Promise<ImagePayload> {
  const path = filePath
  for (const q of [80, 60, 40]) {
    const compressed = await compress(path, q)
    const base64 = await readAsBase64(compressed)
    if (base64.length <= MAX_B64) return { base64, encoding: 'jpg' }
  }
  throw new Error('图片过大（压缩后仍超过 4M），请裁剪后分次拍照')
}

/** 拍照或从相册选择，返回临时文件路径。 */
export function chooseImage(source: 'camera' | 'album'): Promise<string> {
  return new Promise((resolve, reject) => {
    uni.chooseImage({
      count: 1,
      sourceType: [source],
      sizeType: ['compressed'],
      success: (r) => resolve(r.tempFilePaths[0]),
      fail: () => reject(new Error('已取消选择图片')),
    })
  })
}

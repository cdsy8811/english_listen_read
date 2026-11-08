/**
 * 内置词库：2024 新版人教版《义务教育教科书 英语》七年级上册 + 下册
 * 「Vocabulary in Each Unit」词汇表（教材真实词条，逐页 OCR + 结构化抽取）。
 *
 * 生成链：scripts/extract-pep-vocab.ts → scripts/build-pep-vocab.mjs → src/data/vocab-pep7.ts
 * 教材版权归人民教育出版社，数据仅随本机 APK 用于个人学习，不分发。
 * 导入走 importBundle 的「同 id 覆盖」语义，重复点不会重复建单元。
 */
import { VOCAB_BUNDLE, VOCAB_UNITS, VOCAB_WORDS } from '../data/vocab-pep7.ts'
import { importBundle } from './storage.ts'
import type { ExportBundle } from './types.ts'

export const SEED_UNITS = VOCAB_UNITS
export const SEED_WORDS = VOCAB_WORDS

/** 载入内置词库；返回实际写入的单元 / 词条数。 */
export async function seedBuiltinVocab(): Promise<{ units: number; words: number }> {
  // 深拷贝，避免 importBundle 里的字段补全污染模块级 JSON
  const bundle = JSON.parse(JSON.stringify(VOCAB_BUNDLE)) as ExportBundle
  return importBundle(bundle)
}

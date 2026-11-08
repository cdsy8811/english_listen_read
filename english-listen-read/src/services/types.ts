/** 领域模型与能力层接口定义。上层页面只依赖这些类型，不感知讯飞地址 / 模型 / 签名。 */

export type PracticeMode = '2.1' | '2.2' | '2.3'
export type AnswerType = 'record' | 'input'
export type AdvanceMode = 'submit' | 'timer'
export type Strictness = 'loose' | 'normal' | 'strict'
export type PlayOrder = 'en-zh' | 'zh-en' | 'en-only'
export type Accent = 'US' | 'UK'

export interface Unit {
  id: string
  title: string
  source_img: string
  created_at: number
}

export interface Word {
  id: string
  unit_id: string
  word: string
  phonetic_uk: string
  phonetic_us: string
  pos: string
  translation: string
  example: string
  audio_path: string
  sort: number
  wrong: number
  wrong_count: number
}

/** 校对页的可编辑草稿（抽取结果，尚未落库）。 */
export interface WordDraft {
  word: string
  phonetic: string
  pos: string
  translation: string
  example?: string
}

export interface PracticeRecord {
  id: string
  word_id: string
  mode: PracticeMode
  input_type: AnswerType | 'mastered'
  raw_text: string
  asr_text: string
  score: number
  detail_json: string
  created_at: number
}

export interface Settings {
  /** 全局朗读速度 0.5–2.0 */
  speed: number
  accent: Accent
  volume: number
  autoPlay: boolean
  /** 2.1 播放顺序 */
  playOrder: PlayOrder
  /** 2.1 重复次数 1–3 */
  repeatTimes: number
  /** 2.1 条目间隔 0–10 秒 */
  itemGapSec: number
  /** 2.2 / 2.3 作答方式 */
  answerType: AnswerType
  /** 2.2 / 2.3 推进模式 */
  advanceMode: AdvanceMode
  /** 定时推进等待秒数 1–15 */
  waitSec: number
  /** 评分严格度 */
  strictness: Strictness
  /** 低于该分自动进错词本 */
  wrongThreshold: number
}

export const DEFAULT_SETTINGS: Settings = {
  speed: 1.0,
  accent: 'US',
  volume: 80,
  autoPlay: true,
  playOrder: 'en-zh',
  repeatTimes: 1,
  itemGapSec: 1.5,
  answerType: 'record',
  advanceMode: 'submit',
  waitSec: 3,
  strictness: 'normal',
  wrongThreshold: 60,
}

/** 评价结果：只表示「内容正确度」，不含任何发音维度。 */
export interface EvalResult {
  score: number
  /** 逐词对错，仅表示文本对错 */
  highlights: Array<{ text: string; ok: boolean }>
  expected: string
  answer: string
  asrText: string
  feedback: string
  /** 是否走了云端语义判分（离线时 false） */
  semantic: boolean
}

/** 能力层可插拔接口：页面只调 services，不调 api。日后迁云函数只改 src/api。 */
export interface Capabilities {
  recognize(imageBase64: string, encoding: string): Promise<string>
  extractWords(markdown: string): Promise<WordDraft[]>
  speak(text: string, opts: { lang: 'zh' | 'en'; speed: number; volume: number }): Promise<string>
  transcribe(audioBase64: string, lang: 'zh' | 'en'): Promise<string>
  evaluate(input: EvalInput): Promise<EvalResult>
}

export interface EvalInput {
  mode: PracticeMode
  word: Word
  /** 输入框原文 / 录音转写后的文本 */
  answer: string
  asrText: string
  inputType: AnswerType
  strictness: Strictness
}

export interface ExportBundle {
  version: 1
  exported_at: number
  units: Unit[]
  words: Word[]
}

/**
 * 词典生词本：把查到的词一键收进专用学习单元「词典生词」，
 * 之后可以直接用现有四种练习模式复习。单元按标题复用，同词不重复加。
 */
import { createUnit, draftToWord, listUnits, listWords, saveWord } from './storage.ts'
import type { Word } from './types.ts'
import type { DictEntry } from './dictionary.ts'

export const DICT_NOTEBOOK_TITLE = '词典生词'

function translationOf(entry: DictEntry): string {
  return entry.senses
    .map((s) => `${s.pos ? `${s.pos} ` : ''}${s.def_zh || s.def_en}`.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join('；')
    .slice(0, 300)
}

function exampleOf(entry: DictEntry): string {
  const ex = entry.senses.flatMap((s) => s.examples)[0]
  if (!ex) return ''
  return ex.zh ? `${ex.en} ${ex.zh}` : ex.en
}

export async function addEntryToNotebook(entry: DictEntry): Promise<{ unitId: string; added: boolean; word: Word }> {
  const units = await listUnits()
  const unit = units.find((u) => u.title === DICT_NOTEBOOK_TITLE) || await createUnit(DICT_NOTEBOOK_TITLE)
  const words = await listWords(unit.id)
  const key = entry.word.toLowerCase()
  const existing = words.find((w) => w.word.toLowerCase() === key)
  if (existing) return { unitId: unit.id, added: false, word: existing }

  const draft = draftToWord({
    word: entry.word,
    phonetic: entry.phonetic_us || entry.phonetic_uk,
    pos: entry.senses[0]?.pos || '',
    translation: translationOf(entry),
    example: exampleOf(entry),
  }, unit.id, words.length)
  // draftToWord 只带一个音标，词典条目英美音都有，这里补齐
  const word: Word = {
    ...draft,
    phonetic_us: entry.phonetic_us,
    phonetic_uk: entry.phonetic_uk,
  }
  await saveWord(word)
  return { unitId: unit.id, added: true, word }
}

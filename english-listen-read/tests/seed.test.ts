/**
 * 内置词库自测：数据格式、去重、可导入、单元顺序。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createMemoryDb, setDbForTest, initDatabase } from '../src/utils/db.ts'
import * as repo from '../src/services/storage.ts'
import { seedBuiltinVocab, SEED_UNITS, SEED_WORDS } from '../src/services/seed.ts'

test('内置初一词汇：教材单元齐全，全部字段可用', async () => {
  assert.equal(SEED_UNITS, 18)
  assert.ok(SEED_WORDS >= 700, `词条数偏少：${SEED_WORDS}`)
  const db = createMemoryDb()
  setDbForTest(db)
  await initDatabase()

  const out = await seedBuiltinVocab()
  assert.equal(out.units, SEED_UNITS)
  assert.equal(out.words, SEED_WORDS)

  const units = await repo.listUnits()
  assert.equal(units.length, SEED_UNITS)
  // created_at 递减 → 七上 Starter Unit 1 排第一
  assert.match(units[0].title, /^七上 Starter Unit 1/)

  const words = await repo.listWords(units[0].id)
  assert.ok(words.length >= 20, '第一单元词条数偏少')
  for (const w of words) {
    assert.ok(w.word.trim(), '单词不能为空')
    assert.ok(w.translation.trim(), `${w.word} 缺释义`)
    // 音标允许为空（短语）；非空时不得残留 OCR 的方框 / LaTeX 公式
    if (w.phonetic_us) {
      assert.doesNotMatch(w.phonetic_us, /[☐□$\\]|square|prime/i, `${w.word} 音标异常：${w.phonetic_us}`)
      assert.ok(w.phonetic_us.length <= 45, `${w.word} 音标过长`)
    }
  }
})

test('重复载入不新增单元，词条不翻倍', async () => {
  const db = createMemoryDb()
  setDbForTest(db)
  await initDatabase()
  await seedBuiltinVocab()
  await seedBuiltinVocab()
  const units = await repo.listUnits()
  assert.equal(units.length, SEED_UNITS)
  // searchWords 有 LIMIT 200，这里按单元逐个数
  let total = 0
  for (const u of units) total += (await repo.listWords(u.id)).length
  assert.equal(total, SEED_WORDS)
})

test('词库内没有重复单词', async () => {
  const db = createMemoryDb()
  setDbForTest(db)
  await initDatabase()
  await seedBuiltinVocab()
  const units = await repo.listUnits()
  const all = []
  for (const u of units) all.push(...(await repo.listWords(u.id)))
  const seen = new Set<string>()
  for (const w of all) {
    const k = w.word.toLowerCase()
    assert.ok(!seen.has(k), `重复单词：${w.word}`)
    seen.add(k)
  }
})

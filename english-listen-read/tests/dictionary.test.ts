/** 电子词典：查询识别 / prompt / 模型结果清洗 / 本地缓存与历史（全部离线可测）。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createMemoryDb, getDb, initDatabase, setDbForTest } from '../src/utils/db.ts'
import {
  buildCandidatePrompt, buildEntryPrompt, buildGlossPrompt, clearDictCache, clearDictHistory,
  clearGlossCache, detectQueryLang, dictCacheId, listDictHistory, lookupDictionary, lookupGlosses,
  normalizeCandidates, normalizeEntry, normalizeGlosses, normalizeQuery, pushDictHistory,
  putDictCache, readCachedDictionary,
} from '../src/services/dictionary.ts'
import { addEntryToNotebook, DICT_NOTEBOOK_TITLE } from '../src/services/dict-notebook.ts'
import { createUnit, listUnits, listWords, saveWord } from '../src/services/storage.ts'

function freshDb() {
  const db = createMemoryDb()
  setDbForTest(db)
  return db
}

const ENTRY_RAW = {
  entry: {
    word: 'Benefit',
    base: '',
    phonetic_uk: '/ˈbenɪfɪt/',
    phonetic_us: '/ˈbenɪfɪt/',
    forms: ['benefits', 'benefited', 'benefit', 'benefits'],
    senses: [
      {
        pos: 'n.$',
        def_zh: '好处；益处',
        def_en: 'an advantage or profit gained from something',
        examples: [
          { en: 'Regular exercise has many health benefits.', zh: '经常锻炼对健康有很多好处。' },
          { en: 'Regular exercise has many health benefits.', zh: '重复例句应被去掉' },
        ],
      },
      { pos: 'v.', def_zh: '受益；得益', def_en: '', examples: [] },
      { pos: '', def_zh: '', def_en: '', examples: [] },
    ],
    phrases: [{ en: 'benefit from', zh: '从……中受益' }, { en: 'for the benefit of', zh: '为了……的利益' }],
    synonyms: ['advantage', 'profit', 'advantage'],
    antonyms: ['harm', 'disadvantage'],
    notes: 'benefit 作名词时更常用；benefit from 后接名词或动名词。',
  },
}

test('中英查询识别与查询词规范化', () => {
  assert.equal(detectQueryLang('benefit'), 'en')
  assert.equal(detectQueryLang('give up'), 'en')
  assert.equal(detectQueryLang('take off'), 'en')
  assert.equal(detectQueryLang('放弃'), 'zh')
  assert.equal(detectQueryLang('abandon 放弃'), 'zh')
  assert.equal(normalizeQuery('  give   up  '), 'give up')
  assert.equal(normalizeQuery('中文　释义'), '中文 释义')
  assert.equal(normalizeQuery('x'.repeat(100)).length, 60)
  assert.equal(dictCacheId('en', '  Benefit '), 'en:benefit')
  assert.equal(dictCacheId('zh', '放弃'), 'zh:放弃')
})

test('词典 prompt 带词 / 中文，并明确要求 IPA 与严格 JSON', () => {
  const en = buildEntryPrompt('benefit')
  assert.ok(en.includes('benefit'))
  assert.ok(en.includes('phonetic_uk'))
  assert.ok(en.includes('无法确认的字段用空字符串'))
  assert.ok(!en.includes('```'))
  const zh = buildCandidatePrompt('放弃')
  assert.ok(zh.includes('放弃'))
  assert.ok(zh.includes('candidates'))
  assert.ok(zh.includes('6–8 个候选'))
})

test('条目清洗：兼容 {entry:{...}}、去重、限长、词性/音标修复', () => {
  const e = normalizeEntry(ENTRY_RAW)
  assert.equal(e.word, 'Benefit')
  assert.equal(e.base, '')
  assert.equal(e.senses.length, 2)            // 空义项被丢弃
  assert.equal(e.senses[0].pos, 'n.')         // n.$ → n.
  assert.equal(e.senses[0].def_zh, '好处；益处')
  assert.equal(e.senses[0].examples.length, 1) // 重复例句去重
  assert.deepEqual(e.forms, ['benefits', 'benefited', 'benefit'])
  assert.deepEqual(e.synonyms, ['advantage', 'profit'])
  assert.equal(e.phrases.length, 2)
  assert.ok(e.phonetic_us.startsWith('/') && e.phonetic_us.endsWith('/'))
})

test('条目清洗：变形词保留原形；无释义视为失败', () => {
  const e = normalizeEntry({ word: 'ran', base: 'run', senses: [{ pos: 'v.', def_zh: '跑' }] })
  assert.equal(e.word, 'ran')
  assert.equal(e.base, 'run')
  const same = normalizeEntry({ word: 'run', base: 'run', senses: [{ def_zh: '跑' }] })
  assert.equal(same.base, '')
  assert.throws(() => normalizeEntry({ entry: { word: 'x', senses: [] } }), /没有返回有效释义/)
  assert.throws(() => normalizeEntry(null), /没有返回有效释义/)
})

test('音标乱码一律丢弃（复用 OCR 的清洗规则）', () => {
  const e = normalizeEntry({
    word: 'abandon',
    phonetic_us: '/${u0259}$b$\\square$nd$\\square$n/',
    phonetic_uk: '☐☐☐',
    senses: [{ pos: 'v.', def_zh: '放弃' }],
  })
  assert.equal(e.phonetic_us, '')
  assert.equal(e.phonetic_uk, '')
})

test('中文候选清洗：数组 / {candidates} 都接，去重、空结果报错', () => {
  const c = normalizeCandidates({
    candidates: [
      { word: 'abandon', phonetic_us: '/əˈbændən/', pos: 'v.', brief: '放弃；抛弃' },
      { word: 'Abandon', brief: '重复项' },
      { word: 'give up', brief: '放弃（短语）' },
      { word: 'quit', brief: 'quit' },
    ],
  })
  assert.deepEqual(c.map((x) => x.word), ['abandon', 'give up', 'quit'])
  assert.equal(c[0].brief, '放弃；抛弃')
  assert.equal(normalizeCandidates([{ word: 'insist', brief: '坚持' }])[0].word, 'insist')
  assert.throws(() => normalizeCandidates({ candidates: [] }), /没有找到对应的英文单词/)
})

test('词典缓存：写入后断网可读，中文候选同样可缓存', async () => {
  freshDb()
  await initDatabase()
  const at = Date.now()
  const en = normalizeEntry(ENTRY_RAW)
  await putDictCache({ kind: 'en', query: 'Benefit', entry: en, cached: false, at })
  const hit = await readCachedDictionary('  benefit ')
  assert.ok(hit && hit.kind === 'en')
  assert.equal(hit.cached, true)
  assert.equal(hit.entry.senses.length, 2)

  const cands = normalizeCandidates({ candidates: [{ word: 'abandon', brief: '放弃' }] })
  await putDictCache({ kind: 'zh', query: '放弃', candidates: cands, cached: false, at })
  const zh = await readCachedDictionary('放弃')
  assert.ok(zh && zh.kind === 'zh')
  assert.equal(zh.candidates[0].word, 'abandon')

  assert.equal(await readCachedDictionary('不存在的词'), null)

  await clearDictCache()
  assert.equal(await readCachedDictionary('benefit'), null)
})

test('查询历史：重复查询只留一条，按时间倒序，可清空', async () => {
  freshDb()
  await initDatabase()
  await pushDictHistory('benefit', 'en')
  await new Promise((r) => setTimeout(r, 5))
  await pushDictHistory('放弃', 'zh')
  await new Promise((r) => setTimeout(r, 5))
  await pushDictHistory(' BENEFIT ', 'en')
  const list = await listDictHistory(10)
  assert.equal(list.length, 2)
  assert.equal(list[0].query, 'BENEFIT')  // 最近查询在前
  assert.equal(list[1].query, '放弃')
  assert.equal(list[0].lang, 'en')
  await pushDictHistory('   ', 'en')       // 空查询不记录
  assert.equal((await listDictHistory(10)).length, 2)
  await clearDictHistory()
  assert.equal((await listDictHistory(10)).length, 0)
})

test('查词入口：空查询直接给出提示，不发网络请求', async () => {
  freshDb()
  await initDatabase()
  await assert.rejects(() => lookupDictionary('   '), /请输入要查询的英文单词或中文释义/)
})

test('点词速览：prompt 只问释义与音标，结果清洗去重且丢掉空项', () => {
  const prompt = buildGlossPrompt(['walked', 'school'])
  assert.match(prompt, /walked/)
  assert.match(prompt, /school/)
  assert.match(prompt, /brief/)
  assert.match(prompt, /不要例句/)
  assert.ok(prompt.length < 400)  // 输出越短越快，prompt 也不能膨胀

  const list = normalizeGlosses({
    items: [
      { word: 'walked', phonetic_us: '/wɔːkt/', brief: '走；步行' },
      { word: 'Walked', brief: '重复项' },
      { word: 'school', phonetic_us: '☐☐', brief: ' 学校；上学 ' },
      { word: '', brief: '没有单词' },
      { word: 'empty', brief: '   ' },
    ],
  })
  assert.deepEqual(list.map((g) => g.word), ['walked', 'school'])
  assert.equal(list[0].phonetic, '/wɔːkt/')
  assert.equal(list[1].brief, '学校；上学')
  assert.equal(list[1].phonetic, '')  // 乱码音标丢弃
  assert.deepEqual(normalizeGlosses({ items: [] }), [])
  assert.deepEqual(normalizeGlosses(null), [])
})

test('点词速览：词库精确命中优先，速览缓存离线可读，空输入不发请求', async () => {
  freshDb()
  await initDatabase()
  const unit = await createUnit('Unit 1')
  await saveWord({
    id: 'w1', unit_id: unit.id, word: 'Benefit',
    phonetic_uk: '/ˈbenɪfɪt/', phonetic_us: '/ˈbenɪfɪt/', pos: 'n.',
    translation: '好处；益处', example: '', audio_path: '', sort: 0, wrong: 0, wrong_count: 0,
  })

  const local = await lookupGlosses(['  benefit ', 'Benefit', '中文'])
  assert.equal(local.length, 1)
  assert.equal(local[0].source, 'library')
  assert.equal(local[0].brief, '好处；益处')

  // 预置一条速览缓存：不联网也能读到
  await getDb().exec(
    'INSERT OR REPLACE INTO gloss_cache (id, word, payload, created_at) VALUES (?, ?, ?, ?)',
    ['school', 'school', JSON.stringify({ phonetic: '/skuːl/', brief: '学校；上学' }), Date.now()],
  )
  const cached = await lookupGlosses(['school'], { accent: 'UK' })
  assert.equal(cached[0].source, 'cache')
  assert.equal(cached[0].brief, '学校；上学')
  assert.equal(cached[0].phonetic, '/skuːl/')

  assert.deepEqual(await lookupGlosses([]), [])
  assert.deepEqual(await lookupGlosses(['   ', '123']), [])
  await clearGlossCache()
  assert.equal((await getDb().all('SELECT * FROM gloss_cache')).length, 0)
})

test('生词本：自动建「词典生词」单元，同词不重复收录，音标与例句齐全', async () => {
  freshDb()
  await initDatabase()
  const entry = normalizeEntry(ENTRY_RAW)
  const first = await addEntryToNotebook(entry)
  assert.equal(first.added, true)
  const units = await listUnits()
  assert.equal(units.length, 1)
  assert.equal(units[0].title, DICT_NOTEBOOK_TITLE)
  const words = await listWords(first.unitId)
  assert.equal(words.length, 1)
  assert.equal(words[0].word, 'Benefit')
  assert.equal(words[0].phonetic_us, '/ˈbenɪfɪt/')
  assert.equal(words[0].pos, 'n.')
  assert.ok(words[0].translation.includes('好处'))
  assert.ok(words[0].example.includes('health benefits'))

  const again = await addEntryToNotebook(entry)
  assert.equal(again.added, false)
  assert.equal((await listWords(first.unitId)).length, 1)
})

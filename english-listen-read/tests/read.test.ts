/**
 * 跟读功能离线自测：短文清洗 / 切句 / 逐词对齐评分 / 本地库 CRUD。
 * 运行：node --experimental-strip-types --test tests/*.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createMemoryDb, getDb, initDatabase, setDbForTest } from '../src/utils/db.ts'
import * as repo from '../src/services/storage.ts'
import {
  cleanEnglishText, countWords, fallbackTitle, markdownToSentences, normalizePassageResult,
  parseSentences, splitSentences, tokenizeWords,
} from '../src/services/passage.ts'
import { buildTranslatePrompt, normalizeTranslations } from '../src/services/passage-translate.ts'
import { alignPassage, localPassageEvaluate, normalizeToken } from '../src/services/passage-eval.ts'

function freshDb() {
  setDbForTest(createMemoryDb())
}

/* ---------------- 短文清洗与切句 ---------------- */

test('切句：小数点与常见缩写不断句', () => {
  const out = splitSentences('Mr. Smith has 2.5 apples. He likes them! Do you?')
  assert.equal(out.length, 3)
  assert.equal(out[0], 'Mr. Smith has 2.5 apples.')
  assert.equal(out[1], 'He likes them!')
  assert.equal(out[2], 'Do you?')
})

test('切句：没有句末标点的尾句也保留', () => {
  assert.deepEqual(splitSentences('He ran fast'), ['He ran fast'])
})

test('本地兜底：丢弃中文注解 / 页码 / 单元标题，修复断词与断行', () => {
  const md = [
    '# Unit 3 课文',
    '',
    'The little girl（小女孩） walked to school. She',
    'carried an exam-',
    'ple book. 页码 40',
    '她每天走路去学校。',
    '',
    '2',
  ].join('\n')
  const out = markdownToSentences(md)
  assert.deepEqual(out, ['The little girl walked to school.', 'She carried an example book.'])
})

test('本地兜底：纯中文 / 空文本返回空数组', () => {
  assert.deepEqual(markdownToSentences('这是中文释义，没有英文。'), [])
  assert.deepEqual(markdownToSentences('   '), [])
})

test('手工添加：粘贴的段落按句切分，空名称用第一句兜底（不联网）', () => {
  const text = [
    'The little girl walked to school.',
    'She carried a book. 中文注解：她带着一本书。',
    '',
    'He ran fast',
  ].join('\n')
  const sentences = markdownToSentences(text)
  // 最后一句没有句末标点，也要补齐成可朗读的句子
  assert.deepEqual(sentences, [
    'The little girl walked to school.',
    'She carried a book.',
    'He ran fast.',
  ])
  assert.equal(fallbackTitle(sentences), 'The little girl walked to school')
})

test('清洗：去 markdown 记号与行内中文，压空白', () => {
  const s = cleanEnglishText('**Hello** [world](http://x)（世界）  \n\n  again  ')
  assert.equal(s, 'Hello world again')
})

test('模型结果清洗：补标点、去空句、标题兜底', () => {
  const r = normalizePassageResult({
    title: '  A Day Out  ',
    sentences: ['He went out.', 'It rained', '   ', '中文一句'],
  })
  assert.equal(r.title, 'A Day Out')
  assert.deepEqual(r.sentences, ['He went out.', 'It rained.'])

  const noTitle = normalizePassageResult({ sentences: ['The quick brown fox jumps.'] })
  assert.equal(noTitle.title, 'The quick brown fox jumps')
})

test('模型结果清洗：没有英文句子时抛错，交给上层降级', () => {
  assert.throws(() => normalizePassageResult({ sentences: ['只有中文'] }), /没有识别到英文短文/)
})

test('取词：保留缩写与连字符，词数按单词算', () => {
  assert.deepEqual(
    tokenizeWords("It's a well-known fact, isn't it?"),
    ["It's", 'a', 'well-known', 'fact', "isn't", 'it'],
  )
  assert.equal(countWords(['One two.', 'Three.']), 3)
})

test('存储 JSON 解析：坏数据按空数组处理', () => {
  assert.deepEqual(parseSentences('["A.","B."]'), ['A.', 'B.'])
  assert.deepEqual(parseSentences('not json'), [])
  assert.deepEqual(parseSentences('{"a":1}'), [])
})

/* ---------------- 逐句中文翻译（AI 整句翻译） ---------------- */

test('译文 prompt：逐句编号送入，要求同序同数量、只输出中文', () => {
  const prompt = buildTranslatePrompt(['The girl walked to school.', 'She carried a book.'])
  assert.match(prompt, /1\. The girl walked to school\./)
  assert.match(prompt, /2\. She carried a book\./)
  assert.match(prompt, /translations/)
  assert.match(prompt, /数量必须与输入句子数完全一致/)
})

test('译文清洗：按顺序取值、去序号与引号、数量不足补空、超出截断', () => {
  const list = normalizeTranslations({
    translations: ['1. 小女孩走路去学校。', '“她带着一本书。”', '多出来的'],
  }, 2)
  assert.deepEqual(list, ['小女孩走路去学校。', '她带着一本书。'])

  assert.deepEqual(normalizeTranslations({ translations: ['只有一句'] }, 3), ['只有一句', '', ''])
  assert.deepEqual(normalizeTranslations(['一。'], 1), ['一。'])
  assert.deepEqual(normalizeTranslations(null, 2), ['', ''])
  assert.deepEqual(normalizeTranslations({ items: [{ nope: 1 }] }, 1), [''])
})

/* ---------------- 逐词对齐评分 ---------------- */

test('对齐：完全读对给 100，大小写与标点忽略', () => {
  const r = localPassageEvaluate('The cat sat on the mat.', 'the cat sat on the mat')
  assert.equal(r.score, 100)
  assert.equal(r.words.length, 6)
  assert.ok(r.words.every((w) => w.status === 'ok'))
  assert.equal(r.extra.length, 0)
  assert.equal(r.total, 6)
})

test('对齐：漏读一个实词按比例扣分，并标记 missed', () => {
  const r = localPassageEvaluate('The cat sat on the mat.', 'The cat on the mat')
  assert.equal(r.words[2].text, 'sat')
  assert.equal(r.words[2].status, 'missed')
  assert.equal(r.hit, 5)
  assert.equal(r.score, 83)
  assert.match(r.feedback, /1 个词/)
})

test('对齐：多读的词轻扣分并单独列出', () => {
  const a = alignPassage('The cat sat on the mat.', 'The cat sat today on the mat')
  assert.deepEqual(a.extra, ['today'])
  const r = localPassageEvaluate('The cat sat on the mat.', 'The cat sat today on the mat')
  assert.equal(r.score, 97)
})

test('对齐：同音词与一个字母的转写误差算近似读对', () => {
  assert.equal(normalizeToken("Don’t"), "don't")
  const homo = localPassageEvaluate('I have two books.', 'I have to books')
  assert.equal(homo.words[2].status, 'near')
  assert.ok(homo.score >= 95)

  const typo = localPassageEvaluate('We are reading now.', 'We are readin now')
  assert.equal(typo.words[2].status, 'near')
})

test('对齐：没有识别到内容给 0 分且全部标记漏读', () => {
  const r = localPassageEvaluate('Read this sentence.', '')
  assert.equal(r.score, 0)
  assert.equal(r.hit, 0)
  assert.ok(r.words.every((w) => w.status === 'missed'))
})

test('对齐：完全无关的转写不给分', () => {
  const r = localPassageEvaluate('The cat sat on the mat.', 'completely different words here')
  assert.equal(r.score, 0)
  assert.ok(r.extra.length > 0)
})

/* ---------------- 跟读文章本地库 ---------------- */

test('跟读文章：创建 / 列表 / 重命名 / 最新分数 / 删除', async () => {
  freshDb()
  await initDatabase()

  const a = await repo.createArticle({ title: '', sentences: ['Hello world.', 'How are you?'], sourceImg: '/tmp/a.jpg' })
  assert.equal(a.title, '跟读短文')
  assert.equal(a.sentences.length, 2)

  const listed = await repo.listArticleSummaries()
  assert.equal(listed.length, 1)
  assert.equal(listed[0].checked, 0)
  assert.equal(listed[0].lastScore, 0)

  await repo.renameArticle(a.id, '  My Passage  ')
  const renamed = await repo.getArticle(a.id)
  assert.equal(renamed?.title, 'My Passage')

  const base = { article_id: a.id, asr_text: 'hello world', detail_json: '{}' }
  await repo.addReadRecord({ ...base, id: 'rr1', sentence_index: 0, score: 80, created_at: 100 })
  await repo.addReadRecord({ ...base, id: 'rr2', sentence_index: 0, score: 95, created_at: 200 })
  await repo.addReadRecord({ ...base, id: 'rr3', sentence_index: 1, score: 70, created_at: 300 })

  const scores = await repo.latestSentenceScores(a.id)
  assert.deepEqual(scores, { 0: 95, 1: 70 })

  const summary = (await repo.listArticleSummaries())[0]
  assert.equal(summary.checked, 2)
  assert.equal(summary.lastScore, 83)
  assert.equal(summary.lastAt, 300)

  await repo.deleteArticle(a.id)
  assert.equal((await repo.listArticles()).length, 0)
  assert.equal((await repo.listReadRecords(a.id)).length, 0)
})

test('跟读文章：句子序列化后仍按数组读回', async () => {
  freshDb()
  await initDatabase()
  const a = await repo.createArticle({ title: 'T', sentences: ['One.', 'Two.', 'Three.'] })
  const back = await repo.getArticle(a.id)
  assert.deepEqual(back?.sentences, ['One.', 'Two.', 'Three.'])
  assert.deepEqual(back?.translations, ['', '', ''])
})

test('跟读文章：逐句译文与句子一起存取，老库缺列按空译文读回', async () => {
  freshDb()
  await initDatabase()
  const a = await repo.createArticle({
    title: 'Bilingual', sentences: ['One.', 'Two.'], translations: ['一。'],
  })
  assert.deepEqual(a.translations, ['一。', ''])
  const back = await repo.getArticle(a.id)
  assert.deepEqual(back?.translations, ['一。', ''])

  // 只有第二句有译文：位置不能被压缩，否则译文会串到第一句
  const b = await repo.createArticle({
    title: 'Sparse', sentences: ['One.', 'Two.'], translations: ['', '二。'],
  })
  const sparse = await repo.getArticle(b.id)
  assert.deepEqual(sparse?.translations, ['', '二。'])

  // 老库的行没有 translations 列（升级前写入）：补列后按空译文处理
  await getDb().exec(
    'INSERT OR REPLACE INTO read_article (id, title, source_img, content, created_at) VALUES (?, ?, ?, ?, ?)',
    ['ra_old', '旧文章', '', JSON.stringify(['Old.']), 1],
  )
  const old = await repo.getArticle('ra_old')
  assert.deepEqual(old?.sentences, ['Old.'])
  assert.deepEqual(old?.translations, [''])
})

test('跟读文章：补写译文后回读一致（学习页补翻译用）', async () => {
  freshDb()
  await initDatabase()
  const a = await repo.createArticle({ title: 'T', sentences: ['One.', 'Two.'] })
  assert.deepEqual(a.translations, ['', ''])
  await repo.updateArticleTranslations(a.id, ['一。', '二。'])
  const back = await repo.getArticle(a.id)
  assert.deepEqual(back?.translations, ['一。', '二。'])
})

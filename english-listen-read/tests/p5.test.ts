/**
 * P3 / P4 / P5 综合离线自测：不联网、不依赖真机，覆盖纯逻辑与本地库。
 * 运行：node --experimental-strip-types --test tests/*.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createMemoryDb, setDbForTest, initDatabase } from '../src/utils/db.ts'
import * as repo from '../src/services/storage.ts'
import { exportLibrary, importLibraryJson, parseLibraryJson } from '../src/services/library-io.ts'
import { createAdvanceController } from '../src/services/advance.ts'
import { StateMachine, canTransition } from '../src/services/progress.ts'
import { localEvaluate, meaningCoverage, normalizeEn } from '../src/services/evaluator.ts'
import { buildReadSegments, buildPromptSegment } from '../src/services/player.ts'
import { speedToXf, mergeFrames } from '../src/api/xfyun-tts.ts'
import { buildIatFrames, decodeIatText } from '../src/api/xfyun-iat.ts'
import { DEFAULT_SETTINGS, type Word } from '../src/services/types.ts'

const SRC = path.resolve(import.meta.dirname, '../src')

function freshDb() {
  const db = createMemoryDb()
  setDbForTest(db)
  return db
}

const word: Word = {
  id: 'w_test', unit_id: 'u_test', word: 'abandon',
  phonetic_uk: '', phonetic_us: '/əˈbændən/', pos: 'v.',
  translation: '放弃；抛弃', example: '', audio_path: '',
  sort: 0, wrong: 0, wrong_count: 0,
}

function evalInput(answer: string, mode: '2.2' | '2.3' = '2.2', strictness = 'normal' as const) {
  return { mode, word, answer, asrText: '', inputType: 'input' as const, strictness }
}

/* ---------------- P5 状态机 ---------------- */

test('状态机严格按 idle→playing→awaiting→evaluating→advancing', () => {
  const m = new StateMachine()
  assert.equal(m.state, 'idle')
  assert.equal(m.to('awaiting'), false)      // 不允许绕开 playing
  assert.equal(m.to('playing'), true)
  assert.equal(m.to('advancing'), true)      // 2.1 共读可跳过作答
  assert.equal(m.to('evaluating'), false)
  m.reset()
  const seen: string[] = []
  m.onChange((s) => seen.push(s))
  assert.equal(m.to('playing'), true)
  assert.equal(m.to('awaiting'), true)
  assert.equal(m.to('evaluating'), true)
  assert.equal(m.to('advancing'), true)
  assert.equal(m.to('playing'), true)        // 下一条
  assert.deepEqual(seen, ['playing', 'awaiting', 'evaluating', 'advancing', 'playing'])
  assert.ok(canTransition('playing', 'awaiting'))
  assert.ok(!canTransition('idle', 'evaluating'))
})

/* ---------------- P5 推进模式互斥 ---------------- */

test('提交后模式：不挂定时器，只能手动推进且只推进一次', () => {
  let scheduled = 0
  let advanced = 0
  const c = createAdvanceController({
    getMode: () => 'submit', getWaitSec: () => 3, onAdvance: () => advanced++,
    setTimeoutFn: () => { scheduled++; return 1 }, clearTimeoutFn: () => {},
  })
  c.schedule()
  assert.equal(scheduled, 0)
  assert.equal(advanced, 0)
  c.commitNow()
  c.commitNow()
  assert.equal(advanced, 1)
})

test('定时模式：手动推进会取消定时器，迟到回调不会重复推进', () => {
  let cb: (() => void) | null = null
  let cleared = 0
  let advanced = 0
  const c = createAdvanceController({
    getMode: () => 'timer', getWaitSec: () => 4, onAdvance: () => advanced++,
    setTimeoutFn: (fn) => { cb = fn; return 7 },
    clearTimeoutFn: (h) => { assert.equal(h, 7); cleared++ },
  })
  c.schedule()
  assert.ok(cb)
  c.commitNow()
  assert.equal(cleared, 1)
  assert.equal(advanced, 1)
  cb!()                                     // 即使底层回调仍被投递，也不能再推进
  assert.equal(advanced, 1)
})

test('定时模式：等待秒数夹在 1–15s；reset 后重新武装；cancel 后不再推进', () => {
  const delays: number[] = []
  let cb: (() => void) | null = null
  let advanced = 0
  const c = createAdvanceController({
    getMode: () => 'timer', getWaitSec: () => 99, onAdvance: () => advanced++,
    setTimeoutFn: (fn, ms) => { cb = fn; delays.push(ms); return 1 }, clearTimeoutFn: () => {},
  })
  c.schedule()
  assert.deepEqual(delays, [15000])
  cb!()
  assert.equal(advanced, 1)
  c.reset()
  assert.equal(c.isPending(), true)
  c.schedule()
  cb!()
  assert.equal(advanced, 2)
  c.reset()
  c.cancel()
  c.commitNow()
  assert.equal(advanced, 2)
})

/* ---------------- P5 错词本 ---------------- */

test('低分自动收录、错误次数累加、已掌握移出', async () => {
  freshDb()
  await initDatabase()
  const u = await repo.createUnit('Unit 1')
  const w = { ...word, unit_id: u.id }
  await repo.saveWord(w)
  const rec = (id: string, score: number) => ({
    id, word_id: w.id, mode: '2.2' as const, input_type: 'input' as const,
    raw_text: 'abendon', asr_text: '', score, detail_json: '{}', created_at: Date.now(),
  })
  await repo.addRecord(rec('r1', 30))
  let wrong = await repo.listWrongWords()
  assert.equal(wrong.length, 1)
  assert.equal(wrong[0].wrong_count, 1)
  await repo.addRecord(rec('r2', 20))
  assert.equal((await repo.listWrongWords())[0].wrong_count, 2)
  await repo.addRecord(rec('r3', DEFAULT_SETTINGS.wrongThreshold + 30))
  assert.equal((await repo.listWrongWords()).length, 1)   // 高分不重复收录，也不清除
  await repo.markMastered(w.id)
  assert.equal((await repo.listWrongWords()).length, 0)
})

/* ---------------- P5 导入导出 ---------------- */

test('导出 → 导入 round-trip；导出 JSON 不含任何凭据', async () => {
  freshDb()
  await initDatabase()
  const u = await repo.createUnit('Unit A')
  await repo.saveWord({ ...word, id: 'w_a', unit_id: u.id })
  const out = await exportLibrary()
  assert.equal(out.units, 1)
  assert.equal(out.words, 1)
  assert.equal(out.path, '')                              // Node 无 5+ 文件系统，走剪贴板路径
  assert.doesNotMatch(out.json, /apiKey|apiSecret|APPID|Bearer|authorization|password/i)
  const bundle = parseLibraryJson(out.json)
  assert.equal(bundle.version, 1)
  assert.equal(bundle.words[0].word, 'abandon')

  freshDb()                                              // 模拟换设备 / 清数据
  await initDatabase()
  const r = await importLibraryJson(out.json)
  assert.deepEqual(r, { units: 1, words: 1 })
  assert.equal((await repo.listUnits())[0].title, 'Unit A')
  assert.equal((await repo.listWords(u.id))[0].phonetic_us, '/əˈbændən/')

  assert.throws(() => parseLibraryJson('not json'), /不是合法/)
  assert.throws(() => parseLibraryJson('{"version":2,"units":[],"words":[]}'), /格式不正确/)
  assert.throws(() => parseLibraryJson('{"version":1,"units":[]}'), /格式不正确/)
})

/* ---------------- P4 内容正确度评价 ---------------- */

test('2.2 英文文本比对：正确 100、近似给部分分、无关 0', () => {
  assert.equal(localEvaluate(evalInput('abandon')).score, 100)
  assert.equal(localEvaluate(evalInput('  ABANDON. ')).score, 100)
  const near = localEvaluate(evalInput('abandonn')).score
  assert.ok(near > 0 && near < 100, `近似拼写应给部分分，实际 ${near}`)
  assert.equal(localEvaluate(evalInput('camera')).score, 0)
  assert.equal(localEvaluate(evalInput('')).score, 0)
  assert.equal(normalizeEn('Abandon, please!'), 'abandon please')
})

test('2.3 中文释义：全义和同义都算对，无关给 0', () => {
  assert.equal(localEvaluate(evalInput('放弃；抛弃', '2.3')).score, 100)
  assert.equal(meaningCoverage('放弃；抛弃', '放弃'), 0.5)
  assert.equal(localEvaluate(evalInput('照相机', '2.3')).score, 0)
})

test('评分严格度三档生效；结果不含发音维度文案', () => {
  const loose = localEvaluate(evalInput('abandonn', '2.2', 'loose')).score
  const strict = localEvaluate(evalInput('abandonn', '2.2', 'strict')).score
  assert.ok(loose >= strict)
  for (const s of ['loose', 'normal', 'strict'] as const) {
    const r = localEvaluate(evalInput('abandon', '2.2', s))
    assert.equal(r.semantic, false)
    assert.equal(r.highlights.length, 1)
    assert.equal(r.highlights[0].ok, true)
    assert.doesNotMatch(r.feedback, /发音|流利|准确度/)
  }
  const files = ['pages/practice/practice.vue', 'components/ScoreCard.vue', 'pages/result/result.vue']
  for (const f of files) {
    const src = fs.readFileSync(path.join(SRC, f), 'utf8')
    assert.doesNotMatch(src, /发音分|准确度|流利度/, `${f} 不应出现发音维度文案`)
  }
})

/* ---------------- P3 / P4 接口实测口径 ---------------- */

test('TTS：speed 以 50 为 1.0× 基准；音频帧按 seq 重排', () => {
  assert.equal(speedToXf(1), 50)
  assert.equal(speedToXf(0.5), 25)
  assert.equal(speedToXf(2), 100)
  assert.equal(speedToXf(9), 100)
  // 逐帧解码再合并：单帧带补位时直接拼 base64 会在第一个 `=` 处截断
  const merged = mergeFrames([
    { seq: 2, audio: 'Qw==' },
    { seq: 0, audio: 'QQ==' },
    { seq: 1, audio: 'Qg==' },
  ])
  assert.equal(Buffer.from(merged).toString('utf8'), 'ABC')
  // 带补位的中途帧也不能截断后面的帧
  const padded = mergeFrames([
    { seq: 0, audio: 'QQ==' },
    { seq: 1, audio: 'Qg==' },
  ])
  assert.equal(Buffer.from(padded).toString('utf8'), 'AB')
})

test('听写：分帧首帧带参数、末帧 status=2；单帧也标记结束', () => {
  const frames = buildIatFrames('A'.repeat(3000), 'en') as Array<{
    header: { status: number }
    parameter?: unknown
    payload: { audio: { status: number; seq: number; audio: string; encoding: string; sample_rate: number } }
  }>
  assert.equal(frames.length, 3)
  assert.ok(frames[0].parameter)
  assert.equal(frames[0].payload.audio.status, 0)
  assert.equal(frames[1].header.status, 1)
  assert.equal(frames[2].header.status, 2)
  assert.equal(frames[2].payload.audio.status, 2)
  assert.equal(frames[2].payload.audio.encoding, 'lame')
  assert.equal(frames[2].payload.audio.sample_rate, 16000)
  const single = buildIatFrames('AAA', 'zh') as Array<{ header: { status: number } }>
  assert.equal(single.length, 1)
  assert.equal(single[0].header.status, 2)
  const b64 = Buffer.from(JSON.stringify({
    ws: [{ cw: [{ w: 'hello' }] }, { cw: [{ w: ' world' }] }],
  })).toString('base64')
  assert.equal(decodeIatText(b64), 'hello world')
  assert.equal(decodeIatText(''), '')
})

test('2.1 播放片段：播放顺序 / 重复次数 / 提示语种', () => {
  const s = buildReadSegments(word, { playOrder: 'en-zh', repeatTimes: 2 })
  assert.equal(s.length, 4)
  assert.deepEqual(s.map((x) => x.lang), ['en', 'zh', 'en', 'zh'])
  assert.deepEqual(buildReadSegments(word, { playOrder: 'zh-en', repeatTimes: 1 }).map((x) => x.lang), ['zh', 'en'])
  assert.deepEqual(buildReadSegments(word, { playOrder: 'en-only', repeatTimes: 3 }).map((x) => x.lang), ['en', 'en', 'en'])
  assert.equal(buildPromptSegment(word, '2.2').lang, 'zh')
  assert.equal(buildPromptSegment(word, '2.3').lang, 'en')
})

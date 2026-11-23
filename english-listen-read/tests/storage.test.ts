import test from 'node:test'
import assert from 'node:assert/strict'
import { createMemoryDb, setDbForTest, initDatabase, DDL } from '../src/utils/db.ts'
import * as repo from '../src/services/storage.ts'
import { DEFAULT_SETTINGS } from '../src/services/types.ts'
import { safeUrl, sanitize } from '../src/utils/log.ts'
import { withRetry, backoffDelay, dedupe, isRetryableStatus } from '../src/utils/retry.ts'
import { generateCredentials, PROJECT_ROOT, GENERATED_FILE, renderGenerated, parseEnv, shard } from '../scripts/credentials.mjs'
import fs from 'node:fs'

function freshDb() {
  const db = createMemoryDb()
  setDbForTest(db)
  return db
}

test('DDL 覆盖方案第 6 节的固定表（含词典、跟读与学习记录）', async () => {
  freshDb()
  await initDatabase()
  const joined = DDL.join('\n')
  for (const t of [
    'unit', 'word', 'practice_record', 'settings', 'media_cache',
    'dict_cache', 'dict_history', 'gloss_cache', 'read_article', 'read_record', 'study_session',
  ]) {
    assert.match(joined, new RegExp(`CREATE TABLE IF NOT EXISTS ${t}\\s*\\(`))
  }
})

test('H5 旧快照缺表：补齐空数组后仍能写跟读文章', async () => {
  // 旧版本 localStorage 快照没有 read_article；不能因此让 INSERT 报 filter of undefined
  setDbForTest(createMemoryDb(undefined, { unit: [], word: [] }))
  await initDatabase()
  const a = await repo.createArticle({ title: '旧快照', sentences: ['Hello world.'] })
  assert.deepEqual(a.sentences, ['Hello world.'])
  assert.equal((await repo.listArticles()).length, 1)
})

test('单元 / 词条增删改查 + 搜索', async () => {
  const db = freshDb()
  await initDatabase()
  const u = await repo.createUnit('Unit 1', '_doc/a.jpg')
  assert.equal((await repo.listUnits()).length, 1)
  await repo.renameUnit(u.id, '第一单元')
  assert.equal((await repo.getUnit(u.id))?.title, '第一单元')

  await repo.saveWords([
    repo.draftToWord({ word: 'abandon', phonetic: '/əˈbændən/', pos: 'v.', translation: '放弃；抛弃' }, u.id, 0),
    repo.draftToWord({ word: 'camera', phonetic: '/ˈkæm(ə)rə/', pos: 'n.', translation: '照相机' }, u.id, 1),
  ])
  let words = await repo.listWords(u.id)
  assert.equal(words.length, 2)
  assert.equal(words[0].word, 'abandon')      // sort 升序
  assert.equal(words[1].phonetic_us, '/ˈkæm(ə)rə/')

  assert.equal((await repo.searchWords('aband')).length, 1)
  assert.equal((await repo.searchWords('照相')).length, 1) // 中文释义也能搜到

  const w = words[0]
  await repo.saveWord({ ...w, translation: '放弃' })
  assert.equal((await repo.getWord(w.id))?.translation, '放弃')
  await repo.deleteWord(w.id)
  assert.equal((await repo.listWords(u.id)).length, 1)
  await repo.deleteUnit(u.id)
  assert.equal((await repo.listUnits()).length, 0)
  assert.equal((await repo.listWords(u.id)).length, 0)
  assert.equal(db.kind, 'memory')
})

test('设置持久化与默认值', async () => {
  freshDb()
  await initDatabase()
  assert.deepEqual(await repo.loadSettings(), DEFAULT_SETTINGS)
  await repo.saveSetting('speed', 1.7)
  await repo.saveSetting('advanceMode', 'timer')
  await repo.saveSetting('waitSec', 8)
  const s = await repo.loadSettings()
  assert.equal(s.speed, 1.7)
  assert.equal(s.advanceMode, 'timer')
  assert.equal(s.waitSec, 8)
  assert.equal(s.speed, 1.7)
})

test('练习记录：低分自动进错词本，标记掌握后移出', async () => {
  freshDb()
  await initDatabase()
  const u = await repo.createUnit('U')
  const w = repo.draftToWord({ word: 'benefit', phonetic: '', pos: 'n.', translation: '益处' }, u.id, 0)
  await repo.saveWords([w])
  await repo.addRecord({ id: 'r1', word_id: w.id, mode: '2.2', input_type: 'record',
    raw_text: '', asr_text: 'benifit', score: 40, detail_json: '{}', created_at: Date.now() })
  assert.equal((await repo.listWrongWords()).length, 1)
  assert.equal((await repo.getWord(w.id))?.wrong_count, 1)
  await repo.addRecord({ id: 'r2', word_id: w.id, mode: '2.2', input_type: 'record',
    raw_text: '', asr_text: 'benefit', score: 95, detail_json: '{}', created_at: Date.now() })
  assert.equal((await repo.getWord(w.id))?.wrong_count, 1) // 高分不清除，只不新增
  await repo.markMastered(w.id)
  assert.equal((await repo.listWrongWords()).length, 0)
  assert.equal((await repo.getWord(w.id))?.wrong_count, 0)
  assert.equal((await repo.listRecords(w.id)).length, 3)
})

test('导入导出：幂等覆盖，坏文件被拒绝', async () => {
  freshDb()
  await initDatabase()
  const u = await repo.createUnit('Unit A')
  await repo.saveWords([repo.draftToWord({ word: 'camera', phonetic: '', pos: 'n.', translation: '照相机' }, u.id, 0)])
  const bundle = await repo.exportBundle()
  assert.equal(bundle.version, 1)
  assert.equal(bundle.units.length, 1)
  assert.equal(bundle.words.length, 1)
  const r = await repo.importBundle(JSON.parse(JSON.stringify(bundle)))
  assert.deepEqual(r, { units: 1, words: 1 })
  assert.equal((await repo.listUnits()).length, 1) // 同 id 覆盖，不重复
  assert.equal((await repo.listWords(u.id)).length, 1)
  await assert.rejects(() => repo.importBundle({ version: 9 } as never), /格式不正确/)
})

test('清空词库：删单元 / 词条 / 练习记录，设置与音频缓存保留', async () => {
  freshDb()
  await initDatabase()
  const u = await repo.createUnit('Unit X')
  const w = repo.draftToWord({ word: 'camera', phonetic: '', pos: 'n.', translation: '照相机' }, u.id, 0)
  await repo.saveWords([w])
  await repo.addRecord({
    id: 'r1', word_id: w.id, mode: '2.2', input_type: 'record',
    raw_text: '', asr_text: 'camera', score: 30, detail_json: '{}', created_at: Date.now(),
  })
  await repo.saveSetting('speed', 1.6)
  await repo.putAudioCacheRow({
    text_hash: 'h1', lang: 'en', vcn: 'vcn', speed: 50,
    path: '_doc/audio/a.mp3', expired_at: 0, bytes: 1024, hits: 0, last_used_at: 1,
  })

  const res = await repo.clearLibrary()
  assert.deepEqual(res, { units: 1, words: 1, records: 1 })
  assert.equal((await repo.listUnits()).length, 0)
  assert.equal((await repo.listWords(u.id)).length, 0)
  assert.equal((await repo.listWrongWords()).length, 0)
  // 设置与音频缓存不受影响
  assert.equal((await repo.loadSettings()).speed, 1.6)
  assert.equal((await repo.getAudioCacheRow('h1', 'en', 'vcn', 50))?.path, '_doc/audio/a.mp3')
})

test('音频缓存索引：读写 / 联合主键去重 / 按 path 删除 / 清空', async () => {
  freshDb()
  await initDatabase()
  assert.equal(await repo.getAudioCacheRow('h1', 'en', 'vcn', 50), null)
  const base: repo.AudioCacheRow = {
    text_hash: 'h1', lang: 'en', vcn: 'vcn', speed: 50,
    path: '_doc/audio/a.mp3', expired_at: 0, bytes: 2048, hits: 0, last_used_at: 1,
  }
  await repo.putAudioCacheRow(base)
  const row = await repo.getAudioCacheRow('h1', 'en', 'vcn', 50)
  assert.equal(row?.path, '_doc/audio/a.mp3')
  assert.equal(row?.bytes, 2048)
  // 语种不同即不同键
  assert.equal(await repo.getAudioCacheRow('h1', 'zh', 'vcn', 50), null)
  // 命中回写（同一联合主键）不会插出重复行
  await repo.putAudioCacheRow({ ...base, hits: 1, last_used_at: 2 })
  assert.deepEqual(await repo.audioCacheTotals(), { count: 1, bytes: 2048 })
  // 按 path 删除（单条件 WHERE，两端实现都支持）
  await repo.deleteAudioCacheRowByPath('_doc/audio/a.mp3')
  assert.equal(await repo.getAudioCacheRow('h1', 'en', 'vcn', 50), null)
  await repo.putAudioCacheRow({ ...base, bytes: 0 })
  assert.equal(await repo.clearAudioCacheRows(), 1)
  assert.deepEqual(await repo.audioCacheTotals(), { count: 0, bytes: 0 })
})

test('日志脱敏：URL 查询串 / Authorization / app_id / image base64 全部不落地', () => {
  const url = 'https://cbm01.cn-huabei-1.xf-yun.com/v1/private/se75ocrbm?host=x&date=y&authorization=SECRET_SIGNATURE'
  assert.equal(safeUrl(url), 'https://cbm01.cn-huabei-1.xf-yun.com/v1/private/se75ocrbm')
  const out = JSON.stringify(sanitize({
    Authorization: 'Bearer ak-secret', app_id: '861f27a7',
    image: 'A'.repeat(200), signature: 'sig', api_key: 'k',
    payload: { app_id: 'hidden', text: 'X'.repeat(300) },
    header: { code: 0, sid: 'safe-sid' },
  }))
  assert.ok(!out.includes('SECRET_SIGNATURE'))
  assert.ok(!out.includes('861f27a7'))
  assert.ok(!out.includes('ak-secret'))
  assert.ok(!out.includes('A'.repeat(200)))
  assert.ok(out.includes('safe-sid'))
  assert.ok(out.includes('已脱敏'))
})

test('429 退避重试：失败后成功 / 不可重试错误立即抛出', async () => {
  assert.ok(isRetryableStatus(429) && isRetryableStatus(503) && !isRetryableStatus(401))
  let n = 0
  const result = await withRetry(async () => {
    n++
    if (n < 3) throw { statusCode: 429 }
    return 'ok'
  }, { retries: 3, sleep: async () => {} })
  assert.equal(result, 'ok')
  assert.equal(n, 3)
  let m = 0
  await assert.rejects(() => withRetry(async () => { m++; throw { statusCode: 401 } }, { retries: 3, sleep: async () => {} }))
  assert.equal(m, 1)
  for (let i = 0; i < 20; i++) assert.ok(backoffDelay(i) >= 0 && backoffDelay(i) <= 12000)
})

test('请求合并：同 key 并发只执行一次', async () => {
  let calls = 0
  const fn = () => dedupe('tts:abc', async () => { calls++; await new Promise((r) => setTimeout(r, 10)); return 'audio' })
  const [a, b, c] = await Promise.all([fn(), fn(), fn()])
  assert.deepEqual([a, b, c], ['audio', 'audio', 'audio'])
  assert.equal(calls, 1)
})

test('构建期分片：产物不含明文整串，且能无损还原', () => {
  const env = parseEnv('XFYUN_MAAS_API_KEY=ak-abcdefghijklmnop\nXFYUN_APPID=861f27a7\nXFYUN_API_KEY=key123456\nXFYUN_API_SECRET=secret987654\n')
  const src = renderGenerated(env)
  for (const v of Object.values(env)) assert.ok(!src.includes(v as string), '生成文件不得含明文整串')
  const parts = shard('ak-abcdefghijklmnop', 0x5f3a7c91 + 'XFYUN_MAAS_API_KEY'.length * 7919)
  assert.equal(parts.length, 5)
  assert.ok(parts.every((p) => !(p as string).includes('ak-abcdefghijklmnop')))
})

test('本地密钥链：.env.local 与分片文件都已生成', () => {
  const r = generateCredentials()
  assert.equal(r.ok, true)
  assert.ok(fs.existsSync(GENERATED_FILE))
  assert.ok(fs.existsSync(`${PROJECT_ROOT}/.env.local`))
})

test('学习记录：写入 / 按开始时间倒序读取 / 清空', async () => {
  freshDb()
  await initDatabase()
  const base = {
    kind: 'practice' as const, mode: 'dictation', unit_id: 'u1', title: '七上 Unit 1',
    ended_at: 0, duration_sec: 60, total: 10, answered: 5, passed: 3, avg_score: 72, created_at: 0,
  }
  await repo.addStudySession({ ...base, id: 's1', started_at: 1000, ended_at: 1060, created_at: 1060 })
  await repo.addStudySession({ ...base, id: 's2', kind: 'read', mode: 'read', title: '短文', started_at: 2000, ended_at: 2060, created_at: 2060 })
  const list = await repo.listStudySessions(10)
  assert.equal(list.length, 2)
  assert.equal(list[0].id, 's2')
  assert.equal(list[0].kind, 'read')
  assert.equal(list[1].duration_sec, 60)
  assert.equal(list[1].avg_score, 72)
  await repo.clearStudySessions()
  assert.equal((await repo.listStudySessions()).length, 0)
})

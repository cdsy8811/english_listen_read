import test from 'node:test'
import assert from 'node:assert/strict'
import { createMemoryDb, setDbForTest, initDatabase } from '../src/utils/db.ts'
import * as repo from '../src/services/storage.ts'
import {
  CACHE_LIMIT_BYTES,
  cacheKey,
  cacheStats,
  clearAudioCache,
  evictIfNeeded,
  formatBytes,
  lookupAudio,
  normText,
  pickEvictions,
  resetCacheCounters,
  storeAudio,
  sweepOrphanAudio,
} from '../src/services/tts-cache.ts'

function freshDb() {
  setDbForTest(createMemoryDb())
  resetCacheCounters()
}

const meta = { text: 'Hello world.', lang: 'en' as const, vcn: 'vcn_en', speed: 50 }

function rowAt(over: Partial<repo.AudioCacheRow> = {}): repo.AudioCacheRow {
  return {
    text_hash: cacheKey(meta), lang: 'en', vcn: 'vcn_en', speed: 50,
    path: '_doc/audio/abc.mp3', expired_at: 0, bytes: 2048, hits: 0, last_used_at: 1,
    ...over,
  }
}

const existsWith = (bytes: number) => async () => ({ exists: true, bytes })

test('归一化：只折叠空白，标点原样保留', () => {
  assert.equal(normText('  Hello\tworld.\n'), 'Hello world.')
  assert.equal(normText('a\u3000b'), 'a b')
  assert.equal(normText('Hi,  there!'), 'Hi, there!')
  // 标点影响停顿和语调，不能删
  assert.equal(normText('Hello, world.'), 'Hello, world.')
  assert.equal(normText(''), '')
})

test('缓存键：空白差异归一到同一键，语种 / 发音人 / 语速各自成键', () => {
  const base = cacheKey(meta)
  assert.equal(base, cacheKey({ ...meta, text: ' Hello   world. ' }))
  assert.equal(base, cacheKey({ ...meta, text: 'Hello\tworld.' }))
  assert.equal(base.length, 20)
  assert.notEqual(base, cacheKey({ ...meta, lang: 'zh' }))
  assert.notEqual(base, cacheKey({ ...meta, vcn: 'x5_lingxiaoxuan_flow' }))
  assert.notEqual(base, cacheKey({ ...meta, speed: 45 }))
})

test('容量格式化', () => {
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(2048), '2.0 KB')
  assert.equal(formatBytes(3 * 1024 * 1024), '3.0 MB')
})

test('LRU 淘汰：未超上限不动，超了按最久未播放删到 80%', () => {
  const rows = [
    { path: 'c', bytes: 100, last_used_at: 30 },
    { path: 'a', bytes: 100, last_used_at: 10 },
    { path: 'b', bytes: 100, last_used_at: 20 },
  ]
  assert.deepEqual(pickEvictions(rows, 250, 300), [])
  // 500 > 300，目标 240：删最老的 3 条后剩 200
  assert.deepEqual(pickEvictions(rows, 500, 300).map((r) => r.path), ['a', 'b', 'c'])
  assert.deepEqual(pickEvictions(rows, 400, 300).map((r) => r.path), ['a', 'b'])
  // 老库行 bytes 为 0 不会把淘汰卡死
  const legacy = [
    { path: 'old', bytes: 0, last_used_at: 1 },
    { path: 'big', bytes: 500, last_used_at: 2 },
  ]
  assert.equal(pickEvictions(legacy, 500, 300).length, 2)
})

test('查缓存：命中返回路径；文件丢了 / 0 字节删索引；老库过期行复活', async () => {
  freshDb()
  await initDatabase()

  // 没有索引 → 未命中
  assert.equal(await lookupAudio(meta, { probe: existsWith(1024) }), null)
  assert.equal((await cacheStats()).miss, 1)

  // 正常命中
  await repo.putAudioCacheRow(rowAt())
  assert.equal(await lookupAudio(meta, { probe: existsWith(2048) }), '_doc/audio/abc.mp3')
  const stats = await cacheStats()
  assert.equal(stats.hit, 1)
  assert.equal(stats.count, 1)

  // 文件不在了：自愈删索引
  const gone = { ...meta, text: 'Gone.' }
  await repo.putAudioCacheRow(rowAt({ text_hash: cacheKey(gone), path: '_doc/audio/gone.mp3' }))
  assert.equal(await lookupAudio(gone, { probe: async () => ({ exists: false, bytes: 0 }) }), null)
  assert.equal(await repo.getAudioCacheRow(cacheKey(gone), 'en', 'vcn_en', 50), null)

  // 文件在但 0 字节（写一半崩了）同样算未命中
  const zero = { ...meta, text: 'Zero.' }
  await repo.putAudioCacheRow(rowAt({ text_hash: cacheKey(zero), path: '_doc/audio/zero.mp3', bytes: 0 }))
  assert.equal(await lookupAudio(zero, { probe: existsWith(0) }), null)
  assert.equal(await repo.getAudioCacheRow(cacheKey(zero), 'en', 'vcn_en', 50), null)

  // 老库 30 天 TTL 到期但文件还在：复活成本地永久缓存，不重新合成
  const legacy = { ...meta, text: 'Legacy.' }
  await repo.putAudioCacheRow(rowAt({
    text_hash: cacheKey(legacy), path: '_doc/audio/legacy.mp3', expired_at: Date.now() - 1000,
  }))
  assert.equal(await lookupAudio(legacy, { probe: existsWith(2048) }), '_doc/audio/legacy.mp3')
  await new Promise((r) => setTimeout(r, 20))
  assert.equal((await repo.getAudioCacheRow(cacheKey(legacy), 'en', 'vcn_en', 50))?.expired_at, 0)

  const left = await repo.listAudioCacheRows()
  assert.deepEqual(left.map((r) => r.path).sort(), ['_doc/audio/abc.mp3', '_doc/audio/legacy.mp3'])
})

test('命中回写：hits / last_used_at 更新，老库 TTL 清零且不插重复行', async () => {
  freshDb()
  await initDatabase()
  await repo.putAudioCacheRow(rowAt({ expired_at: Date.now() + 86400000, bytes: 0 }))

  assert.equal(await lookupAudio(meta, { probe: existsWith(4096) }), '_doc/audio/abc.mp3')
  await new Promise((r) => setTimeout(r, 20))

  const rows = await repo.listAudioCacheRows()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].hits, 1)
  assert.equal(rows[0].expired_at, 0)
  assert.equal(rows[0].bytes, 4096)
  assert.ok(rows[0].last_used_at > 1)
})

test('合成落盘：写索引（不过期 / 记字节数），随后能命中', async () => {
  freshDb()
  await initDatabase()
  const bytes = new Uint8Array(1500)
  const path = await storeAudio(meta, bytes, { save: async (_b, hash) => `_doc/audio/${hash}.mp3` })
  assert.match(path, /^_doc\/audio\/[0-9a-f]{20}\.mp3$/)

  const row = await repo.getAudioCacheRow(cacheKey(meta), 'en', 'vcn_en', 50)
  assert.equal(row?.path, path)
  assert.equal(row?.bytes, 1500)
  assert.equal(row?.expired_at, 0)
  assert.equal(await lookupAudio(meta, { probe: existsWith(1500) }), path)
})

test('清理缓存：删索引并逐条删文件', async () => {
  freshDb()
  await initDatabase()
  const removed: string[] = []
  for (const t of ['A.', 'B.']) {
    await repo.putAudioCacheRow(rowAt({
      text_hash: cacheKey({ ...meta, text: t }), path: `_doc/audio/${t.replace('.', '')}.mp3`,
    }))
  }
  assert.equal(await repo.audioCacheTotals().then((x) => x.count), 2)
  const n = await clearAudioCache({ remove: async (p) => { removed.push(p) } })
  assert.equal(n, 2)
  assert.deepEqual(removed.sort(), ['_doc/audio/A.mp3', '_doc/audio/B.mp3'])
  assert.deepEqual(await repo.audioCacheTotals(), { count: 0, bytes: 0 })
})

test('未超上限不淘汰', async () => {
  freshDb()
  await initDatabase()
  await repo.putAudioCacheRow(rowAt())
  assert.equal(await evictIfNeeded({}, true), 0)
  assert.equal((await cacheStats()).limit, CACHE_LIMIT_BYTES)
})

test('孤儿清扫：只删没有索引的 mp3，且每次启动只跑一次', async () => {
  freshDb()
  await initDatabase()
  await repo.putAudioCacheRow(rowAt({ path: '_doc/audio/keep.mp3' }))
  const removed: string[] = []
  const n = await sweepOrphanAudio({
    list: async () => [
      { name: 'keep.mp3', url: '_doc/audio/keep.mp3' },
      { name: 'orphan.mp3', url: '_doc/audio/orphan.mp3' },
    ],
    remove: async (p) => { removed.push(p) },
  })
  assert.equal(n, 1)
  assert.deepEqual(removed, ['_doc/audio/orphan.mp3'])
  // 已经扫过，不再重复跑
  assert.equal(await sweepOrphanAudio({ list: async () => [{ name: 'x.mp3', url: 'x' }] }), 0)
})

/** 随机模式：词条打乱工具（练习页 2.2 / 2.3 加载时使用）。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { shuffle } from '../src/utils/random.ts'

test('shuffle：长度与元素不变、不改原数组、单元素/空数组安全', () => {
  const src = Array.from({ length: 64 }, (_, i) => i)
  const out = shuffle(src)
  assert.deepEqual(src, Array.from({ length: 64 }, (_, i) => i), '原数组不能被修改')
  assert.equal(out.length, src.length)
  assert.deepEqual([...out].sort((a, b) => a - b), src, '元素集合必须一致')
  assert.deepEqual(shuffle([]), [])
  assert.deepEqual(shuffle(['only']), ['only'])
})

test('shuffle：64 个元素至少有一种非原序结果（避免「随机模式其实没打乱」）', () => {
  const src = Array.from({ length: 64 }, (_, i) => i)
  const same = Array.from({ length: 5 }, () => shuffle(src)).filter((x) => x.every((v, i) => v === src[i]))
  assert.ok(same.length < 5, '连续 5 次都和原序一致，说明打乱没有生效')
})

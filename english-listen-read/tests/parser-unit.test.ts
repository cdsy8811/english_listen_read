/** 文本导入：整本书文本按单元切段（AI 分单元入库的前置步骤）。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { cleanUnitTitle, isUnitHeading, splitUnitSections } from '../src/services/parser.ts'

test('单元标题识别：Unit / Starter Unit / 第 N 单元 / 七上 Unit 1 都算，词条行不算', () => {
  for (const line of ['Unit 3', '## Unit 3 词汇', 'Starter Unit 1', '第 2 单元', '七上 Unit 1']) {
    assert.equal(isUnitHeading(line), true, line)
  }
  for (const line of ['1. unit n. 单元', 'abandon /əˈbændən/ v. 放弃', '']) {
    assert.equal(isUnitHeading(line), false, line)
  }
  assert.equal(cleanUnitTitle('## Unit 3：'), 'Unit 3')
})

test('splitUnitSections：按标题切段，标题行不进正文', () => {
  const text = [
    'Unit 1',
    'abandon v. 放弃',
    'ability n. 能力',
    '',
    '## Unit 2',
    'banana n. 香蕉',
  ].join('\n')
  const sections = splitUnitSections(text)
  assert.equal(sections.length, 2)
  assert.equal(sections[0].title, 'Unit 1')
  assert.ok(sections[0].text.includes('abandon'))
  assert.ok(!sections[0].text.includes('Unit 1'))
  assert.equal(sections[1].title, 'Unit 2')
  assert.equal(sections[1].text, 'banana n. 香蕉')
})

test('splitUnitSections：没有标题时整体一段；空文本返回空', () => {
  const one = splitUnitSections('apple n. 苹果\nbanana n. 香蕉')
  assert.equal(one.length, 1)
  assert.equal(one[0].title, '')
  assert.ok(one[0].text.includes('banana'))
  assert.deepEqual(splitUnitSections('   \n\n'), [])
})

test('splitUnitSections：单段过长按行再切，多段共用标题（仍写进同一个单元）且不丢行', () => {
  const body = Array.from({ length: 40 }, (_, i) => `word${i} n. 释义${i}`).join('\n')
  const sections = splitUnitSections(`Unit 9\n${body}`, 120)
  assert.ok(sections.length > 1, '应当被切成多段')
  for (const s of sections) {
    assert.equal(s.title, 'Unit 9')
    assert.ok(s.text.length <= 120 + 40, '每段不应超过上限太多')
  }
  const lines = sections.map((s) => s.text).join('\n').split('\n')
  assert.equal(lines.length, 40, '切段不能丢行')
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { absolutePath, ioChildPath } from '../src/utils/plus-io.ts'

test('写文件路径：dir 前缀只保留一层（否则 getFile 建空占位文件，首次播放 MediaError）', () => {
  // 调用方把目录写进 relativePath 时，交给 getFile 的只能是文件名
  assert.equal(ioChildPath('audio', 'audio/abc123.mp3'), 'abc123.mp3')
  assert.equal(ioChildPath('backups', 'backups/elr-1.json'), 'elr-1.json')
  // 已经只传文件名时原样返回
  assert.equal(ioChildPath('audio', 'abc123.mp3'), 'abc123.mp3')
  // 没有 dir 时不改路径
  assert.equal(ioChildPath('', 'audio/abc123.mp3'), 'audio/abc123.mp3')
})

test('absolutePath：非 App 端原样返回，不破坏 H5 的 blob / 相对路径', () => {
  assert.equal(absolutePath('_doc/audio/abc123.mp3'), '_doc/audio/abc123.mp3')
  assert.equal(absolutePath('blob:http://localhost/abc'), 'blob:http://localhost/abc')
  assert.equal(absolutePath(''), '')
})

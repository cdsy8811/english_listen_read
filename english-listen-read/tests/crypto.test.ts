import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import {
  base64Encode, base64Decode, utf8Encode, utf8Decode, sha256, hmacSha256,
  base64ToUtf8, utf8ToBase64, quotePlus,
} from '../src/utils/crypto.ts'

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex')

test('SHA-256 与 Node crypto 对拍（含中文、长文本、空串）', () => {
  for (const s of ['', 'abc', 'hello world', '英语听读 /əˈbændən/', 'x'.repeat(1000)]) {
    assert.equal(hex(sha256(utf8Encode(s))), createHash('sha256').update(s, 'utf8').digest('hex'), `输入长度 ${s.length}`)
  }
})

test('HMAC-SHA256 与 Node crypto 对拍（长密钥走 sha256 压缩分支）', () => {
  const keys = ['k', 'api_secret', 'x'.repeat(100)]
  const msgs = ['', 'host: a\ndate: b\nPOST /v1 HTTP/1.1', '讯飞签名原文 /əˈbændən/']
  for (const k of keys) for (const m of msgs) {
    assert.equal(
      hex(hmacSha256(utf8Encode(k), utf8Encode(m))),
      createHmac('sha256', k).update(m, 'utf8').digest('hex'),
    )
  }
})

test('UTF-8 / Base64 往返（含中文、emoji、IPA 音标、二进制）', () => {
  for (const s of ['', 'camera', '照相机', '/ˈkæm(ə)rə/', '😀 emoji 𠜎']) {
    assert.equal(utf8Decode(utf8Encode(s)), s)
    assert.equal(base64ToUtf8(utf8ToBase64(s)), s)
  }
  const bytes = new Uint8Array(256)
  for (let i = 0; i < 256; i++) bytes[i] = i
  assert.deepEqual(Array.from(base64Decode(base64Encode(bytes))), Array.from(bytes))
})

test('quotePlus 与 Python urllib.parse.quote_plus 等价（空格→+，特殊字符转义）', () => {
  assert.equal(quotePlus('Thu, 17 Sep 2026 01:38:38 GMT'), 'Thu%2C+17+Sep+2026+01%3A38%3A38+GMT')
  assert.equal(quotePlus('a+b/c=d'), 'a%2Bb%2Fc%3Dd')
  assert.equal(quotePlus("!~*'()"), '%21~%2A%27%28%29')
  assert.equal(quotePlus('cbm01.cn-huabei-1.xf-yun.com'), 'cbm01.cn-huabei-1.xf-yun.com')
})

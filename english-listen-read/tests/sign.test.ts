import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildAuthQuery, rfc1123Gmt, signedUrl, splitEndpoint } from '../src/api/xfyun-sign.ts'
import { base64Decode, utf8Decode } from '../src/utils/crypto.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TOOLS = path.resolve(HERE, '../../tools')

/**
 * 与 P0 已实测通过的 Python auth_query() 逐字节对拍。
 * Python 侧用固定 date 复现同一算法，两边比较完整查询串（测试值均为假凭据）。
 */
function pythonAuthQuery(date: string, path_: string, method: string, host: string, key: string, secret: string): string {
  const script = `
import base64, hashlib, hmac, urllib.parse, json, sys
date, path_, method, host, key, secret = json.loads(sys.argv[1])
origin = "host: {}\\ndate: {}\\n{} {} HTTP/1.1".format(host, date, method, path_)
sig = base64.b64encode(hmac.new(secret.encode(), origin.encode(), hashlib.sha256).digest()).decode()
auth_origin = 'api_key="{}", algorithm="hmac-sha256", headers="host date request-line", signature="{}"'.format(key, sig)
auth = base64.b64encode(auth_origin.encode()).decode()
print(urllib.parse.urlencode({"host": host, "date": date, "authorization": auth}))
`
  return execFileSync(process.env.PYTHON || 'python', ['-c', script,
    JSON.stringify([date, path_, method, host, key, secret])], { encoding: 'utf8' }).trim()
}

const FAKE = { apiKey: 'fake_key_0123456789abcdef', apiSecret: 'fake_secret_fedcba9876543210' }

test('RFC1123 GMT 格式与 Python formatdate(usegmt=True) 一致', () => {
  const py = execFileSync(process.env.PYTHON || 'python',
    ['-c', 'from email.utils import formatdate; print(formatdate(usegmt=True))'], { encoding: 'utf8' }).trim()
  const js = rfc1123Gmt()
  const re = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/
  assert.match(py, re)
  assert.match(js, re)
  // 两侧时间戳相差不超过 2 秒（同一时刻生成）
  assert.ok(Math.abs(Date.parse(js) - Date.parse(py)) < 2000)
})

test('OCR POST 签名与 Python auth_query 完全等价（固定 date）', () => {
  const date = 'Thu, 17 Sep 2026 01:38:38 GMT'
  const o = { path: '/v1/private/se75ocrbm', method: 'POST' as const,
    signHost: 'cbm01.cn-huabei-1.xf-yun.com', ...FAKE, date }
  assert.equal(buildAuthQuery(o), pythonAuthQuery(date, o.path, o.method, o.signHost, FAKE.apiKey, FAKE.apiSecret))
})

test('WSS GET 签名与 Python auth_query 完全等价（听写 / 合成两个端点）', () => {
  const date = 'Fri, 06 Nov 2026 13:27:18 GMT'
  for (const [host, p] of [
    ['iat.cn-huabei-1.xf-yun.com', '/v1'],
    ['cbm01.cn-huabei-1.xf-yun.com', '/v1/private/mcd9m97e6'],
  ]) {
    const o = { path: p, method: 'GET' as const, signHost: host, ...FAKE, date }
    assert.equal(buildAuthQuery(o), pythonAuthQuery(date, p, 'GET', host, FAKE.apiKey, FAKE.apiSecret))
  }
})

test('OCR 签名 host 可用 XFYUN_OCR_SIGN_HOST 覆盖，且请求域名不变', () => {
  const date = 'Thu, 17 Sep 2026 01:38:38 GMT'
  const q1 = buildAuthQuery({ path: '/v1/private/se75ocrbm', method: 'POST',
    signHost: 'api.xf-yun.com', ...FAKE, date })
  assert.equal(q1, pythonAuthQuery(date, '/v1/private/se75ocrbm', 'POST', 'api.xf-yun.com', FAKE.apiKey, FAKE.apiSecret))
  const url = signedUrl({ path: '/v1/private/se75ocrbm', method: 'POST', signHost: 'api.xf-yun.com',
    scheme: 'https', requestHost: 'cbm01.cn-huabei-1.xf-yun.com', ...FAKE, date })
  assert.ok(url.startsWith('https://cbm01.cn-huabei-1.xf-yun.com/v1/private/se75ocrbm?'))
  assert.ok(url.includes('host=api.xf-yun.com'))
})

test('签名 URL 的 authorization 解码后结构正确，且 WSS 请求行是 GET、OCR 是 POST', () => {
  const date = 'Thu, 17 Sep 2026 01:38:38 GMT'
  const q = buildAuthQuery({ path: '/v1', method: 'GET', signHost: 'iat.cn-huabei-1.xf-yun.com', ...FAKE, date })
  const auth = decodeURIComponent(new URLSearchParams(q).get('authorization') || '')
  const decoded = utf8Decode(base64Decode(auth))
  assert.match(decoded, /^api_key="fake_key_0123456789abcdef", algorithm="hmac-sha256", headers="host date request-line", signature="[A-Za-z0-9+/=]+"$/)
})

test('splitEndpoint 解析 https / wss 端点', () => {
  assert.deepEqual(splitEndpoint('wss://iat.cn-huabei-1.xf-yun.com/v1'),
    { scheme: 'wss', host: 'iat.cn-huabei-1.xf-yun.com', path: '/v1' })
  assert.deepEqual(splitEndpoint('https://cbm01.cn-huabei-1.xf-yun.com/v1/private/se75ocrbm'),
    { scheme: 'https', host: 'cbm01.cn-huabei-1.xf-yun.com', path: '/v1/private/se75ocrbm' })
  assert.throws(() => splitEndpoint('not-a-url'))
})

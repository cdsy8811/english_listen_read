# App API v1

Base URL：`https://your-domain.example/api/v1`

所有响应统一为：

```json
{
  "code": 200,
  "msg": "ok",
  "data": {},
  "timestamp": 1795397000
}
```

- `code=200` 成功；`2000` 未登录；`2003` 权限不足；`2004` 账号禁用；
  `3000` 参数错误；`3004` 资源不存在；`4029` AI 配额用尽；`1000` 服务端错误。
- 需要登录的接口使用 `Authorization: Bearer <token>`。
- 时间字段统一毫秒时间戳（`*_ms` 或 `created_at/started_at` 等）。
- 图片/音频上限：图片 4MB（base64 后 ≤4M），音频 60 秒 / 4MB。

## 1. 元信息

```http
GET /meta
```

```json
{"name":"橙子英语","protocol_version":1,"server_time_ms":1795397000000}
```

## 2. 认证

### 登录

```http
POST /auth/login
Content-Type: application/json

{
  "username": "demo",
  "password": "demo123456",
  "device_id": "android-imei-or-uuid",
  "device_name": "Pixel 8",
  "platform": "android",
  "app_version": "1.0.0"
}
```

```json
{
  "access_token": "1|...",
  "token_type": "Bearer",
  "user": {"id": 1, "uuid": "au_...", "username": "demo", "nickname": "演示账号", "status": 1},
  "sync": {"protocol_version": 1, "cursor": 40}
}
```

同一 `device_id` 再次登录会吊销旧 token。

### 当前用户

```http
GET /auth/me
```

返回用户、同步游标与数据量统计。

### 退出

```http
POST /auth/logout
```

## 3. 增量同步

### 拉取

```http
GET /sync/pull?cursor=0&limit=500
```

```json
{
  "changes": [
    {
      "entity": "unit",
      "op": "upsert",
      "id": "u_abc",
      "seq": 41,
      "updated_at_ms": 1795397000000,
      "data": {"title": "Unit 1", "source_img": "", "created_at": 1795397000000}
    }
  ],
  "next_cursor": 41,
  "has_more": false,
  "server_time_ms": 1795397000100
}
```

- `seq` 单调查询游标；下次请求把 `next_cursor` 原样带回。
- `has_more=true` 时立即用新游标继续拉，直到 `false`。
- `op=delete` 时 `data` 为空，客户端删除本地对应 id。
- 首次登录 / 换设备用 `cursor=0` 全量拉取。

### 推送

```http
POST /sync/push
Content-Type: application/json

{
  "changes": [
    {
      "entity": "unit",
      "op": "upsert",
      "id": "u_abc",
      "client_updated_at_ms": 1795397000000,
      "data": {"title": "Unit 1", "source_img": "", "created_at": 1795397000000}
    }
  ]
}
```

```json
{
  "results": [
    {"entity": "unit", "id": "u_abc", "op": "upsert", "status": "applied", "seq": 42}
  ],
  "next_cursor": 42,
  "server_time_ms": 1795397000100
}
```

- 单次最多 500 条。
- `status`：`applied` 已写入；`stale` 服务端版本更新（客户端应 pull）；
  `invalid` 参数/时间不合法。
- 冲突策略：`client_updated_at_ms` 大者胜；相同则服务端胜；超前服务器 24h 判 `invalid`。
- id 使用 App 本地 id，服务端按 `(app_user_id, id)` 幂等。

### 实体与 data 字段

| entity | 必填 | data |
|---|---|---|
| `unit` | `title` | `title, source_img, created_at(ms)` |
| `word` | `unit_id, word` | `unit_id, word, phonetic_uk, phonetic_us, pos, translation, example, audio_path, sort, wrong, wrong_count` |
| `practice_record` | `word_id, mode` | `word_id, mode, input_type, raw_text, asr_text, score, detail_json(string), created_at(ms)` |
| `read_article` | `title` | `title, source_img, sentences(string[]), translations(string[]), created_at(ms)` |
| `read_record` | `article_id` | `article_id, sentence_index, asr_text, score, detail_json(string), created_at(ms)` |
| `study_session` | `kind` | `kind, mode, unit_id, title, started_at(ms), ended_at(ms), duration_sec, total, answered, passed, avg_score, created_at(ms)` |
| `setting` | `payload(object)` | `payload`（整包设置，LWW） |

### 状态

```http
GET /sync/status
```

返回当前游标与各实体数量，用于「我的」页展示。

## 4. AI 接口

所有 AI 接口都需要登录，默认每 IP 每分钟 60 次；每用户每日配额由后台
「系统配置 → ai_daily_quota」控制，超限返回 HTTP 429 + `retry_after`。

### 拍照 OCR

```http
POST /ai/ocr
Content-Type: multipart/form-data

image=<jpg/png/webp>
```

```json
{"markdown": "..."}
```

服务端完成 base64 / gzip 解码，只返回 `document[].value`。

### 词条抽取

```http
POST /ai/extract
{"markdown": "..."}
```

```json
{"words":[{"word":"apple","phonetic":"/ˈæpl/","pos":"n.","translation":"苹果","example":""}]}
```

### 内容正确度判分

```http
POST /ai/evaluate
{
  "mode": "2.2",
  "word": {"word": "apple", "translation": "苹果"},
  "answer": "apple",
  "asr_text": "apple",
  "input_type": "input",
  "strictness": "normal"
}
```

```json
{
  "score": 100,
  "highlights": [{"text":"apple","ok":true}],
  "expected": "apple",
  "answer": "apple",
  "asrText": "apple",
  "feedback": "答对了",
  "semantic": false
}
```

只评内容正确度，不含发音分。同音词（two/to）与只差词间空格按正确计。

### 词典 / 点词速览

```http
POST /ai/dict   {"query":"apple"}
POST /ai/gloss  {"words":["apple","orange"]}
```

### 语音合成

```http
POST /ai/tts
{"text":"apple","lang":"en","speed":1.0}
```

返回 `audio/mpeg` 二进制；响应头 `X-Cache: HIT|MISS`、`ETag`。
客户端可用 `If-None-Match` 命中 304。服务端按 `text|lang|vcn|speed` 缓存。

### 语音听写

```http
POST /ai/asr
Content-Type: multipart/form-data

audio=<16k 单声道 mp3>
lang=en
```

```json
{"text": "apple"}
```

### 跟读

```http
POST /ai/passage-translate  {"sentences":["The sun rises."]}
→ {"translations":["太阳升起来了。"]}

POST /ai/passage-evaluate   {"expected":"The sun rises.","asr_text":"The sun rises"}
→ PassageEval（score / words / extra / hit / total / feedback / semantic）
```

## 5. 错误与排错

| 场景 | HTTP | code |
|---|---|---|
| 未登录 / token 失效 | 401 | 2000 |
| 账号禁用 | 403 | 2004 |
| 后台权限不足 | 403 | 2003 |
| 参数校验失败 | 422 | 3000 |
| AI 配额用尽 | 429 | 4029 |
| 讯飞调用失败 | 500 | 1000，`msg` 带讯飞 code |

服务端日志只记录能力、耗时、状态码与错误码，不记录密钥、签名串、图片 base64。

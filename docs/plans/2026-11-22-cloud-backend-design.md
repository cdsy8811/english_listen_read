# 英语听读 App 云端后端设计（2026-11-22）

## 背景

App 目前是纯本地单机：`plus.sqlite` 为唯一数据源，无登录、无同步、讯飞密钥随 APK 分发。
本轮把数据与 AI 能力迁到自有云服务器，新增 `admin/` 后端工程，技术栈对齐
`E:\Boya\car_ltd`：Laravel 12.x + Vue 3.5.x + Element Plus。

## 已确认的口径

| 项 | 结论 |
|---|---|
| 云端定位 | 离线优先：本地 SQLite 仍是主库，登录后增量备份/多设备同步 |
| 账号 | 多账号密码，数据按账号隔离，不需要短信 |
| 讯飞 | 全部收到后端代理，APK 不再带密钥 |
| 后台范围 | 完整运营后台（用户/词库/跟读/记录/统计/AI 用量/系统管理） |
| 部署 | 宝塔面板，单站点 |
| 本轮边界 | 只交付后端 + App API；App 端登录/同步/AI 切换下一轮 |

## 1. 工程与运行形态

`admin/` 是独立 Laravel 12 工程：

```
admin/
├─ app/Http/Controllers/Api/Admin/
├─ app/Http/Controllers/Api/App/
├─ app/Models/ app/Services/ app/Traits/
├─ database/migrations database/seeders
├─ resources/js/admin/            # Vue 3.5 + Element Plus SPA
├─ resources/views/admin.blade.php
├─ routes/api.php -> api/admin.php + api/app.php
├─ tests/Feature/
├─ docs/API.md docs/部署-宝塔.md
└─ composer.json package.json vite.config.js .env.example
```

- 后台页面 `/admin`，后台接口 `/api/admin`，App 接口 `/api/v1`。
- 本地 SQLite + `php artisan serve` + `npm run dev`；生产 MySQL 8 + PHP-FPM。
- 缓存/队列默认 database，Redis 可选；不强制 Octane。
- 前端 Element Plus + scoped CSS，不引 Tailwind；保留 `BaseCrud` 配置协议但精简重写。

## 2. 数据模型与同步协议

### 账号与权限

- `users`：后台管理员，Sanctum `admin` guard。
- `app_users`：App 用户，多账号；`uuid/username/password/nickname/status/last_login_at/next_sync_seq`。
- `app_devices`：`unique(app_user_id, device_id)`，记录平台、版本、最后在线。
- RBAC：`roles / permissions / role_permissions / user_roles`；`permissions.type=menu|action`；
  超管 `admin` 直接放行；后台菜单由权限表 `type=menu` 动态生成。

### 业务表

`units / words / practice_records / read_articles / read_records / study_sessions / app_settings`

统一附加：

- `app_user_id`：归属账号，所有查询强制带。
- `uuid`：App 本地 id，`unique(app_user_id, uuid)`，push 幂等。
- `sync_seq`：服务端单调序号，pull 游标。
- `client_updated_at_ms`：客户端最后修改毫秒时间，冲突判定。
- `deleted_at`：墓碑；pull 下发删除。
- `created_at_ms`：业务时间用毫秒，避免时区转换。

`app_settings` 每用户一行，`payload` 存设置 JSON，整包 LWW。
墓碑保留 180 天，超期设备需从 `cursor=0` 全量重拉。

### 同步协议 v1

- `POST /api/v1/auth/login` → token + cursor。
- `GET /api/v1/sync/pull?cursor=0&limit=500` → 按 `sync_seq` 升序，返回
  `changes/next_cursor/has_more/server_time_ms`。
- `POST /api/v1/sync/push` → 批量 ≤500，逐条返回 `applied|stale|invalid`。
- 冲突：`client_updated_at_ms` 最后写入胜；相同则服务端胜；超前服务器 24h 判非法。
- `sync_seq` 从 `app_users.next_sync_seq` 成块分配，批次内每条唯一递增。
- 后台修改数据也递增 `sync_seq`，App 下次 pull 自动同步。

## 3. App AI 接口

| 接口 | 入参 | 出参 |
|---|---|---|
| `POST /api/v1/ai/ocr` | multipart 图片 ≤4MB | `{markdown}` |
| `POST /api/v1/ai/extract` | `{markdown}` | `{words:[WordDraft]}` |
| `POST /api/v1/ai/evaluate` | 模式/词条/作答/严格度 | `EvalResult` |
| `POST /api/v1/ai/dict` | `{query,lang}` | 词典条目 |
| `POST /api/v1/ai/gloss` | `{word}` | 音标 + 简版释义 |
| `POST /api/v1/ai/tts` | `{text,lang,speed}` | 完整 mp3（服务端缓存） |
| `POST /api/v1/ai/asr` | multipart 音频 ≤60s | `{text}` |
| `POST /api/v1/ai/passage-translate` | `{sentences}` | `{translations}` |
| `POST /api/v1/ai/passage-evaluate` | 句子/作答/转写 | `PassageEval` |

- 讯飞密钥只放服务器 `.env`；日志禁止输出密钥、签名串、app_id、图片 base64。
- OCR 服务端完成 base64/gzip 解码，只返回 `document[].value` 的 markdown。
- 抽取 prompt 保留“忽略 OCR 音标、按单词重生成 IPA”。
- TTS 缓存键 `sha256(text|lang|vcn|speed)`，存 `storage/app/private/tts/`，支持 ETag。
- 每用户限流与日配额，429 带 `retry_after`；`ai_call_logs` 记录用量与错误。

## 4. 后台模块

- 工作台：总量、7/30 天趋势、AI 调用与失败率。
- App 用户：增删改查、改密、禁用、设备、数据聚合。
- 词库：按用户/关键词查单元，词条查看/编辑/删除/导出。
- 跟读：文章与逐句译文、跟读记录。
- 练习记录：多维筛选、判分明细。
- 学习统计：会话明细与按天/用户聚合。
- AI 用量：日志、配额、TTS 缓存清理。
- 系统管理：管理员、角色、权限菜单树、操作日志、登录日志、系统配置。
- 登录：账号密码 + `throttle:8,1` + 连续失败锁定；一期不做滑块验证码。

## 5. 安全、部署与验收

- 宝塔站点根目录 `admin/public`；PHP 8.2+；MySQL 8 `utf8mb4`；强制 HTTPS；
  `client_max_body_size 8m`；超时 120s；禁止访问 `.env`。
- 定时：TTS 缓存 LRU、墓碑清理、日志清理。
- 管理员用 `php artisan app:create-admin` 创建，不写死弱密码。
- 验收：SQLite/MySQL 各跑 `migrate:fresh --seed`；`php artisan test` 全绿；
  `npm run build` 后 `/admin` 全菜单可用；App API smoke 通过；密钥扫描通过；
  `docs/API.md` 与宝塔部署文档齐全。

## 本轮不做

- App 端登录/同步客户端与 AI base URL 切换。
- 公共词库/短文下发。
- 注册、短信、滑块验证码、多租户组织、实时 WebSocket。

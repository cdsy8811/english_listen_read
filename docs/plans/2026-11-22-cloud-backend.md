# 英语听读云端后端（admin）实现计划

> 设计文档：`docs/plans/2026-11-22-cloud-backend-design.md`
> 目标：在 `admin/` 交付 Laravel 12 + Vue 3.5 + Element Plus 的可运行后端，提供后台管理 API 与 App API（登录、增量同步、讯飞代理）。
> 约束：不改动 App 现有未提交代码；不改动根目录文档口径；所有密钥只进服务器 `.env`。

## 技术栈

- PHP 8.2+ / Laravel 12.x / Sanctum / MySQL 8（本地 SQLite）
- Vue 3.5+ / Vite 7 / Element Plus / Pinia / vue-router / axios / ECharts
- 队列与缓存默认 database，Redis 可选
- 测试 PHPUnit 11（Laravel 自带）

## 阶段 0：脚手架

### Task 0.1 创建 Laravel 工程

- 执行：`composer create-project laravel/laravel admin "12.*" --prefer-dist`
- 验证：`cd admin && php artisan --version` 输出 `Laravel Framework 12.x`
- 本地 `.env`：`DB_CONNECTION=sqlite`、`APP_URL=http://127.0.0.1:8000`、`APP_LOCALE=zh_CN`、`APP_TIMEZONE=Asia/Shanghai`
- 执行：`php artisan key:generate`
- `.env.example` 只保留占位符，新增 `XFYUN_*`、`SYNC_*` 键名。
- `.gitignore` 增加 `/vendor`、`/node_modules`、`/.env`、`/public/build`、`/storage/*.key`、`/database/*.sqlite`。

### Task 0.2 基础目录与路由

- 创建：`app/Http/Controllers/Api/Admin`、`Api/App`、`app/Services/Ai`、`app/Support`。
- `routes/api.php` require `api/admin.php`、`api/app.php`。
- `routes/web.php`：`/` 重定向 `/admin`，`/admin/{any?}` 返回 `admin` 视图。
- `bootstrap/app.php` 注册 `permission`、`log.operation` 中间件别名；API 异常统一 JSON。

**验收**：`php artisan route:list` 能看到 `/api/admin/*`、`/api/v1/*`、`/admin`。

## 阶段 1：框架基座（对齐 car_ltd）

### Task 1.1 统一响应与控制器

- `app/Traits/ResponseJson.php`：`success/error/successPage`，结构 `{code,msg,data,timestamp}`。
- `app/Http/Controllers/Controller.php`：`use ResponseJson`，默认 `show` 走 `index` 兜底。
- `app/Models/BaseModel.php`：`SoftDeletes`、`$guarded=[]`、`serializeDate` 为 `Y-m-d H:i:s`。
- `app/Services/BaseService.php`：`handleSearch($query,$params)` 支持
  `field=value|like/in/between/>=/<=`，`page/page_size`、`sort_by/sort_order`。
- 测试：`tests/Unit/BaseServiceTest.php` 覆盖操作符解析。

### Task 1.2 鉴权与权限

- `config/auth.php`：`admin` guard（users 表）、`app` guard（app_users 表），均 Sanctum。
- `app/Http/Middleware/CheckPermission.php`：调用 `User::hasPermission()`，无权限返回 `code=2003`。
- `app/Support/PermLib.php`：封装权限判断。
- `app/Http/Middleware/LogOperation.php`：写 `operation_logs`，只记录方法/路径/状态/耗时/IP，不记录请求体。

**验收**：`tests/Feature/AuthTest.php` 覆盖登录、me、退出、无权限 403。

## 阶段 2：数据库

### Task 2.1 迁移

按顺序创建：

1. `users`（在 Laravel 默认表上补 `username/nickname/status/last_login_at/last_login_ip`）
2. `personal_access_tokens`（Sanctum）
3. `rbac`：`roles`、`permissions`、`role_permissions`、`user_roles`
4. `app_users`、`app_devices`
5. 业务：`units`、`words`、`practice_records`、`read_articles`、`read_records`、`study_sessions`、`app_settings`
6. AI：`ai_call_logs`、`tts_assets`
7. 日志与配置：`operation_logs`、`login_logs`、`system_configs`

业务表统一字段：

```php
$table->id();
$table->foreignId('app_user_id')->constrained('app_users')->cascadeOnDelete();
$table->string('uuid', 64);
$table->unsignedBigInteger('sync_seq')->default(0)->index();
$table->unsignedBigInteger('client_updated_at_ms')->default(0);
$table->unsignedBigInteger('created_at_ms')->default(0);
$table->softDeletes();
$table->timestamps();
$table->unique(['app_user_id', 'uuid']);
$table->index(['app_user_id', 'sync_seq']);
```

`app_settings`：`unique(app_user_id)`，`payload` 用 `longText` 存 JSON。
`users` 与 `app_users` 不共用表，避免 App 用户混入后台。

### Task 2.2 模型与关联

- `User`：`HasApiTokens`、`roles()`、`hasPermission()`、`getPermissions()`、`getMenus()`（`permissions.type=menu` 树）。
- `AppUser`：`devices()`、`units()`、`practiceRecords()`、`readArticles()`、`studySessions()`。
- 业务模型：`$guarded=[]`，casts：
  - `read_articles.content/translations` => `array`
  - `practice_records.detail_json` => `array`（若不是 JSON 则保留字符串，读时容错）
  - `app_settings.payload` => `array`
- 统一 scope：`forUser($query,$appUserId)`、`changedAfter($query,$cursor)`。

### Task 2.3 种子

- `RbacSeeder`：权限树（工作台/用户/词库/跟读/记录/统计/AI/系统），超管角色绑定全部。
- `AdminUserSeeder`：仅在 `ADMIN_INIT_PASSWORD` 存在时创建 `admin`。
- `DemoSeeder`：仅 `local/testing` 创建 `demo/demo123456`、一个单元、5 个词、2 条练习记录、1 篇跟读文章。
- `DatabaseSeeder` 按环境调用。

**验收**：`php artisan migrate:fresh --seed` 成功；`sqlite3`/MySQL 均无报错。

## 阶段 3：后台 API

### Task 3.1 认证

- `Admin\AuthController`：`login/me/logout/updatePassword`。
- `AuthService`：密码校验、状态校验、Sanctum token、更新登录时间/IP、登录日志；失败 5 次锁定 5 分钟（Cache）。
- 路由：`POST /api/admin/auth/login`、`GET /api/admin/auth/me`、`POST /api/admin/auth/logout`、`PUT /api/admin/auth/password`。

### Task 3.2 系统管理

- `System\UserController`：管理员 CRUD、角色分配、重置密码。
- `RoleController`：CRUD、`assign-permissions`。
- `PermissionController`：树形列表、CRUD（菜单/按钮）。
- `LogController`：操作日志、登录日志。
- `ConfigController`：系统配置读写。
- 路由全部挂 `auth:admin` + `permission:system...`。

### Task 3.3 业务管理

- `DashboardController`：总量、7/30 天趋势、AI 用量。
- `AppUserController`：CRUD、改密、禁用、设备列表、数据聚合。
- `UnitController` + `WordController`：按用户筛选、词条抽屉、CRUD、CSV 导出。
- `PracticeRecordController`、`ReadArticleController`、`ReadRecordController`、`StudySessionController`。
- `AiCallLogController`、`TtsCacheController`（占用/清理）。
- 所有列表用 `BaseService::handleSearch`，返回 `successPage`。

**验收**：`tests/Feature/AdminApiTest.php` 覆盖登录、权限、CRUD、分页、CSV。

## 阶段 4：后台前端

### Task 4.1 SPA 基座

- `package.json`：`vue@^3.5`、`vue-router@^4.5`、`pinia@^3`、`element-plus@^2.13`、
  `@element-plus/icons-vue`、`axios`、`dayjs`、`echarts`、`vue-echarts`。
- dev：`vite@^7`、`@vitejs/plugin-vue@^6`、`laravel-vite-plugin@^2`。
- `vite.config.js`：Laravel 插件 + Vue 插件，alias `@admin`。
- `resources/views/admin.blade.php`：`@vite(['resources/css/app.css','resources/js/admin/app.js'])`。
- `resources/js/admin/app.js`：注册 Pinia、Router、Element Plus（zh-cn）、全局图标、`v-permission`。
- `utils/request.js`：baseURL `/api/admin`，Bearer token，统一错误提示，401 跳登录。
- `stores/user.js`：token/user/menus 持久化、`initUser/login/logout`。
- `router/index.js`：`/login`、`/` 工作台、静态路由 + 动态菜单路由。
- `layouts/MainLayout.vue`：侧栏菜单、面包屑、用户下拉、退出；不做多主题。

### Task 4.2 通用 CRUD

- `components/BaseCrud/`：`index.vue`、`SearchForm.vue`、`CrudTable.vue`、`CrudDialog.vue`。
- 配置协议：
  ```js
  {
    api: '/app-users',
    rowKey: 'id',
    columns: [{ prop:'username', label:'账号' }],
    search: [{ prop:'keyword', label:'关键词' }],
    form: [{ prop:'username', label:'账号', type:'input', required:true }],
    permissions: { add:'app_user:add', edit:'app_user:edit', remove:'app_user:remove' }
  }
  ```
- 支持分页、搜索、刷新、新增/编辑弹窗、单删/批删、插槽自定义列。

### Task 4.3 页面

- `pages/auth/Login.vue`
- `pages/Index.vue`（工作台 + ECharts）
- `pages/app-user/Index.vue`、`Detail.vue`
- `pages/library/Unit.vue`、`Word.vue`
- `pages/read/Article.vue`、`ReadRecord.vue`
- `pages/practice/Record.vue`
- `pages/study/Session.vue`
- `pages/ai/CallLog.vue`、`Cache.vue`
- `pages/system/User.vue`、`Role.vue`、`Permission.vue`、`Log.vue`、`Config.vue`

**验收**：`npm run build` 成功；`/admin` 登录后所有菜单可打开；浏览器控制台无错误。

## 阶段 5：App API

### Task 5.1 认证

- `App\AuthController`：`login`（username/password/device）、`me`、`logout`。
- `AppAuthService`：校验状态、创建设备、签发按设备命名的 token、返回 `cursor=app_users.next_sync_seq`。
- 路由前缀 `/api/v1`，中间件 `auth:app`。

### Task 5.2 同步

- `SyncService`：
  - `pull($appUserId,$cursor,$limit)`：按实体查询 `sync_seq > cursor`，合并排序，返回 `changes`。
  - `push($appUserId,$changes)`：事务内分配 `next_sync_seq` 块，逐条 LWW 判断并 upsert/软删。
  - 实体映射：`unit/word/practice_record/read_article/read_record/study_session/setting`。
  - 校验字段白名单，禁止客户端写 `app_user_id/sync_seq`。
- `SyncController`：`pull`、`push`、`status`。
- 测试：
  - 两个账号互不可见。
  - 同 uuid 推送两次只产生一条。
  - 旧时间戳推送返回 `stale`，新时间戳覆盖。
  - 删除后 pull 返回 `op=delete`。
  - 分页游标不漏行。

### Task 5.3 契约文档

- `admin/docs/API.md`：认证、同步、AI、错误码、示例 curl。
- 提供 `scripts/smoke-app-api.sh`（curl）或 `tests/Feature/AppApiSmokeTest.php`。

**验收**：`php artisan test --filter=AppApi` 全绿；smoke 脚本可跑通登录→push→pull。

## 阶段 6：讯飞代理

### Task 6.1 客户端与配置

- `config/xfyun.php`：app_id/api_key/api_secret、OCR host、TTS vcn 中英、MaaS base_url/model、超时。
- `app/Services/Ai/XfyunSigner.php`：HMAC-SHA256 + RFC1123，现签现用。
- `app/Services/Ai/XfyunHttp.php`：Guzzle，429 退避，日志脱敏。
- `app/Services/Ai/XfyunWebSocket.php`：基于 `phrity/websocket`，
  `tts()` 按 `seq` 重排、返回完整 mp3；`asr()` 分帧上传、返回文本。
- 抽象 `XfyunClientInterface`，测试用 Fake。

### Task 6.2 业务服务

- `OcrService`：图片 → base64 → OCR → 解 base64/gzip → 只取 `document[].value`。
- `ExtractionService`：markdown → 严格 JSON；prompt 保留“忽略 OCR 音标、按单词重生成 IPA”。
- `EvaluationService`：2.2/2.3/默写内容正确度；复用 App 的判分口径（同音词、拆词容错）。
- `DictionaryService`、`PassageService`：词典、点词速览、逐句翻译/检查。
- `TtsService`：缓存键 `sha256(text|lang|vcn|speed)`；`storage/app/private/tts`；ETag；LRU 清理命令。
- `AsrService`：校验 mp3 ≤60s/≤4MB。

### Task 6.3 接口

- `App\AiController`：`ocr/extract/evaluate/dict/gloss/tts/asr/passage-translate/passage-evaluate`。
- 每用户限流（`RateLimiter`）+ 日配额（`system_configs` 或 `ai_quotas`）。
- `ai_call_logs` 写 capability/status/latency/error_code，不写敏感内容。
- 测试：`Http::fake`/Fake 客户端返回固定结果；未登录 401；超限 429；日志不含密钥。

**验收**：`php artisan test --filter=Ai` 全绿；真实凭据仅手工 smoke（不入库、不入仓库）。

## 阶段 7：部署与收尾

- `admin/docs/部署-宝塔.md`：站点根目录、PHP 版本、MySQL、HTTPS、伪静态、超时、上传大小、定时任务、队列、备份、`.env` 权限。
- `admin/README.md`：本地启动、测试、构建、目录说明。
- 根 `README.md` 增加 `admin/` 索引；`AGENTS.md` 增加后端约定（不复制密钥）。
- 安全扫描：`rg "APPID|APIKey|APISecret|Authorization" admin --glob '!vendor/**'` 人工复核，确认无真实值。
- 最终验收命令：
  ```bash
  cd admin
  php artisan migrate:fresh --seed
  php artisan test
  npm run build
  php artisan serve
  ```
  浏览器 `/admin` 登录，逐页检查；App API smoke。

## 交付物清单

- `admin/` 完整 Laravel 工程（不含 `vendor`、`node_modules`、`.env`）。
- 后台 SPA（登录、工作台、用户、词库、跟读、记录、统计、AI、系统）。
- App API（认证、增量同步、讯飞代理）。
- `docs/API.md`、`docs/部署-宝塔.md`、`README.md`。
- PHPUnit 测试与 smoke 脚本。

## 风险与对策

| 风险 | 对策 |
|---|---|
| 讯飞 WSS 在 PHP 下实现复杂 | 封装 `XfyunClientInterface`，先用 HTTP/单测跑通业务；WSS 用成熟库，真实联调单独做 |
| 同步游标漏行 | `sync_seq` 成块分配 + 按 seq 升序 + 测试分页 |
| 宝塔 PHP 版本/扩展不足 | 部署文档列明 `pdo_mysql/mbstring/curl/openssl/fileinfo`，PHP 8.2+ |
| 后台页面工作量大 | BaseCrud 配置化，业务页优先；复杂详情页单独写 |
| 密钥误入仓库 | `.env.example` 占位、日志脱敏、提交前扫描 |

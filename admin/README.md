# 橙子英语 · 云端后端

Laravel 12 + Vue 3.5 + Element Plus，单站点同时提供：

- 管理后台页面：`/admin`
- 管理后台 API：`/api/admin`
- App API：`/api/v1`
- 健康检查：`/up`、`/api/health`

## 本地启动

```bash
composer install
copy .env.example .env        # Windows；Linux 用 cp
php artisan key:generate
php artisan migrate:fresh --seed
php artisan app:create-admin  # 交互输入密码；也可先设置 ADMIN_INIT_PASSWORD 再 seed
php artisan serve --host=127.0.0.1 --port=8000
```

另开一个终端：

```bash
npm install
npm run dev
```

打开 `http://127.0.0.1:8000/admin`。本地 demo 账号（仅 `local/testing` 且
`DEMO_SEED_ENABLED=true` 时创建）：`demo / demo123456`。

## 常用命令

```bash
php artisan test                 # PHPUnit
npm run build                    # 生产构建到 public/build
php artisan app:prune-tts        # 按容量清理 TTS 缓存
php artisan app:prune-tombstones # 清理过期同步墓碑
php artisan app:prune-logs       # 清理过期日志
php artisan schedule:work        # 本地跑定时任务
```

## 目录

```
app/Http/Controllers/Api/Admin/   后台接口
app/Http/Controllers/Api/App/     App 接口（认证 / 同步 / AI）
app/Services/Ai/                  讯飞 OCR / MaaS / TTS / ASR / 判分
app/Services/Admin/               后台业务服务
app/Support/                      权限、同步序号、同音词
resources/js/admin/               Vue 3.5 管理后台
routes/api/admin.php              后台路由
routes/api/app.php                App 路由
docs/API.md                       App API 契约
docs/部署-宝塔.md                  宝塔部署步骤
```

## 安全

- 真实密钥只放服务器 `.env`，仓库只保留 `.env.example` 键名。
- 日志不记录密钥、签名串、完整鉴权 URL、图片 base64。
- App 用户与后台管理员分表、分 guard；所有业务表强制带 `app_user_id`。
- 管理后台写操作写 `operation_logs`，登录成功/失败写 `login_logs`。
- APK 不再直接调用讯飞：所有 AI 请求都走本后端。

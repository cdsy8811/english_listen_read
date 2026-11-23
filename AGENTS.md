# AGENTS.md — 项目约定（给编码代理 / 协作者）

本文件是**约定而非教程**。开始任何工作前先读完它，再读 `docs/开发方案.md`。

## 1. 项目是什么

安卓端「橙子英语」（原名「英语听读软件」）：拍照把单词表变成词库，再用三种模式（中英共读 / 看中说英 / 看英说中）加「默写」（看中文写英文，只打字）做听读练习并评价；另含电子词典与英文短文跟读。技术栈 **uni-app（Vue3 + Vite + TypeScript）**，目标产物是 Android APK。

**当前状态（2026-11-21）：P1–P6 工程代码已完成，并新增「电子词典」与「跟读」**，工程位于 `english-listen-read/`。App / H5 双端编译通过、99 项离线自测全过、`vue-tsc` 0 错误、密钥扫描无泄漏、产物含分片凭据且无明文整串。朗读合成已加本地缓存（`services/tts-cache.ts`，永不过期 + 300 MB LRU + 死条目自愈，设置页可看占用与清理）。**APK 二进制需在 HBuilderX 云打包产出**（本机无 Android SDK，且云打包需 DCloud 账号登录态），完整步骤与验收清单见 `docs/打包指南.md`。2026-11-06 用户已给出明确指令授权创建工程并实现 P1–P6，此前「先出方案、实际功能不做」的限制已解除。全部决策见 `docs/开发方案.md` 第 10 节，C 方案落地细则见第 11 节。

## 2. 必读文档（按顺序）

| 文件 | 作用 |
|---|---|
| `docs/开发方案.md` | 需求口径、三种模式、设置矩阵、架构、数据模型、里程碑、**决策结果**、独立运行方案 C。**唯一的需求真相来源** |
| `docs/讯飞接口配置.md` | 四个讯飞接口、凭据、两套鉴权、签名步骤、联调实测。**含真实密钥，受安全规则约束** |
| `.env.example` | 配置键名的唯一来源 |
| `README.md` | 面向人的项目说明与文档索引 |

## 3. 技术约定

- 框架：uni-app **Vue3 + Vite + TypeScript**；状态管理用 Pinia；App 端条件编译一律用 `// #ifdef APP-PLUS`。
- 本地数据：`plus.sqlite`（SQLite），设置可用 `uni.setStorage`；**离线可用是硬要求**，网络失败要能退回输入框 / 本地缓存音频。
- 页面在 `src/pages/`，路由在 `pages.json`；新增页面必须同步更新 `pages.json`。
- 组件放 `src/components/`，命名 PascalCase；工具放 `src/utils/`。
- 音频：`uni.getRecorderManager()` 录音（16k 单声道）、`uni.createInnerAudioContext()` 播放；播放队列由**完成回调**驱动，禁止用固定 `sleep` 串播。
- **朗读音频缓存**：`src/services/tts-cache.ts` 是唯一入口（合成 / 淘汰 / 清理都从这里走，页面和 `src/api/` 不要直接读写 `media_cache`）。键 = 归一化文本 + 语种 + 发音人 + 语速；**音量不进键、也不发给云端**，音量只在播放侧施加；条目**永不过期**，按 300 MB LRU 淘汰；命中前必须 `probeFile()` 校验文件存在，死条目删索引后重新合成。不要再引入按天 TTL。详见 `docs/开发方案.md` 第 14 节。
- 练习页状态机固定为 `idle → playing → awaiting → evaluating → advancing`，新增逻辑不得绕开它。
- **品牌与图标**：应用名「橙子英语」，主色 `#f97316`（深色 `#c2410c` 用于浅底文字）。图标不要手工缩放：改 `tools/make-app-icon.py` 顶部配色 / 形状常量后重跑，脚本会生成 `src/static/icons/`（含 round、adaptive）、`unpackage/res/icons/` 全部尺寸和页面内用的透明标记 `src/static/brand/mark.png`；底部导航图标由 `tools/make-*-tabbar-icon.py` 生成（选中色同为 `#f97316`）。

### 独立运行（方案 C）的网络约定

- **没有代理层，也不需要电脑或云账号**。App 端 `uni.request` 走原生网络栈、**不受 CORS 约束**，`uni.connectSocket` 直连 WSS。OCR 文档里「不支持跨域、不适用于浏览器」只约束 H5/浏览器，对 App 端不成立。
- HMAC-SHA256 签名在 **App 端** 完成，逻辑与 `tools/proxy.py` 的 `auth_query()` 一致；签名 URL 现用现生成（`date` 容差 ±300s，别缓存签名结果）。
- 客户端只连讯飞四个接口；不连任何自建后端。

### 能力层必须可插拔

`src/services/` 只暴露接口（如 `speak(text, opts)`、`transcribe(audio)`、`evaluate(...)`、`extractWords(text)`、`recognize(image)`），具体实现放 `src/api/`。上层页面**不得**直接引用讯飞地址、模型名、发音人或签名逻辑。

原因：第一版**决定不接 ISE**（2.2 只做内容正确度）、英文 TTS 曾因音色授权未定而降级安卓原生 TTS（2026-11-21 已领取 `x5_EnUs_Lila_flow`）、ASR 要保留无网输入框降级，且**日后若要分发/上架，需从 C 迁到云函数（B）**——届时只改 `src/api/`，UI 不动。

## 4. 安全红线（含已授权的自用例外）

1. **源码仓库里绝不出现真实密钥**：不写进 `src/`、注释、`manifest.json`、`pages.json`、示例数据、单元测试 fixture 或提交记录，代码里只允许出现 `.env` 的键名。密钥由构建期从本地 `.env.local`（已 gitignore）注入，**只存在于产物 APK 中**。
2. **不要复制、摘录、复述 `docs/讯飞接口配置.md` 中的密钥值**到其它文件、终端输出、日志或回复里。需要引用时只写「见凭据文档」。
3. `docs/讯飞接口配置.md`、`.env.local` 已被 `.gitignore` 排除，**不要取消这条规则**，不要 `git add -f`。
4. 日志禁止打印 `Authorization`、签名串、完整鉴权 URL（含查询参数）、请求体中的 `app_id` 与图片 base64；**App 端运行时同样禁止**。
5. **已授权的自用例外**：HMAC-SHA256 签名**在客户端完成、客户端直连讯飞**，不要求服务端代理。授权来源：2026-11-06 用户明确说明「这是我自己学习用的 app，场景选 C」，即接受「APK 可被反编译、密钥可能被提取」的风险。必须同时落实以下补偿措施，缺一不可：
   - 密钥**不以明文整串**出现在 JS 里：分片存储、运行时拼接，或放 native 层；构建开启代码混淆，打包后做一次免费加固。
   - 讯飞控制台设置**用量上限与用量告警**；发现异常立即轮换密钥。
   - **APK 只装用户自己的手机，不外传、不上架、不分发**。
6. 发现密钥疑似外泄时，第一时间提示用户到讯飞控制台轮换，不要自行"清理痕迹"掩盖。
7. **若需求变为「给别人用 / 上架 / 多人使用」，必须先迁到云函数方案（`开发方案.md` 第 11 节 B）再继续**，不得沿用 C 直接发布。

## 5. 讯飞接入要点（易错）

- 两套凭据互不通用：MaaS 是 `Bearer ak-...`；**OCR / 听写 / 合成**三个私有接口共用 APPID + APIKey + APISecret 的 HMAC-SHA256 签名。
- OpenAI 兼容 `base_url` 填到 `/v2` 为止，SDK 自己拼 `/chat/completions`；填全路径会 404。
- **`spark-x2.6` 是纯文本模型，不支持图片**。拍照 OCR 走 `se75ocrbm`（通用文档识别大模型，HTTPS POST），不要把图片传给 spark-x2.6。三段式请求体：`header.app_id` + `parameter.ocr` + `payload.image.image`（base64，编码后 ≤4M）。
- OCR 响应 `payload.result.text` **也是 base64**，需解码（`compress=gzip` 时先解压）；**解码后不是纯文本，而是含 `document[]` + `image[]` 的 JSON**——只把 `document[].value`（markdown）喂给 spark-x2.6，别整包塞进去（实测 6909 字 vs 190 字）。`header.code == 0` 才成功，`header.sid` 留给工单排错。
- **签名 host 已联调排除疑问**：`api.xf-yun.com` 与 `cbm01.cn-huabei-1.xf-yun.com` 两种都返回 `code=0`；默认用后者，保留 `XFYUN_OCR_SIGN_HOST` 可配置。请求行方法必须是 `POST`（WSS 才是 `GET`）。
- **音标必须重生成**：实测 OCR 对 IPA 音标 3/3 损坏（变 `☐`、`$\square`）。抽取 prompt 要显式写「忽略 OCR 里的音标，按单词重新生成标准 IPA」，否则模型会照抄乱码；音标再经校对页确认。
- `result_format` 建议 `json,markdown`，单词表的分栏 / 表格结构更利于抽取；`rotation_min_angle: 5` 可自动旋正拍照。
- spark-x2.6 长输出（抽取 / 判分）在 20s 超时下会失败，客户端超时至少 60–90s；`temperature: 0.1` 可稳定返回严格 JSON。
- 语音听写单次音频 ≤60s；签名 `date` 为 GMT RFC1123，服务端容差 ±300s，**设备时间不准会 401**，必要时给出校准提示。
- 超拟人合成音频分帧返回且**顺序不保证**，必须按 `seq` 重排序；`speed` 默认是 50 而非 1.0，需做倍数标定。
- 免费额度会 429，所有云调用要有退避重试与请求合并。
- **中英发音人**：中文 `x5_lingxiaoxuan_flow`、英文 `x5_EnUs_Lila_flow`（英文通用美式口音、女声），2026-11-21 实测 `code=0`；其余英文 vcn 一律 `11200 licc limit`。改 `.env.local` 的 `XFYUN_TTS_VCN_*` 后必须重跑 `npm run prepare:config`，否则构建产物里仍是旧的分片配置。讯飞没有英式英文音色，设置里选 UK 时由 `preferNativeVoice()` 直接降级原生 TTS，不要偷偷用美音顶替。
- 语音听写只返回文本，**不提供发音评分**。用户已决定 **2.2 只做「内容正确度」**：ASR 转写比对 + spark-x2.6 语义判分，不接 ISE；UI 文案禁止出现「发音分 / 准确度 / 流利度」，逐词高亮只表示文本对错。能力层 `evaluate()` 接口保持不变，日后插 ISE 不改 UI。

## 6. 工作方式

- 需求有歧义时，先查 `docs/开发方案.md` 第 10 节「决策结果」与 10.1「默认口径」；没有的答案问用户，不要自行脑补后写入代码。
- 用户已确认「2.4」是**笔误**，PracticeMode 枚举只有 2.1 / 2.2 / 2.3，不要新增第四种模式。**2026-11-15 用户新增底部菜单「默写」**：只显示中文、不朗读、不录音，学生输入英文后提交。它是 **2.2 的变体**（路由 `mode=2.2&input=type`，复用内容正确度评价），不是新的 PracticeMode；状态机、记录表结构都不变。**2026-11-21 用户要求默写改用页内自定义 26 键键盘**（`components/DictationKeyboard.vue`，取消 / 上一条 / 下一条也在键盘里），**不渲染 input、不调系统输入法**，防止输入法的 AI / 翻译辅助作答；同时 **2.2 看中说英删除手工输入，只保留按住录音**，2.3 不受限制（系统输入法 + 录音同时可用）。
- **2026-11-21 新增底部菜单「词典」（电子词典）**：中英互查、音标 / 例句 / 搭配、逐条朗读、加入生词本。复用 Spark X2.6（`src/services/dictionary.ts` + `src/api/xfyun-dict.ts`）与现有播放队列，不是新的 PracticeMode；结果写 `dict_cache`、历史写 `dict_history`，断网只保证「已查过的词 + 我的词库」可查。详见 `docs/开发方案.md` 第 12 节。
- **2026-11-21 新增底部菜单「跟读」**：**手工输入 / 粘贴英文短文**（新页 `pages/read/compose`，只填名称与正文；2026-11-21 用户要求取代原拍照识别）→ 整段 / 单句 / 点单词朗读 → 逐句录音检查。评分仍只做**内容正确度**（ASR 转写 + 逐词对齐 + 必要时 X2.6 语义兜底），**不接 ISE、不出「发音分 / 准确度 / 流利度」**；它不是新的 PracticeMode。数据写 `read_article` / `read_record`（`read_article.content` 存句子 JSON、`translations` 存等长逐句中文，学习页在每句下方显示）；逐句中文由 `services/passage-translate.translateSentences()` 调 X2.6 **整句翻译**（添加时生成，断网/失败可在学习页补），不复用粘贴文本里的中文；切句用本地 `markdownToSentences()`。**2026-11-22 新增点词连读**：长按单词（或点「长按单词 · 连读选词」）进入多选，选中词按原文顺序拼成一段交给 TTS 整体合成，解决连读变音；切句 / 返回退出选择。详见 `docs/开发方案.md` 第 13 节。
- **2026-11-21 底部导航与错词本（用户指定）**：底部固定 4 项 **首页 / 词库 / 跟读 / 我的**（2026-11-22 起移除「词典」tab，词典从首页快捷卡进入；原「设置」tab 收进「我的」）。「我的」菜单为 **学习记录 / 设置 / 关于 / 退出**（对应 `pages/records`、`pages/settings`、`pages/about`；退出仅在 App 端 `plus.runtime.quit()`）。**学习记录**按「一次练习 / 跟读 = 一条」写 `study_session`（时长、作答次数、达标次数、平均分），练习页在离开 / 最后一题时落库、跟读页离开时落库，<10 秒且无作答不记；页面按天分组并汇总今日 / 近 7 天。错词本要能看到**每一次成绩详情**：每次作答都写 `practice_record`，默写的 `detail_json` 带 `dictation: true`；错词本按词展开最近 6 次（方式 / 分数 / 作答 / 标准答案 / 时间），列表支持**多选 + 全选**，「默写重练 / 语音重练」固定在页底，通过 `wordIds` 只练勾选的错词。详见 `docs/开发方案.md` 第 15 节。
- `tools/` 里的探针与 `proxy.py` 只是 **P0 联调 / 开发调试工具，正式 APK 不使用**；它们从凭据文档读密钥、输出不打印密钥，改动时保持这一点。
- 修改文档时保留既有章节结构；`docs/讯飞接口配置.md` 的密钥值视为只读。
- 用中文回复；给结论、给取舍，不要堆砌过程描述。

## 7. 验收基线

每个阶段的验收点见 `docs/开发方案.md` 第 9 节。通用要求：安卓真机（10–15）跑通；**断网时首页、词库、已保存的跟读文章与已缓存音频可用；联网时不依赖电脑、不依赖任何自建服务，App 直连讯飞完成拍照入库、短文跟读与练习**；仓库 `git status` 中不存在任何密钥文件；APK 未外传。

> 2026-11-23 起新增 `admin/` 云端后端；**App 端尚未接入**，上述「直连讯飞」仍是当前 APK 的实际行为。App 接入云端后的验收基线见第 8 节与 `docs/开发方案.md` 第 16 节。

## 8. 云端后端（`admin/`，2026-11-23）

- 技术栈：Laravel 12.x + Vue 3.5 + Element Plus，单站点提供 `/admin`、`/api/admin`、`/api/v1`；部署见 `admin/docs/部署-宝塔.md`。
- 账号：后台管理员 `users`、App 用户 `app_users` 分表分 guard；App 多账号、所有业务查询必须带 `app_user_id`，禁止跨账号读写。
- 同步：本地 SQLite 仍是主库；`admin/` 只做增量备份 / 多设备同步。业务表统一带 `uuid`、`client_updated_at_ms`、`sync_seq`、软删除墓碑；冲突最后写入胜。协议见 `admin/docs/API.md`。
- 同步范围：unit / word / practice_record / read_article / read_record / study_session / app_settings；`media_cache`、`dict_cache`、`gloss_cache`、`dict_history` 不上云。
- AI：OCR、抽取、判分、词典、TTS、ASR、逐句翻译 / 跟读全部由后端代理；**真实密钥只放服务器 `.env`**，仓库只留 `.env.example` 键名。App 接入后，APK 不再需要讯飞密钥。
- 后台：工作台、App 用户、词库、跟读、练习记录、学习统计、AI 用量、系统管理（管理员 / 角色 / 权限菜单 / 日志 / 配置）。
- 开发命令：`cd admin` 后 `php artisan test`、`npm run build`、`php artisan migrate:fresh --seed`；本地 demo 账号 `demo/demo123456` 仅在 `DEMO_SEED_ENABLED=true` 时创建。
- 管理员初始化：`php artisan app:create-admin`，不写死弱密码；生产禁用 demo seed。
- 安全：`APP_DEBUG=false`、HTTPS、`.env` 禁止 Web 访问、讯飞控制台设用量上限与告警；日志不记录密钥 / 签名串 / 图片 base64。


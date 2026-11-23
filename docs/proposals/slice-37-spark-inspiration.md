# 提案：切片 37 — Spark 灵感火花（事项 Tab 改造：灵感 capture + 附件上云 + 灵感↔计划关联）

> 状态：待用户确认。确认后按 §7.1 输出范围再开工。
> 提案依据：用户 2026-11-23 需求 1（backlog §2 候选行「Spark 灵感火花」）+ L1 事项 Tab 占位页消化；五问定案 2026-11-23（本会话 ask_user_question，全推荐项）。

## 1. 背景

- 用户愿景（2026-11-23）：日常灵感及时录入（文字+录音+拍照/照片上传）；灵感与计划的关系 = 一个灵感可包含 0..n 个计划（灵感开始时间、后续发散思维、实现步骤计划的载体）。事项 Tab（`src/app/(tabs)/items.tsx` 45 行占位页，L1）改造为灵感页。
- 竞品参考结论（2026-11-23 简析）：capture 形态参考 Google Keep（一屏速记+混合附件）；灵感→计划转化流参考 Todoist inbox→拆解；本应用独有优势 = AI 闪电录入可做「灵感→计划」转化辅助（留二期候选）。
- 链路现状：无任何录音/拍照依赖（SDK 54）；附件文件存储可复用已有 expo-file-system；上云可复用切片 28/31/35 WebdavClient（PUT/GET/DELETE 全备）。

## 2. 五问定案（2026-11-23，全推荐项）

| # | 问题 | 定案 |
| --- | --- | --- |
| Q1 | capture 交互形态 | **Tab 页内速记条+流式列表**（Keep 式：顶部常驻输入+录音/拍照按钮，灵感流列表在下） |
| Q2 | 录音与转写 | **仅存录音+回放**（v1 不做 AI 转写；转写留后续候选） |
| Q3 | 灵感→计划转化 | **手动转化为主**（详情页「转计划」→预填新建页→保存后自动关联；AI 拆解留二期候选） |
| Q4 | 新依赖 | **允许 expo-audio + expo-image-picker**（录音 = expo-audio（SDK 52+ 官方包）；拍照/相册 = expo-image-picker；附件存储用已有 expo-file-system 零新增） |
| Q5 | 附件备份语义 | **v1 就做附件上云**（随数据备份/恢复上传下载 WebDAV 附件目录——重装/换设备附件不丢，根治 F4 同款痛点） |

## 3. 不做清单（本切片明文不做）

- **AI 转写**（录音→文字）与**灵感 AI 拆解**（灵感→AI 生成计划草稿）：留二期候选（转写与拆解各一条，backlog 登记）。
- **灵感进双向同步**：sync 快照（kind:'sync'）不含 Spark 块——v1 灵感仅进数据备份/恢复（kind:'data'）；多设备灵感同步留候选。理由：sync 合流策略复用（sparks LWW+attachments union+links union）可行但合流测试面 +1 大，且灵感多为单设备速记场景；明文披露「多设备同时记灵感不收敛」。
- 灵感归档状态（'inbox'/'archived'）：v1 灵感流全量倒序，无归档。
- 计划侧反查展示：v1 仅灵感详情页展示关联计划（sparkItems 双向数据齐备，item 详情页不展示「来自灵感」——留候选）。
- 向量检索/FTS5/灵感搜索：不做（§2 技术栈锁定；LIKE 搜索扩展留候选）。
- 照片编辑/压缩/缩略图生成：原图按需缩放显示。
- 录音波形/试听裁剪/暂停续录：一次录音一个文件，删除走详情页。
- **冻结区零改动**：`src/notifications/`、`src/domain/recurrence/`、`src/domain/export.ts`（切片 12 单向导出不加 Spark 块——数据导出格式冻结）；不触碰 AiParser.parse/RemoteDraftWire/ChatMessage kind/AI_SYSTEM_PROMPT；Spark 不进 AI 查询检索域（retrieval.ts 不改）；不加 WorkManager/AlarmManager（变更 B 不并）。
- app_settings 零迁移：Spark 无设置开关（功能主体本身就是 Tab，无需开关）。

## 4. 设计决策（D1–D8）

### D1 路由与 Tab 改造

- `src/app/(tabs)/items.tsx`（45 行占位）删除，新建 `src/app/(tabs)/sparks.tsx`（Spark 灵感页）。路由引用唯一处 `_layout.tsx:63` name="items" → name="sparks"（grep 证实无 deep link/其他引用）。
- `_layout.tsx`：`TAB_ICONS` key `items` → `sparks`，图标 `checkbox` → `bulb`（`bulb`/`bulb-outline`）；Tab title「事项」→「灵感」。
- 灵感详情页新建 `src/app/spark/[id].tsx`（根 Stack 注册，item/[id] 同款模式）。

### D2 schema v19 三新表

SCHEMA_VERSION 17→18→19 现为 18→19（app_settings 零改动）；migrations 追加 toVersion 19 三条 createTable（v2–v18 step 不动）。

1. `sparks`：`title`(string isOptional——纯录音灵感可无标题)、`content`(string isOptional)、`created_at`(number)、`updated_at`(number)。
2. `spark_attachments`：`spark_id`(string isIndexed)、`kind`(string——'audio' | 'image'，写路径守卫)、`uri`(string——本地文件路径)、`remote_path`(string isOptional——远端附件路径，上传成功后回填)、`sha256`(string isOptional——内容 hash，上传成功后回填)、`file_size`(number)、`duration_ms`(number isOptional——录音时长)、`width`/`height`(number isOptional——图片)、`created_at`(number)。
3. `spark_items`：`spark_id`(string isIndexed)、`item_id`(string isIndexed)、`created_at`(number)——关联表（数据一对多，表结构多对多兼容）。

model 类 `SparkModel`/`SparkAttachmentModel`/`SparkItemModel`（@relation/@children 装饰器写法遵守 §5）。删除联动：deleteSpark 同事务级联删 spark_attachments/spark_items 行。

### D3 SparkRepository 端口（新文件，同 ItemRepository 分层模式）

- `src/data/SparkRepository.ts`（端口）+ `src/data/WatermelonSparkRepository.ts`（实现，共享同一 Database 实例）。repository.md 追加非破坏性注记节（新端口成对说明，冻结签名零 diff）。
- 方法面：`createSpark({title?, content?})` / `updateSpark(id, {title?, content?})` / `deleteSpark(id)`（级联附件记录+本地文件+远端 DELETE 失败仅披露）/ `listSparks()`（created_at 倒序）/ `getSparkById(id)` / `listAttachments(sparkId)` / `addAttachment(sparkId, meta)` / `deleteAttachment(attachmentId)` / `linkSparkToItem(sparkId, itemId)` / `unlinkSparkFromItem(sparkId, itemId)` / `listItemsForSpark(sparkId)`（返回 Item 摘要水合：title/status/startAt/category 色 Emoji）。
- item_id 存在性校验：link 前 `getItemById` 命中检查（不命中抛错——与 updateItem categoryId 校验同构）。
- UI 层自装配模式与 itemRepository 一致（模块级单例）。

### D4 附件存储与上云（Q5 定案）

- 本地：`documentDirectory + 'sparks/'`（文件名 `<uuid>.<ext>`；录音 m4a、图片 jpg/png）。
- 远端：`<basePath>/life-attachments/<sha256 前 16 位>-<原名.ext>`（hash 命名防重+可校验）；WebdavClient 新增 `uploadAttachment(localPath, remotePath)`（PUT，**60s 超时**——录音文件大，15s 不够）与 `downloadAttachment(remotePath, localPath)`（GET）与 `deleteAttachmentRemote(remotePath)`（DELETE 失败仅披露，孤儿文件可接受）。
- **即时上传**：录音停止/拍照完成→本地文件写入→addAttachment 落库→立即 PUT 上传→成功回填 remote_path+sha256；失败行内披露（附件行标「未备份」徽标），详情页提供「重新上传」操作。录入动作本身就是手动触发，符合「仅手动」哲学（不引入后台自动同步）。
- 删除附件：本地文件+记录同删；远端文件 DELETE（失败仅披露）。
- 附件数量上限：每灵感 ≤20（超出拒绝+披露，防误操作）；单文件大小上限 25MB（超出拒绝+披露，防 WebDAV 大文件超时与快照膨胀）。

### D5 数据快照扩展（kind:'data' 向后兼容）

- **version 保持 1**：追加可选顶层三块 `sparks` / `sparkAttachments` / `sparkItems`（条目守卫 `isSparkEntry`/`isSparkAttachmentEntry`/`isSparkItemEntry` 与 dataSnapshot 现有条目守卫同构）。缺块 = 跳过该域恢复（v1 快照向后兼容）；旧版 App 读新快照：isDataSnapshotWire 只查必需键（grep 证实），未知顶层键被忽略——旧 App 正常恢复六块（Spark 块静默跳过），双向兼容。
- 恢复语义（同构先例）：sparks 按 id 命中覆盖（title/content/updated_at）/未命中创建（`_raw.id` 保真）/本地独有保留；sparkAttachments 按 id 命中覆盖元数据/未命中创建；**本地文件缺失 → 事务外按 remote_path 下载**（WebDAV 在线时；离线/失败 → skipped+计数披露，记录行已恢复可后补下载）；spark_items 按 id 重建（item_id 解析失败 → skipped）；全部在 applyDataSnapshot 既有单事务两遍法内落库（附件文件下载在事务外逐个执行，不阻塞事务）。
- createDataSnapshot 组包追加三块（listSparks/listAttachments/link 行全量）。
- **双向同步 sync 快照不含 Spark 块**（见 §3 不做清单）。

### D6 capture UI（Q1/Q2 定案）

- `sparks.tsx` Tab 页两段式：顶部速记条（TextInput 多行自增高 + 「文字灵感」发送按钮 + 录音按钮 + 拍照按钮 + 相册按钮）+ 灵感流 FlatList（created_at 倒序卡片：内容摘要两行截断/附件徽标（录音图标×n + 图片缩略图×首张）/关联计划数/相对时间；点击进详情；长按删除 Alert 确认）。
- 录音流程（expo-audio）：点按开始 → 再点停止 → 文件写入本地 → addAttachment 落库 + 即时上传；录音中速记条上方显示计时条（停止/取消）。无预览确认（简化；删除走详情页）。
- 拍照流程（expo-image-picker `launchCameraAsync`）与相册（`launchImageLibraryAsync`）两入口；权限拒绝态引导跳系统设置；图片落本地文件后同链路。
- 空态卡：无灵感时提示「随手记一条灵感」。

### D7 灵感详情页与转计划（Q3 定案）

- `spark/[id].tsx`：标题+内容查看编辑（失焦保存，updateSpark）；附件列表（录音行=播放/暂停+时长+已备份徽标；图片行=缩略图+点击全屏预览（Modal）；均含删除）；「添加附件」按钮组（录音/拍照/相册）；「重新上传」入口（未备份附件行内）；关联计划列表（Item 摘要行：分类色点+标题+状态+时间，点击跳 `item/[id]`，行内解除关联）+「转计划」主按钮。
- 转计划 = `router.push({ pathname: '/item/new', params: { fromSpark: <sparkId>, title: <spark.title ?? ''>, content: <spark.content ?? ''> } })`；`item/new.tsx` 现无任何 query 参数处理（grep 证实）→ 加 `useLocalSearchParams` 预填 title/content（仅当 fromSpark 存在时预填）+ 保存链 `created` 成功后 `if (fromSpark) sparkRepository.linkSparkToItem(fromSpark, created.id)`（失败披露不回滚条目）+ 成功返回灵感详情。
- 关联上限：一个灵感关联计划数 ≤50（护栏，超出拒绝披露）。

### D8 边界与已知限制（明文披露）

- Spark 不进 sync 快照/ICS 导出/小组件快照/闪电录入/AI 查询检索域/切片 12 导出。
- 附件「即时上传」失败时本地可用、远端缺失（「未备份」徽标+详情页重传兜底）；deleteAttachment 远端 DELETE 失败留孤儿远端文件（可接受）。
- 恢复时附件下载依赖 WebDAV 连接在线（离线恢复仅元数据，文件可后补——详情页对无本地文件的附件显示「未下载」态+点击重试下载）。
- 新依赖 dev client 重建：expo-audio（麦克风权限 config plugin）+ expo-image-picker（相机/相册权限 config plugin）均需 `app.json` plugins 配置与 native rebuild；不得删除既有受保护配置（§5）。

## 5. 文件落点与单测

| 落点 | 变更 |
| --- | --- |
| `src/db/schema.ts` / `migrations.ts` | SCHEMA_VERSION 19；三新表 createTable；toVersion 19 |
| `src/db/models/` | SparkModel/SparkAttachmentModel/SparkItemModel（装饰器写法） |
| `src/db/index.ts` | model 注册表 |
| `src/data/SparkRepository.ts` / `WatermelonSparkRepository.ts` | 新端口+实现（D3） |
| `src/data/webdav/WebdavClient.ts` | uploadAttachment/downloadAttachment/deleteAttachmentRemote（60s 超时） |
| `src/domain/dataSnapshot.ts` | 三可选块 wire 守卫+组包+恢复语义（version 1 不变） |
| `src/app/(tabs)/_layout.tsx` | Tab 改名 sparks+bulb 图标（D1） |
| `src/app/(tabs)/items.tsx` → `sparks.tsx` | 占位页删除→灵感页（速记条+流列表，D6） |
| `src/app/spark/[id].tsx` | 灵感详情页（D7） |
| `src/app/item/new.tsx` | query 预填+保存链 link（D7） |
| 单测 | migrationsV19 / SparkRepository CRUD+级联 / dataSnapshot 三块守卫+缺块跳过+双向兼容 / 转计划 link（Probe 模式）/ 附件 hash 命名 |

## 6. 风险

| 风险 | 缓解 |
| --- | --- |
| 大文件上传 15s 超时 | 附件专用 60s 超时+单文件 25MB 上限 |
| 三权限（麦克风/相机/相册）拒绝态 | 每入口拒绝引导跳系统设置；拒绝态可重试 |
| 旧 App 读新快照 | isDataSnapshotWire 只查必需键（已核对），未知键忽略=向后兼容；单测锁定 |
| 路由改名回归 | grep 证实 items 无其他引用；Tab 回归项进真机矩阵 |
| dev client 重建失败 | 新增 plugins 配置按官方文档最小集；构建失败按 §5 输出日志+最小变更提案 |
| 灵感内容进数据快照体积 | content 无截断（灵感多为短文本）；附件不在快照内（仅元数据） |

## 7. 验收口径

- `npx tsc --noEmit` 0 错；`npx jest --runInBand` 基线 **110 套件/1619 用例只增不减**；`npx expo-doctor` 2 项预存基线无新增。
- schema v18→v19 三新表：真机升级安装 migration 执行验收（AGENTS §5）。
- 新依赖：expo-audio + expo-image-picker（版本随 SDK 54 对齐）；app.json plugins 新增权限配置；dev client 重建。
- 真机矩阵（阶段 3 全过）：文字灵感速存/录音灵感全链（录→存→上云→列表徽标）/拍照+相册灵感/灵感详情编辑/附件回放与预览/附件删除（本地+远端）/转计划全链（预填→保存→关联展示）/解除关联/数据备份含 Spark 块/恢复含附件下载/旧格式快照恢复回归（无 Spark 块跳过）/Tab 改名与深浅色。
- APK 版本号：随切片出包 bump **0.37.0 / versionCode 37**（§5 版本号策略，v0.42 定案）。

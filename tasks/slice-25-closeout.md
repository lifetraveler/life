# 切片 25 收尾移交（closeout）——闪电录入认真模式

日期：2026-11-16 ｜ 分支：`task/slice-25`（基点 main @ `3685e52`）｜ 状态：**完成**，待合并 main

提交索引：
- `0dc462c` feat(s25) 阶段1：schema v12 careful_mode 设置管道 + 标题守卫三支判定/editDiff（任务卡 + AGENTS.md v0.27）
- `9351297` docs(s25) 阶段1 反馈（§7.33 单阶段暂停移交）
- `dc3377c` feat(s25) 阶段2：认真模式 Chat 确认交互 + 设置页开关
- `83e1100` fix(s25) 阶段2 修补：消息 id updater 重放撞号（真机重复 key 缺陷）+ MuMu 模拟器验收
- `01f52fe` docs(s25) 阶段2 反馈补充（保存后上下文重置场景 + backlog 候选）
- 本次收尾提交：closeout + backlog + AGENTS.md §8（阶段3 真机验收无源码改动）

## 〇、交付清单

| 交付物 | 位置 |
| --- | --- |
| 任务卡 | `tasks/slice-25.md` |
| 契约修订 | AGENTS.md v0.27 §7.37（认真模式） |
| 阶段反馈（×2） | `tasks/slice-25-phase1-feedback.md`（§六教训）、`tasks/slice-25-phase2-feedback.md`（§三偏差 / §六缺陷修补与模拟器验收 / §七教训） |
| 本 closeout | `tasks/slice-25-closeout.md` |
| backlog 更新 | `tasks/backlog.md` §1 划掉切片 25、§2 登记 4 候选 |

阶段反馈适用时机核对（§7.33 v0.23）：切片分三次推进（阶段1 暂停 → 阶段2 暂停 → 阶段3 收尾），按情形 3 各写一份 phaseM-feedback，两份均已入库并被本清单引用；阶段粒度内容以反馈文件承载，本文件不复制。

## 一、环境事实

- 模拟器：MuMu 12 `127.0.0.1:7555`，Android 15（SM-S9260 profile），fabric 新架构，dev build（versionName 0.23.0 / versionCode 10），bundle 由本机 Metro（`npx expo start --dev-client`）经 `adb reverse tcp:8081 tcp:8081` 提供。
- `adb shell input text` 支持中文直输（MuMu 无软键盘场景可用）；阶段2 曾遇 adb server 5037 被占死，`Stop-Process` 杀 wedged 进程后重连恢复（详见 phase2 §六）。
- **模拟器侧 uimode 定时翻转**：阶段3 验收中（17:40–17:43 之间，无任何本侧命令触发）系统夜间模式被模拟器自行翻回 `night=yes`（`settings get secure ui_night_mode`=2）。应用按 `useColorScheme()` + manifest `configChanges uiMode` **实时跟随换肤未重启**——反手成为 §7.36 主题实时跟随的旁证。真机验收时若遇「截图突然变夜间」，先查 `cmd uimode night` 再怀疑应用。
- 测试用库内有用户真实数据（吃饭 19:13、12月/2027年1月空分组）——清理纪律：只删自建条目（本切片创建的「开会」已删），设置值还原（小组件 4 开关、认真模式、标签展示样式均回原值）。

## 二、数据库 / 构建事实

- schema v11→v12：`app_settings` addColumns `careful_mode`（boolean，默认 false，旧行回退 false），迁移追加不改已发布 step（§4 契约）。真库实测：阶段2 MuMu 启动日志 `Migrating from version 11 to 12... Migration successful`。
- 无新增依赖；未触碰 Babel/WatermelonDB/expo-build-properties 等受保护构建配置；`src/notifications/` 冻结区未动。
- `npx expo-doctor`：16/18 通过，2 失败均为预存基线（android/ CNG 同步提示 + RN Directory 元数据缺失：`@nozbe/watermelondb`、`widget-snapshot-store`、`battery-optimization`、`@nozbe/simdjson`），无新增失败项。
- 产物：`life-0.23.0-v10.apk`（阶段1 出的 dev build，仓库外文件，未入库）。

## 三、代码地图（相对 main `3685e52`，28 文件 +1844/−52）

域层（纯 TS，无 RN/DB 依赖）：
- `src/domain/ai/chat.ts`：标题保护三支判定落点（编辑词轮 / 澄清续答轮走标题继承；**全新意图不复用上一张卡标题**——修复切片 23/24 误留旧标题缺陷，§7.37 域规则）。
- `src/domain/ai/editIntent.ts`：`EDIT_VERB_PATTERN`（改成/换到/修改成…后跟时刻才算编辑词）——「地点在第六会议室」类内容补充不命中编辑词。
- `src/domain/ai/editDiff.ts`（新增，151 行）：草稿 diff（titleChanged/contentChanged/timeChanged），守卫的对比基线。
- `src/domain/ai/prompt.ts`：远端 prompt 同语义注记（1 行）。
- `src/domain/settings.ts`：`careful_mode` 读写 + 守卫谓词消费面。

数据层：
- `src/db/schema.ts` / `src/db/migrations.ts` / `src/db/models/AppSettingsModel.ts`：v12 列与迁移。
- `src/data/WatermelonItemRepository.ts`：settings 透传（+16 行）。

UI 层：
- `src/ui/useFlashChat.ts`（阶段2 主战场，+283 行）：`carefulMode` 读取；`runFlashTurn` 末尾守卫（turnStartDraft 非空非澄清 && (titleChanged||contentChanged) && carefulMode && isEditTurn → `pushConfirm` 拦截，不出新卡）；`isEditTurn = matchesEditIntent(input) || !diff.timeChanged` 代理谓词（hook 层拿不到 `parsed.expressed`，见 §五遗留1）；`applyConfirm`/`dismissConfirm`/`applyEdit`/`confirmSave` 入口取消 pending；**`postponeCard`（+15分钟/+1小时）是唯一 busy=true 且不取消 pending 的路径**；消息 id 全部在 `setMessages` updater 外捕获常量（真机撞号修补，phase2 §六）。
- `src/ui/FlashConfirmCard.tsx`（新增）：纯展示确认卡（「修改需要确认」+ 拟改字段 旧→新 摘要 + 应用修改/放弃修改 chips）；`disabled` → chips opacity 0.5 + textMuted；`resolved` → chips 隐藏；全 Token（§7.36）。
- `src/app/(tabs)/flash.tsx`：确认卡 `disabled={chat.busy}` 接线（:131-139）；保存按钮 busy「保存中…」（:197-202）。
- `src/app/(tabs)/profile.tsx`：认真模式行（:402-415）+ 小组件 4 开关行（:460-465）；两区块共用 `settingsSavingKey` 互斥（:199/:227 早退闸门；乐观更新→updateSettings→失败回滚）——原 `widgetSavingKey` 改名扩权（phase2 §三.4：app_settings 单行读改写，跨区块并发写会丢字段）。

测试（+873 行）：`migrationsV12.test.ts`（新增 144）、`editDiff.test.ts`（新增 145）、`useFlashChat.test.ts`（+442，含 StrictMode id 唯一性 3 用例）、`chat.test.ts`（+86）、`categorySettings.test.ts`（+60）及版本号迁移固定账单（migrationsV8/V9/V11、seedPreset、viewQueries、ReminderScheduler stub 各 ±1-12 行）。

## 四、踩坑教训（索引汇总，正文见各反馈文件）

阶段1（`tasks/slice-25-phase1-feedback.md` §六）：
1. 既有测试是契约的活文档——任务卡谓词先跑全量相关测试，红用例暴露任务卡与 ai.md 语义冲突。
2. 「例行更新」守卫测试是版本号迁移的固定账单——SCHEMA_VERSION 递增牵动 4 个 db 套件 + 全量 settings toEqual + 通知 stub。

阶段2（`tasks/slice-25-phase2-feedback.md` §七）：
3. `setMessages` updater 必须纯函数、id 在 updater 外捕获——React 18 并发重放撞 id，jsdom 测不出，logcat 是唯一观测面。
4. `jest.clearAllMocks` 不清 `mockImplementation`——跨 describe 共用 mock 时 beforeEach 显式复位默认 implementation。
5. 断言 helper 提升到模块级（describe 分块追加时的固定坑）。

阶段3（新增，本次验收首现）：
6. **MuMu 抓不到 <150ms 的 UI 瞬态**：`screencap` 单帧 ~200ms、`screenrecord` 实测仅 ~6fps（3.03s/18 帧），连拍/录屏均无法定格「保存中 Switch disabled」这类亚帧窗口；改用「代码闸门 + 跨区块功能回归 + 重启持久化」三重证据替代视觉帧（见 §五遗留3）。Pillow（bundled runtime）逐像素对比 mb_1/mb_8 开关区域（maxdiff=0）是判定「视觉不可辨」的干净手段。
7. adb shell 内 for 循环变量 `$i` 必须用单引号包整条 shell 命令，双引号会被本地 bash 先展开为空 → N 张截图写同一文件。

## 五、遗留披露

1. **isEditTurn 代理谓词两边界**（`src/ui/useFlashChat.ts`，phase2 §三.2，均为设计代价非缺陷）：① 远端路径一轮同时改时间+标题/内容 → 被判全新意图**不拦**（误放行 = 切片 24 旧行为）；② 同时间重述 + 新标题 → **误拦**（可「放弃修改」恢复）。根因是 hook 层拿不到 `parsed.expressed`；是否把 expressed 集合上收 hook 层见 backlog 候选④。
2. **保存后上下文重置**（切片 22 设计：保存后 `historyRef=[]`+`draftRef=null`；phase2 §六用户报告场景）：已保存条目 AI 上下文清零，content/category/tags 的对话式修改会新建条目；目前仅窄规则时间修改与快捷顺延可用。候选处置①②③已登记 backlog（来源：slice-25-phase2-feedback §六）。
3. **观察点③「保存中 Switch disabled」瞬态视觉未留证**（非缺陷）：互斥逻辑回归以证据链覆盖——代码闸门（profile.tsx:199/227/414/465 全部绑定 `settingsSavingKey`，仓库内 0 处 `widgetSavingKey` 残留）、跨区块连续翻转功能正常无卡死、force-stop 重启持久化一致。RN Switch 文档表明 disabled 渲染半透明（Switch.js L93），但 MuMu 帧率不足以定格该亚帧窗口（§四.6）。若后续需要视觉证据，须真机高帧率录屏或降速存储路径，均超出本切片范围。
4. 其余无遗留：本阶段 logcat 0 次 same key / FATAL / Uncaught / RN JS Error；§三 偏差 1/3/4 均已随实现注释入库；无未消化缺陷。

## 六、终态验收（阶段3 实测，2026-11-16 17:5x）

| 命令 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | **0 错** |
| `npx jest --runInBand` | **79 套件 / 1087 用例全过**（基线 79/1087，只增不减达标） |
| `npx expo-doctor` | 16/18，2 失败 = 预存基线，无新增 |
| MuMu 观察点① | 深浅色确认卡各验一次（08-intercept / 09-confirm-light），两态可读，切换 night 不重建 Activity、pending 原地保留 |
| MuMu 观察点② | busy 窗口三帧序列（burst_1 可用 → burst_2 chips 禁用+保存中+发送禁用 → burst_8 恢复）；+15分钟两次生效且 pending 不被取消（postpone 设计） |
| MuMu 观察点③ | 见 §五.3（视觉瞬态不可达，互斥以三重证据为证） |
| MuMu 观察点④ | 小组件开关区块（settingsSavingKey）乐观翻转→保存→无卡顿；force-stop 重启后 过期项/待办项/分类图标/认真模式 四值与重启前一致；测试值已还原 |
| 数据清理 | 「开会」条目已删；设置值全部还原；logcat 无异常 |

（真机（物理设备）验收：阶段2 矩阵 6 条已由用户在真机完成并报告缺陷（已修补，见 phase2 §六）；阶段3 观察点在 MuMu 补齐，无新增真机项。）

# 切片 16 · 阶段 1 反馈总结（数据底座与迁移）

- 日期：2026-11-11
- 阶段：Phase 1 / 4（数据底座与迁移）
- 分支：`task/slice-16`（基点 main @ dfc5e34）
- 阶段提交：`d9ac728 feat(s16): 阶段1数据底座——schema v7→v8 加 once_civil_json/channel/channel_config + 领域与 Repository 映射 + 迁移/读写单测`（15 文件，+1033/-18；另有 5260c3a 立项提交在先）
- 状态：✅ 完成（含真机覆盖安装验收），已暂停等待阶段 2 确认

## 一、成果定性：达标，可进入阶段 2

阶段 1 的目标是为「一次性提醒 + 多渠道」打数据地基，交付质量用三个硬指标背书：

| 维度 | 结果 |
| --- | --- |
| 类型安全 | `npx tsc --noEmit` 0 error |
| 测试 | `npx jest --runInBand` 54 套件 / 686 用例全过，其中新增 20 个用例专测本阶段行为（迁移结构 + once 读写 + 防御读） |
| 提交 | `d9ac728`，15 文件 +1033/-18，v2–v7 历史 migration step 未动一行 |
| 真机验收 | MuMu 覆盖安装 migration v7→v8 实际执行，channel 回填断言全过（见 §六） |

架构上最重要的两个决策都按提案落地（docs/proposals/slice-16-reminder-channels.md）：

1. **once_civil_json 单列 JSON**（提案 §2.2 拍板，否决 5 列 INTEGER 方案）——固定键序 `{year,month,day,hour,minute}` 民用时刻，按 tzid 解释；序列化/解析各只有一个出入口（serializeOnceCivilJson/parseOnceCivilJson）。
2. **channel 非空列 + 迁移事务内回填**——addColumns 自动零值 + 同迁移 `UPDATE "reminders" SET "channel" = 'system-notification';`，真机实测两条存量行回填正确；读取层防御兜住一切脏数据。

## 二、做得好的三点

1. **防御读路径有专门单测，而不是只写在注释里**。库中 `channel=''`（正是 LokiJS 忽略 sql 步骤会产生的形态）与 `'bogus'` 场景，通过「经 model 直写脏数据再读」的夹具真实覆盖：回退默认渠道不抛错；`once_civil_json='not-json'` 则明确抛错不静默（对齐 weekdays 纪律）。测试盲区（lokijs 不跑 UPDATE）与防御手段一一对应。
2. **升级/全新安装两条路径同源断言**。migrationsV8.test.ts 同时断言 migration 链结构（addColumns 三列属性 + 回填 SQL 原文逐字符匹配）与 schema.ts 的列声明（appSchema map），加上 seedPreset 结构测试同步到 v8——三处任一漂移即红。
3. **类型纪律零妥协**：测试构造契约外值全部用 `JSON.parse('"bogus"')` 赋给类型化变量（any→类型赋值），无一处 `as`；once 必填由 Repository 写路径 `resolveOnceAt` 运行时强制而非拆判别联合，避免阶段 1 提前触碰 `src/domain/ai/mapper.ts`（阶段 3 文件）。§7.26「数据模型与调度器分两次提交」已兑现第一次，冻结区 src/notifications/ 未动。

## 三、过程中暴露的问题（均已修复，留作教训）

1. **lokijs 测试适配器静默忽略 `sql` 迁移步骤**（slice-14 同款教训重现）——行为级回填验证单测不可能，结构断言 + 真机覆盖安装兜底，且本轮把脏数据场景本身做成了防御读单测。教训沿用：测不到的路径必须显式声明验收手段。
2. **扩冻结枚举的穷举消费者涟漪**：frequency 加 `'once'` 使两处穷举消费编译失败（`src/app/debug-reminders.tsx` 的 `Record<ReminderFrequency,string>` 标签表、`src/ui/timeFormat.ts` 的穷举 switch）。grep 全库确认其余 42 处 frequency 匹配均为冻结 `RecurrenceRule` 三值或非穷举 if 链。教训：扩枚举先 grep `Record<枚举` 与 switch 穷举点。
3. **jest 5 失败全为测试预期问题**（实现行为本身正确）：①错误消息用 `String(raw)` 格式化，字符串值不带引号（`got year: 2026`）；②tzid 白名单文案是 `tzid "..." is not supported`，无 "timezone" 字样；③`minVersion` 语义：最早 step 是 toVersion 2 → minVersion=1；④seedPreset 结构测试钉死 v7 需连带更新 v8。教训：写正则断言前先看一眼实现的确切文案与既有注释。
4. **真机拉库方法论升级**（Windows + MuMu）：force-stop 是 SIGKILL，WAL 不 checkpoint——必须 `life.db`/`-wal`/`-shm` 三件套一起拉再本地 sqlite3 重放（本次 WAL 有 1.3MB 未合并数据），单拉主文件=空壳假象；Windows 原生 Python 不认 MSYS `/tmp` 路径（`sqlite3.connect('/tmp/...')` 静默新建空库），必须传 Windows 路径；`python -c` 多行字符串会被执行环境破坏，一律 heredoc。
5. **expo-doctor@1.21.7 上游坏包**：2026-11-11T09:48:40Z 发布，构建产物顶层 `require('@expo/env')` 但 package.json 零 dependencies（npmjs/npmmirror 元数据一致，属上游坏发布非镜像问题；npx 清缓存/换 registry 均无效）。上游修复前钉 `npx -y expo-doctor@1.21.6`（16/18，2 失败=slice-14/15 预存基线，零新增）。

## 四、契约合规与遗留风险（按优先级）

1. 任务卡阶段 1 两项验收**全部闭环**：tsc/jest 全过；覆盖安装后旧 reminders channel='system-notification'（§六实证）。
2. **契约文档已随阶段提交**：data-model.md 追加 v0.16 节（frequency 三值→四值扩展声明、schema v7→v8、once 语义含「规则列占位零值不承载语义」「调度器不得解析 once_civil_json 以外字段推断时刻」、渠道语义、防御读、回滚=丢弃新列）；notifications.md 的 occurrenceKey once 规则按计划留阶段 2 追加。
3. **once→重复频率切换未传时刻时规则列落占位 00:00/[]/0**（NOT NULL 列约束）——阶段 3 UI 引导补齐；调度器侧消费前的判别以 frequency 为准（契约已写明）。
4. **导出 JSON 零变化**：`toReminderSummary` 是白名单式导出，未新增字段——比实施计划披露的 additive 更干净，无导出兼容问题。
5. **expo-doctor 1.21.7 坏包**：验证命令暂按 `npx -y expo-doctor@1.21.6` 执行，待上游修复恢复 latest。
6. debug-reminders 页列表行暂不显示 channel/onceAt（本阶段证据走 DB 层，阶段 3 UI 落地后自然覆盖）；闪电添加 `reminderOffsetMinutes` 仍降级为提示（阶段 3 改 savePlan）。

## 五、给阶段 2 的一句话建议

数据层已闭环（单测 + 真机迁移 + 防御读），阶段 2（调度器渠道抽象）可放心消费 `Reminder.onceAt/channel/channelConfig` 与 `DEFAULT_REMINDER_CHANNEL/REMINDER_CHANNELS/isReminderChannel`；occurrenceKey 按提案 §2.3 建议 `once:<reminderId>:<onceAt epoch>`，tzid 白名单已在数据层对 once 强制，阶段 2 无需重复校验。

## 六、真机覆盖安装验收记录（2026-11-11，MuMu 模拟器）

**环境**：MuMu（adb emulator-5554；7555/16384 同实例僵尸传输已清理）、Oracle JDK 17.0.10、Gradle 8.14.3 增量构建 1m11s（454 tasks，34 executed / 420 up-to-date）、`./gradlew.bat installDebug`（= `adb install -r`，数据保留）+ Metro 8081 常驻 + `adb reverse`。

**升级前基线**（v7 安装，启动 App 前拉库实证）：`user_version=7`；reminders 16 列（无 once_civil_json/channel/channel_config）；存量 2 条提醒 `6s3lkcVgSJM8aFJX`（daily 10:00）与 `MVh9VeHCK5GKJBiP`（daily 09:00），均 enabled。

**升级后断言（7/7 通过）**：

| # | 断言 | 结果 |
| --- | --- | --- |
| 1 | `user_version` 7 → **8** | ✅ |
| 2 | reminders 16 → **19 列**，once_civil_json/channel/channel_config 齐 | ✅ |
| 3 | 存量行 channel 全部 = **'system-notification'**（回填 SQL 生效） | ✅ |
| 4 | 存量行 once_civil_json / channel_config 均 NULL | ✅ |
| 5 | 原有数据零丢失（id/frequency/时间/enabled 与基线快照一致） | ✅ |
| 6 | 重启 App 进程存活（pid 58380），logcat 无 FATAL | ✅ |
| 7 | 迁移确由新 bundle 触发（启动前 7 → 启动后 8） | ✅ |

**补充事实**：
- SQLite `ALTER TABLE ADD COLUMN` 把新列追加在**表尾**（updated_at 之后），与 schema.ts 声明序（enabled 之后）不同——SQLite 正常行为，列序不承载语义，WatermelonDB 按列名映射。
- 拉库证据法：debug-reminders 页不显示 channel，直接拉库对照（安装前/后各一次）；拉取必须三件套 + WAL 重放（§三.4）。
- 全新安装路径由 migrationsV8.test/schema 断言覆盖；未在真机做全新安装（会清掉旧数据基线，不值得）。
- LokiJS（仅测试适配器）忽略 sql 步骤——后续阶段若再动 migrations，需重跑本节拉库对照。

## 附：阶段 1 修改文件清单

- **核心实现**：`src/db/schema.ts`（v8）、`src/db/migrations.ts`（v8 步骤，历史 step 未动）、`src/domain/reminder.ts`（once/渠道类型）、`src/data/reminderRuleMapping.ts`（once/渠道归一 + serialize/parseOnceCivilJson + resolveOnceAt）、`src/data/WatermelonItemRepository.ts`（读写映射 + 防御读）、`src/db/models/ReminderModel.ts`（3 新列）、`src/ui/timeFormat.ts`（once 摘要不渲染占位 00:00）、`src/app/debug-reminders.tsx`（标签表补 once）
- **测试**：新增 `src/db/__tests__/migrationsV8.test.ts`、`src/data/__tests__/reminderOnce.test.ts`；扩展 `src/data/__tests__/reminderRuleMapping.test.ts`；夹具/结构测试同步 `src/domain/__tests__/export.test.ts`、`src/notifications/__tests__/ReminderScheduler.test.ts`、`src/db/__tests__/seedPreset.test.ts`（§7.13 编译必需）
- **文档**：docs/contracts/data-model.md（v0.16 节）、本文件

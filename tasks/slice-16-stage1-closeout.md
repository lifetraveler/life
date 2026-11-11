# 切片 16 阶段 1 收尾移交（closeout）

- 切片：task/slice-16（提醒能力升级：一次性提醒 + 多渠道）；本文档只覆盖**阶段 1：数据底座与迁移**
- 完成日期：2026-11-11
- 分支基点：main@dfc5e34
- 提交区间：5260c3a（立项落地）→ d9ac728（阶段1数据底座）→ 本 closeout 提交
- 阶段 1 验收：**1（tsc/jest 全过）与 2（覆盖安装后旧 reminders channel 回填）均通过**（证据见下）
- 后续阶段（2 调度器渠道抽象 / 3 UI / 4 联调）未开始，待用户根据本 closeout 决策

## 环境事实

- 构建链沿用 slice-15 closeout 结论，无变化：`cd android && JAVA_HOME=D:\enviroment\java\jdk\oracle-jdk-17.0.10
  ANDROID_SERIAL=emulator-5554 ./gradlew.bat installDebug`；Metro `8081` 常驻 +
  `adb reverse tcp:8081 tcp:8081`；`adb shell monkey -p com.vibecoding.life 1` 启动。
- adb 多传输（7555/16384 与 emulator-5554 同一 MuMu 实例）开工前重新 disconnect 清理，gradle 枚举不乱。
- **expo-doctor 上游坏包事件（重要）**：`expo-doctor@1.21.7` 于 2026-11-11T09:48:40Z 发布，
  构建产物 `build/index.js` 顶层 `require('@expo/env')` 但 package.json **未声明任何 dependencies**
  （npmjs 与 npmmirror 元数据一致，属上游坏发布而非镜像问题）；`npx expo-doctor`（默认 latest）
  必然 MODULE_NOT_FOUND 崩溃。**上游修复前一律钉版本 `npx -y expo-doctor@1.21.6`**。
  本阶段 1.21.6 结果：16/18，2 失败 = slice-14/15 已记录的预存基线（non-CNG app config sync 提示 +
  WatermelonDB/simdjson RN Directory 元数据），零新增问题。
- Windows 原生 Python（3.11.5，sqlite3 3.42.0）可用作 DB 检查工具，但有三条使用纪律（见踩坑）。

## 数据库/构建事实

- **无新表**（reminders 表加 3 列），未触发 §5 新表验收条款；schema v7→v8 migration 实测执行。
- **DB 调试拉取流程升级（替代 slice-15 的单文件拉取）**：force-stop 是 SIGKILL，WAL 不会 checkpoint，
  只拉 `life.db` 主文件得到的是空壳（user_version=0、无表）。必须**三件套一起拉**：
  `life.db`、`life.db-wal`、`life.db-shm` → 本地同目录同名放置 → Python `sqlite3.connect` 打开时自动重放 WAL。
  本次 WAL 有 1.3MB 未合并数据，主文件单独读会完全误导。
- DB 位置不变：app 数据根 `./life.db`（`databases/` 目录只有 google datatransport，非本项目）。
- 覆盖安装语义验证：`installDebug` 为 `adb install -r`，应用数据保留，重启后 migration 从 v7 升到 v8。

## 阶段 1 真机验收实证（MuMu，2026-11-11）

覆盖安装前后同库对照（拉库流程见上；schema v8 前后各拉一次）：

| 检查点 | 安装前（v7 基线） | 安装后（v8） |
| --- | --- | --- |
| PRAGMA user_version | 7 | **8** |
| reminders 列 | 16 列，无新 3 列 | **19 列**，追加 once_civil_json / channel / channel_config |
| 存量行 6s3lkcVgSJM8aFJX（daily 10:00） | — | channel=**'system-notification'**，once_civil_json=NULL，channel_config=NULL |
| 存量行 MVh9VeHCK5GKJBiP（daily 09:00） | — | channel=**'system-notification'**，once_civil_json=NULL，channel_config=NULL |
| 原有数据 | id/frequency/time/enabled | **完好无损**（对照安装前快照） |
| 重启 App | — | 进程存活（pid 58380），logcat 无 FATAL |

注意：SQLite `ALTER TABLE ADD COLUMN` 把新列追加在**表尾**（updated_at 之后），与 schema.ts
声明序（enabled 之后）不同——属 SQLite 正常行为，列序不承载语义，WatermelonDB 按列名映射。

## 代码地图（阶段 1，15 文件）

| 层 | 文件 | 说明 |
| --- | --- | --- |
| schema | src/db/schema.ts | SCHEMA_VERSION 8；reminders 加 3 列 |
| migration | src/db/migrations.ts | toVersion 8：addColumns×3 + UPDATE 回填 channel='system-notification' |
| domain | src/domain/reminder.ts | frequency+'once'；ReminderChannel 四值/DEFAULT/isReminderChannel/OnceCivilTime |
| mapping | src/data/reminderRuleMapping.ts | once 归一占位零值；serialize/parseOnceCivilJson/resolveOnceAt/normalizeReminderChannelFields |
| repository | src/data/WatermelonItemRepository.ts | 读写映射 + 防御读（非法 channel 回退默认、坏 JSON 抛错） |
| model | src/db/models/ReminderModel.ts | 3 新列装饰器 |
| UI（编译必需） | src/ui/timeFormat.ts、src/app/debug-reminders.tsx | frequency 穷举补 once；once 摘要不渲染占位 00:00 |
| 契约 | docs/contracts/data-model.md | v0.16 节（frequency 四值/schema v8/once 与渠道语义/防御读/回滚） |
| 测试 | src/db/__tests__/migrationsV8.test.ts（新）、src/data/__tests__/reminderOnce.test.ts（新）、reminderRuleMapping.test.ts（扩展） | 20 新用例；夹具/结构测试同步（§7.13） |

## 踩坑教训

1. **Python on Windows + MSYS bash 路径陷阱**：`sqlite3.connect('/tmp/x.db')` 在原生 Python 下
   指向不存在的 `X:\tmp\x.db` 并**静默新建空库**——看似"拉库成功实则全空"的假象。必须传
   Windows 路径（如 `C:/Users/<user>/AppData/Local/Temp/x.db`）；bash 内 `cd /tmp` 也不会传递给原生子进程；
   `python -c "多行字符串"` 会被执行环境破坏（出现 cmd 残句），一律改用 heredoc。
2. **WAL 三件套**：见数据库事实节；单拉主文件 = 空壳假象。
3. **expo-doctor 1.21.7 坏包**：npx 缓存清理/换 cache/换官方 registry 均无效（根因在上游包本身），
   排查时不要在这三条路上浪费轮次；直接钉旧版本。
4. 测试预期两处对齐实现修正（阶段 1 汇报已披露）：`assertOnceCivilTime` 错误消息用 `String(raw)`
   格式化（字符串值不带引号）；tzid 白名单文案是 `tzid "..." is not supported`（无 "timezone" 字样）。
5. minVersion 语义：最早 step 是 toVersion 2 → minVersion=1（seedPreset.test.ts 有注释，写迁移结构测试时先看它）。

## 遗留披露

1. 阶段 2（调度器渠道抽象）/ 阶段 3（UI）/ 阶段 4（联调）未做；冻结区 src/notifications/ 仍待第二次提交。
2. LokiJS（仅测试适配器）忽略 'sql' 迁移步骤——单测无法真验回填 SQL，本阶段已用真机覆盖安装兜底闭环；
   后续阶段回归时若动 migrations，需重跑本 closeout 的拉库对照（或至少 user_version + 回填抽查）。
3. once→重复频率切换未传时刻时规则列落占位 00:00（阶段 3 UI 引导补齐）。
4. debug-reminders 页列表行暂不显示 channel/onceAt（DB 级证据已足够本阶段验收；阶段 3 UI 落地后自然覆盖）。
5. expo-doctor 1.21.7 坏包待上游修复；修复前验证命令按 `npx -y expo-doctor@1.21.6` 执行。
6. 闪电添加 `reminderOffsetMinutes` 仍不落库 once 提醒（savePlan 降级提示），属阶段 3 范围（ai.md v0.16 契约不变）。

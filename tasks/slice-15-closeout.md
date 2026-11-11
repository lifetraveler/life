# 切片 15 收尾移交（closeout）

- 切片：task/slice-15（闪电添加：AI 解析层 + 设置页 AI 配置 + Chat UI 状态机 + 真机验收）
- 完成日期：2026-11-11
- 分支基点：main@041e086
- 提交区间：a6fa241（阶段1）→ 566d3fb（阶段1收尾）→ 2a05786（阶段2+3）→ 本 closeout 提交
- 真机验收：2026-11-11 用户确认 A~E 全部通过

## 环境事实

- Windows 原生；npm；分支 task/slice-15；remote origin=https://github.com/lifetraveler/life.git
  （备用 origin-ssh）。push 沿用切片 14 结论：须显式
  `git -c http.proxy=http://172.16.100.254:7893 -c http.version=HTTP/1.1 push`。
- **MuMu 模拟器构建链（重要，后续切片沿用）**：
  - expo CLI `run:android` 对 MuMu 存在硬伤：getDevicesAsync 对每个 emulator-* 传输执行
    `adb -s <id> emu avd name`，MuMu 无标准 AVD 控制台（127.0.0.1:5554 拒绝）→ spawnAsync 抛错，
    `--device` 指定 TCP id 也一样在枚举阶段崩。**绕开方案**：
    `cd android && JAVA_HOME=<jdk17> ANDROID_SERIAL=emulator-5554 ./gradlew.bat installDebug`。
  - JAVA_HOME 用 `D:\enviroment\java\jdk\oracle-jdk-17.0.10`（Temurin 17.0.21 路径也可）；
    环境变量里注册的旧 JAVA_HOME（C:\code\runtime\java\jdk\jdk-17.0.8.1-full）已失效。
  - adb 双份：C:\software\platform-tools\adb.exe（命令行）与 D:\Android\Sdk\platform-tools\adb.exe
    （gradle/expo 用）。MuMu 12 的 7555/16384 端口与 emulator-5554 是同一实例的三条传输，
    已 disconnect TCP 只留 emulator-5554，避免 gradle 枚举混乱。adb server 卡死时
    PowerShell `Stop-Process` 杀进程重启恢复。
  - Metro：`npx expo start --dev-client --port 8081`（后台长驻）；配
    `adb -s emulator-5554 reverse tcp:8081 tcp:8081`；启动 App 用
    `adb shell monkey -p com.vibecoding.life 1`。
- 依赖变化：新增 `expo-secure-store ~15.0.8`（package.json:36；app.json:65 注册 config plugin）。
  无其他新依赖（AI 层零依赖——手写类型守卫，未引 Zod）。

## 数据库/构建事实

- **无 schema 变更**（本切片不动 WatermelonDB 表结构；提醒落库用既有 reminders 表）。
- DB 文件实际位置：app 数据根 `./life.db`（**不在 databases/**），WAL 模式，包名 com.vibecoding.life。
- 调试拉库（WAL 一致性）：先 `am force-stop com.vibecoding.life` 再
  `adb -s emulator-5554 exec-out run-as com.vibecoding.life cat ./life.db`，
  否则 WAL 重放报 `database disk image is malformed`；拉完 monkey 重新拉起。
- `npx expo-doctor`（收尾 2026-11-11）：16/18，2 失败为**预存基线**（non-CNG app config sync 提示 +
  WatermelonDB/simdjson RN Directory 元数据，slice-14 closeout 已记录），非本切片引入，
  expo-secure-store 未被标记。
- 验证命令：`npx tsc --noEmit` 零错误；`npx jest --runInBand` **52 套件 / 648 用例全过**
  （619→640（阶段3）→648（v0.16 wire 套件））。

## 代码地图

| 层 | 文件 | 说明 |
| --- | --- | --- |
| 契约 | docs/contracts/ai.md | v0.15→v0.15.1（tags/priority）→v0.16（民用时间 wire + 一次性提醒降级专节） |
| AI 域 | src/domain/ai/types.ts / errors.ts | ChatMessage/AiParseContext/ParsedItemDraft；AiParseError 六类 |
| AI 域 | src/domain/ai/guard.ts | isParsedItemDraft 严格守卫；isRecurrenceRule（v0.16 起导出复用） |
| AI 域 | src/domain/ai/prompt.ts | 系统提示词 + buildNowFacts（v0.16：民用字段定义，禁毫秒时间戳） |
| AI 域 | src/domain/ai/localFallback.ts（~700行） | 槽位解析器（span 互斥）；parseSlots 返回 expressed 掩码；export parseChineseNumeral/nextOccurrenceInstant |
| AI 域 | src/domain/ai/merge.ts | mergeDraftCorrection（expressed 掩码逐字段合并，多轮纠错核心） |
| AI 域 | src/domain/ai/chat.ts | runFlashTurn：无 Key 降级/远程/异常降级，historyAppend |
| AI 域 | src/domain/ai/savePlan.ts | buildFlashSavePlan：itemInput(§4.24 归一)/timePatch/tagNames/reminderPlan/reminderNotice |
| AI 域 | src/domain/ai/openAiCompatible.ts | Provider + testConnection + **isRemoteDraftWire/wireToParsedItemDraft（v0.16）** + 重复项本地重算 |
| AI 域 | src/domain/ai/configStore.ts | AiProviderConfig/AiConfig/守卫/AiConfigStore 接口，单键 'ai_provider_config_v1' |
| 数据 | src/data/SecureAiConfigStore.ts | expo-secure-store 实现，损坏→null 绝不抛错 |
| UI | src/app/settings/ai.tsx | AI 配置页（保存/测试连接/清除，Key secureTextEntry） |
| UI | src/app/(tabs)/flash.tsx | Chat 消息列表 + 预览卡片 + 确认添加 + 修改字段 |
| UI | src/ui/useFlashChat.ts | 状态机 hook；**每次 send 前重载配置**（阶段4修复） |
| UI | src/ui/FlashPreviewCard.tsx / FlashEditModal.tsx | 卡片展示（describeDraftTime/describeRecurrenceRule）/编辑弹窗 |
| UI | src/app/item/[id].tsx | local 条目新增「删除记录」按钮（复用切片 8 删除链路） |
| 导航 | src/app/(tabs)/profile.tsx、src/app/_layout.tsx | AI 配置入口 + Stack.Screen 注册 |

## 真机验收实证（阶段 4，MuMu）

- A 无 Key 降级 + 多轮纠错；B 设置页保存/测试连接/重启保留；C 有 Key 解析+纠错；
  D 卡片编辑+确认落库（标签经 addTagToItem 落库）+ 一次性提醒降级提示；E 重复项建每日提醒。
- **验收中发现并修复的缺陷**（教训记录）：
  1. flash Tab 先于设置页挂载 → useFlashChat 只在 mount 读一次配置导致“已保存仍提示未配置”
     → 改为每次 send 前 load（设置页保存/清除即时生效）。
  2. **LLM 直接输出毫秒时间戳不可靠**（E.13 日程查不到新建项的根因）：DB 实证三种失败模式——
     整年算错（“每天9点”→2025-11-12）、时区反算（“明早9点”→01:00，恰好 -8h）、
     照抄 history 上一轮旧值（“明早8点”与“明早9点”返回同一时间戳）。
     prompt 端锚点差值法仍无法消除 → 立变更提案（用户确认）→ **ai.md v0.16**：
     远端响应改民用时间 wire（{date:'YYYY-MM-DD',time:'HH:mm'|null}），epoch 一律
     resolveCivilTimeToInstant 本地换算；重复项 startAt 由 nextOccurrenceInstant 本地确定性重算。
     AiParser.parse 对外契约不变。
  3. 详情页 local 条目无删除入口（删除本地副本按钮只对 ics/system-calendar 渲染，切片 8 遗留）
     → 本切片补「删除记录」按钮。

## 遗留披露

1. **一次性提醒未落库**（已知限制，契约化于 ai.md v0.16）：reminderOffsetMinutes 且无
   recurrence 时不建 Reminder，卡片保留意图 + 确认后提示。真正落库 + 提醒渠道扩展
   （闹钟/系统通知/webhook/apprise）已立项切片 16（tasks/slice-16.md），涉及
   data-model.md/notifications.md 冻结区，须先过变更提案（docs/proposals/slice-16-reminder-channels.md）。
2. 卡片时间纠错的最后一道防线是卡片/弹窗可见可改；远程民用日期仍有小概率写错
   （LLM 民用算术可靠但非 100%），错误时间直接可见。
3. 重复项 + reminderOffsetMinutes 同时出现时：重复提醒照建，偏移分钟数暂不落库（契约已记）。
4. expo-doctor 2 失败为预存基线（见上），后续切片不要试图“修复”。
5. jest 测试路径含 Windows 反斜杠时需正则转义（`src\\domain\\ai`）。
6. localFallback 汉字数字/时刻归一化与 prompt 规则保持人工同步（两处规则表，改一处须同步另一处）。

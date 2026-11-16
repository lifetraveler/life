# 切片 26 阶段 1 反馈：AI 透明度——域层 usage 管道 + schema v13

- 日期：2026-11-16
- 阶段范围：Phase 1 / 共 3 —— 域层 usage 管道、schema v13（app_settings.show_ai_usage）、
  provider lastUsage 副通道、FlashTurnResult.usage 传输、单价配置守卫；全量单测。
- 分支：`task/slice-26`（基点 main @ `91ed33d`）
- 本阶段提交：`d44836b`（feat(s26): 阶段1 域层 usage 管道 + schema v13）—— 25 文件，
  +1137/-42 行（含任务卡 158 行与两个新测试套件）；本反馈文件以 docs(s26) 补充提交
  （§7.33 允许形式，slice-23/25 先例——反馈文件引用本阶段 hash 无法自含于该提交）。
- 状态：**暂停等待阶段 2**（AI 透明度 UI 三落点 + hook 接线）。遗留项：无阻塞项；
  UI 开关/提示词页/单价输入/用量行展示均属阶段 2，本阶段只交付数据管道。

## 成果定性

| 验证项 | 结果 | 基线对照 |
| --- | --- | --- |
| `npx tsc --noEmit` | 0 错 | 0 错 |
| `npx jest --runInBand` | **81 套件 / 1118 用例全绿** | 基线 79 / 1087，+2 套件 +31 用例，只增不减 |
| `npx expo-doctor` | 2 项失败 | 与预存基线完全一致（app config 同步检查 + RN Directory 元数据），无新增 |
| 真机/模拟器验收 | 本阶段不适用（纯域层+DB 结构，无 UI） | 真机矩阵 10 项在阶段 3 执行 |
| APK | 未交付（阶段 3） | — |

## 范围落点

| 文件 | 修补 | 解决的问题 |
| --- | --- | --- |
| src/domain/ai/usage.ts（新） | AiUsageSnapshot / AiUsagePrices / positivePriceOrNull / readAiUsageSnapshot / formatAiUsageLine | usage 信封 defensive 读取（形状偏差整体回退 null 不炸主链）、正数单价单一守卫实现、用量展示行缺段自动省略 |
| src/domain/ai/openAiCompatible.ts | OpenAiCompatibleConfig 加两单价字段；类加 lastUsage 只读 getter；parse 开头重置 + envelope 提取 + 成功路径赋值 | 每轮用量快照副通道；失败轮/畸形信封恒 null 不残留；recurrence 与普通 return 分支均在赋值点之后 |
| src/domain/ai/chat.ts | FlashTurnResult.usage 字段；fallbackTurn / 成功 return 接线 | 域内传输到 hook：远端成功携带、降级/无 Key 恒 null |
| src/domain/ai/configStore.ts | AiProviderConfig 加两单价可选字段；isAiProviderConfig 透传守卫 | 单价持久化（SecureStore 同路）；非正数丢弃不整包拒绝（旧配置兼容） |
| src/db/schema.ts | SCHEMA_VERSION 13；app_settings 末列 show_ai_usage（boolean 非可选） | v13 列声明，v12 careful_mode 同款先例 |
| src/db/migrations.ts | toVersion 13 单条 addColumns | 旧数据回退 false，零 unsafeExecuteSql / 零 UPDATE |
| src/db/models/AppSettingsModel.ts | @field showAiUsage | model 映射 |
| src/domain/settings.ts | AppSettings.showAiUsage + DEFAULT_APP_SETTINGS.showAiUsage=false | 域类型与默认值 |
| src/data/WatermelonItemRepository.ts | toDomainSettings 防御归一 + getSettings/updateSettings 三处写点 | 空库补插默认行、patch 建行、update 直通；非 boolean 读回 false |
| docs/contracts/ai.md | v0.20 非破坏性条目（usage 副通道 + 传输边界冻结 + 单价配置） | 头部 v0.17→v0.20 顺带修正（记录已到 v0.19 的文档缺陷，已报告后随本切片修正） |
| AGENTS.md | v0.28 §7.38（随阶段 1 提交，按计划） | 契约成文 |
| tasks/slice-26.md | 任务卡入库 | — |
| 测试 9 文件 | 新建 migrationsV13.test.ts（6 条）、usage.test.ts（18 条）；openAiCompatible +8 / chat +3 / configStore +3 / categorySettings +2；迁移四套件+seedPreset 版本例行 12→13；viewQueries/ReminderScheduler stub 跟改 | 全部新增行为有测试固化；基线失败 13→0 |

## 关键设计落点（阶段 2/3 消费面）

1. **hook 消费**：`runFlashTurn` 返回 `usage: AiUsageSnapshot | null`——阶段 2 在
   useFlashChat.send 成功分支读 `result.usage`，`formatAiUsageLine(snapshot)` 产出
   展示行（null 不展示；本地降级轮无 usage）。
2. **设置读取**：`AppSettings.showAiUsage`（boolean）+ `AiProviderConfig.priceInputPerMillion/priceOutputPerMillion`
   ——阶段 2 的 readTurnSettings 每轮重读（开关与单价即时生效），单价从
   configStore.load() 的 active 取。
3. **UI 落点**：profile.tsx 开关行（镜像 carefulMode 全套）+ ai-prompt.tsx 新页
   （AI_SYSTEM_PROMPT 静态串只读展示 + 动态部分注明）；ai.tsx 单价两输入框
   （正数有效，留空不估算）。
4. **estimatedCost 语义**：全价上界（不区分缓存折扣），Math.round 6 位小数，
   展示恒 toFixed(6)。

## 真机验收清单

阶段 1 无真机项；阶段 3 按任务卡 §3 矩阵 10 项执行（含 migration 实机升级路径
v12→v13 验证——LokiJS 结构断言不能替代真机 SQLite 升级，AGENTS §5）。

## 教训索引（closeout 时并入对应小节）

1. **批量 edit 多行锚点必须逐字核对缩进**：类字段/getter 与 updateSettings doc
   两处编辑首次失败均因锚点缩进/星号与文件实际不一致——重读后按实际缩进小锚点
   补齐。教训：跨行 old_string 先 grep/read 精确取样。
2. **版本号例行账单全数命中**：SCHEMA_VERSION 断言分布在迁移四套件+seedPreset
   （5 套件）、DEFAULT_APP_SETTINGS 形状 toEqual 在 categorySettings/viewQueries
   ——计划期 grep 实证的面与实际失败集合完全一致，无遗漏无意外。
3. **格式化行分隔符以实现为准写测试**：segments.join(' · ') 统一分隔符，
   测试期望手写时漏了 `）` 后的空格（2 处失败），对齐实现后全绿——展示格式
   细节应由实现单点决定，测试照抄实现输出。
4. **expo-doctor 基线对照有效**：v13 仅加列不建表，2 项预存失败无新增，
   符合 AGENTS §5「新增表」触发条件的判定（本切片未触发）。

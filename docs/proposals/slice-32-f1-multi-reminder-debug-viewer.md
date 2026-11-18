# 切片 32 变更提案：F1 多提醒修复（wire reminders 数组）+ AI 对话调试查看器

日期：2026-11-19
状态：待用户确认（确认后随阶段 1 一起提交）
涉及契约：docs/contracts/ai.md（v0.22 → v0.23，非破坏性）、AGENTS.md（§8 + 新 §7.44）
不涉及：repository.md / data-model.md / notifications.md / recurrence.md / ui.md 正文零改动

## 0. 背景与动机

**F1 真机缺陷**（tasks/feedback-log.md）：用户输入「明天8点、10点提醒」→ 卡片灰字
「提醒时刻已过去，未创建一次性提醒」，两条提醒均未落库。

三处结构性根因：
1. `RemoteDraftWire`（openAiCompatible.ts）只有 `reminderOffsetMinutes` /
   `reminderDelayMinutes` 两个**相对偏移**字段，没有**绝对时刻**提醒的表达；
2. `buildFlashSavePlan`（savePlan.ts:157-203）受「闪电落库一次只产一条计划」约束
   （即 backlog L5）：offset+delay 同现时只落一条、另一条仅披露；
3. 误判机制：模型把绝对时刻硬塞进提前量 → `fireInstant = startAt（全天 00:00）−
   offset ≤ now` → 「提醒时刻已过去」保护误触发。

**调试查看器动机**：F1 类缺陷排查需要看到 AI 输入请求体 / 原始响应 / 生成的卡片
数据。现有 `show_ai_usage`（v0.20）只展示 token 计数，无内容面。

## 1. 设计决策（用户已确认的默认值 + 本提案细化）

### 1.1 wire 层（v0.23）

- `RemoteDraftWire` 新增**可选键** `reminders?: RemoteDateTimeField[] | null`
  （民用时刻数组，`{date:"YYYY-MM-DD", time:"HH:mm"|"null"}`）。
- **缺省宽容**：键缺失 / null / [] → 无影响（v0.19 三字段先例：旧响应兼容）。
- **值出现即从严**（guard.ts「提醒数据是落库面，静默丢弃比报错危险」既有原则）：
  - 必须是数组；每条 `date` 合法且 **`time` 必须非 null**（提醒必带时刻，与
    start/end 的全天语义不同）；元素形状偏差 / 非数组 → `isRemoteDraftWire`
    返回 null **整体拒绝**；
  - 数组长度 ≤ **8**，超限整体拒绝（prompt 同步约束 ≤8）。
- `wireToParsedItemDraft`：每条 `resolveDateTimeField` 本地换算 epoch（v0.16 纪律：
  epoch 换算绝不交给模型）；**DST gap（resolve 返回 null）→ 丢弃该条，不炸整体**；
  换算结果**升序排序 + 同 epoch 去重**后写入草稿。

### 1.2 ParsedItemDraft / guard / merge

- `ParsedItemDraft` 新增可选键 `reminders?: number[]`（epoch 毫秒数组）。
- `isParsedItemDraft`：键可缺省（宽容）、出现即从严（数组、每项为有限正整数——
  epoch ms 由民用换算产生必为整数）。
- `merge.ts` `DraftField` 扩 `'reminders'`：掩码命中时防御拷贝、未命中沿用旧值
  （`reminderChannels` merge.ts:73-79 同款风格）。

### 1.3 savePlan 多计划（F1 修复 + L5 关闭）

`FlashSavePlan` 形状变更（消费方仅 useFlashChat.ts + cardPayload 链 + 测试）：

- `reminderPlan: ReminderPlan | null` → `reminderPlans: ReminderPlan[]`；
- `reminderNotice: string | null` → `reminderNotices: string[]`。

组装规则（全部 once 来源统一进入计划数组）：

| 来源 | 条件 | 行为 |
| --- | --- | --- |
| `draft.reminders` | 每条 epoch | `toOncePlan(epoch, tzid)`；epoch ≤ now → 不落库 + notice「提醒时刻已过去（民用时刻），未创建」（与既有 offset 保护同语义） |
| `reminderOffsetMinutes` | recurrence null 且非 null | 既有 `buildOnceReminderPlan` 逻辑原样（含「需设定时间」「已过去」两类 notice） |
| `reminderDelayMinutes` | recurrence null 且非 null | 既有 `buildDelayReminderPlan` 逻辑原样（含 delayAnchoredStartAt 锚定：仅 draft 无 startAt 时） |
| 强提醒锚点 | recurrence null 且 channels 非空且 offset/delay 均无 | 既有行为原样（startAt 处 once；无时间/全天披露） |

- **L5 关闭**：offset+delay 同现 → 两条各自落库、各自锚定、各自披露，删除
  「暂不支持一次创建两条提醒」降级文案。
- **跨来源去重**：全部 once 计划按 `startAt`（fireInstant）相同只落一条
  （防 reminders 条目与强提醒锚点同刻重复建提醒）。
- **recurrence 非空**：只落重复计划；reminders/offset/delay/channels 锚点全部
  不落库并逐条披露（既有 offset×recurrence 语义对齐扩展）。
- **渠道覆盖 / 预设回填**（savePlan.ts:210-249）：循环应用到每条计划；
  网络渠道缺预设的披露逐条判断（同文案，多渠道时合并一句）。

### 1.4 执行链（useFlashChat.ts confirmSave）

- `createReminder` **逐条 await**；单条失败 console.warn + 追加披露
  「第 N 条提醒创建失败：原因」，**不中断后续条目、不回滚 item**（备份恢复
  reconcile 失败仅披露先例）；
- `reminderScheduler.reconcile()` 保持成功后显式一次；
- `createdReminders: Reminder[]` 全量传入 `buildFlashCardPayload`。

### 1.5 卡片载荷

- `FlashCardPayload.reminder: FlashCardReminderSnapshot | null` →
  `reminders: FlashCardReminderSnapshot[]`（cardPayload.ts `buildFlashCardPayload`
  第 3 参 `reminder: Reminder | null` → `reminders: Reminder[]`）；
- card 消息为内存态（重启清空），无持久化兼容负担；
- FlashResultCard 提醒行：多条时合并渲染（如「提醒：明天 08:00、10:00
  （系统通知）」，渠道标签逐条）；快捷推迟 chips 对条目**全部 once 提醒**
  联动顺延（条目整体推迟语义）；
- FlashPreviewCard 预览行：draft.reminders 非空时渲染意图行
  （民用时刻逐条，换算用 context tzid）。

### 1.6 prompt（v0.23）

- 字段定义加 `reminders` 行（`reminderChannels` 行后）：
  「`reminders: [{"date":"YYYY-MM-DD","time":"HH:mm"}] | null，必填。用户指定
  『在某绝对时刻提醒我』（如『明天8点、10点提醒我吃药』）时逐条列出提醒时刻；
  相对词先换算绝对日期；最多 8 条；没有这类语义填 null。」
- 新增判定规则节（「延迟提醒判定规则」节后）：
  - reminders 与 start 语义独立、可同句出现（「明天早上8点提醒我吃药，下午3点开会」
    → start=明天15:00 + reminders=[明天08:00]）；
  - 多时刻逐条展开；
  - **禁止把绝对提醒时刻换算成 reminderOffsetMinutes / reminderDelayMinutes**
    （F1 根因的 prompt 侧封堵）；
  - 「提前X分钟」语义仍走 reminderOffsetMinutes，不写 reminders；
  - 重复提醒走 recurrence，不逐条展开进 reminders。
- `buildHistoryBriefing` / `renderBriefing`：摘要块加「提醒时刻」行
  （epoch 本地换算民用，多值顿号连接）；「history 草稿 JSON 仅供程序读取」条款
  扩展覆盖 reminders（禁止毫秒反算）。

### 1.7 AI 对话调试查看器

**存储（schema v15→v16）**：`app_settings` addColumns 两列
`show_ai_request` / `show_ai_response`（**非可选 boolean**，addColumns 既有行自动
回填 false，v12 careful_mode / v13 show_ai_usage 先例，零 UPDATE、零 unsafeExecuteSql）。
默认 false = 现状。读层无独立 parse 函数（boolean 无枚举语义，carefulMode 同款）。

**采集（provider 副通道，§7.38 同款纪律）**：
- `OpenAICompatibleProvider` 新增 `lastRequest: string | null` /
  `lastResponse: string | null`（getter `lastDebug`）；`parse()` 进入时清空
  （lastUsage 同款）；`requestParse` 每次尝试 fetch 前记录请求体
  `JSON.stringify({model, messages, temperature, stream})`、响应到达（含 HTTP 非 ok）
  后记录 bodyText；**每轮尝试覆盖（重试取最后一次），成功失败均可查看**；
- **请求头不采集**——Authorization 不进任何载荷；
- `FlashTurnResult` 新增域内字段 `debug: { request: string | null; response:
  string | null } | null`：远端轮恒携带（成功或失败降级——失败轮正是 F1 类
  排查主场景，与 usage「只报成功轮」刻意不同），无 Key 本地轮 null；
  **不进入 ParsedItemDraft、不进入 history JSON、不触碰 wire/guard**（ai.md
  v0.23 注记，§7.38 传输边界同款）。

**展示（hook + UI）**：
- `FlashChatMessage`（UI 层消息，非 domain ChatMessage）新增可选
  `debugPayload?: { request: string | null; response: string | null; draft: string }`；
  `draft = JSON.stringify(本轮解析草稿)`；开关全关时不采集不附加；
- 入口消息（复用用量行位置）：
  - 远端成功轮：`showAiUsage` 开 → 现状用量行（不变）；仅 debug 开关开 →
    「🔍 AI 调试：点击查看本轮 AI 输入/输出」；
  - 远端失败降级轮：任一 debug 开关开 → 「🔍 AI 调试：远端解析失败已降级（原因），
    点击查看请求/响应」；
  - 本地轮 / 全关 → 不 push（现状）；
- 弹层（flash.tsx 内 RN `Modal`，零新依赖）：三节「AI 输入（请求体）」/
  「AI 输出（原始响应）」/「卡片数据（草稿 JSON）」，ScrollView 只读展示；
  **request 节显隐随 `show_ai_request`、response/draft 节随 `show_ai_response`**
  （draft 由响应生成，同源）；开关即时生效（弹层按当下开关值显隐节）；
- settings/ai.tsx AI 透明度区块加两行 Switch + 说明文案（注明请求头不采集、
  开启后消息可点击）。

## 2. 影响范围

- **schema**：v15 → v16（addColumns 两列，旧数据回填 false，无数据改写）。
- **类型/域**：types.ts / openAiCompatible.ts / guard.ts / savePlan.ts /
  cardPayload.ts / chat.ts / prompt.ts / merge.ts / usage.ts（零改动——调试载荷
  不进 usage 快照）。
- **执行/UI**：useFlashChat.ts / FlashResultCard.tsx / FlashPreviewCard.tsx /
  flash.tsx / settings/ai.tsx。
- **数据层**：schema.ts / migrations.ts / AppSettingsModel.ts / settings.ts /
  WatermelonItemRepository.ts（getSettings/updateSettings 接线两列）。
- **文档**：ai.md v0.23 变更记录 + wire 节键清单更新；AGENTS.md §8 + 新 §7.44。
- **测试**：guard / openAiCompatible / savePlan / chat / merge / prompt /
  cardPayload / mapper（recurrence 非空披露路径）/ migrationsV16 / settings /
  useFlashChat 相关用例新增或调整；基线 98 套件 / 1365 用例只增不减。

## 3. 兼容与回滚

- v16 迁移为纯 addColumns，旧数据零改写；升级路径：启动即迁移，开关默认关 = 行为
  与 v15 完全一致。
- wire 缺省宽容保证旧格式响应（无 reminders 键）继续工作；**没有服务端配合问题**
  （模型按新 prompt 输出新键，guard 兼容两种）。
- 回滚：整分支回退（v16 列在旧代码下被忽略？——不，WatermelonDB 模式匹配严格，
  回滚必须整代码回退含 schema；真机无需数据迁移逆向，重装 development build 即可）。
- 无新依赖；无构建配置改动；`src/notifications/` 零改动（§7.17 闸门不触发）。

## 4. 测试计划（单测关键断言）

1. guard：reminders 键缺省宽容 / 合法通过 / 非数组・元素 time null・超 8 条整体拒绝 /
   draft 侧非正整数拒绝。
2. openAiCompatible：wire reminders 民用→epoch 换算（tzid 正确性）、DST gap 丢弃、
   升序去重、超限拒绝、lastDebug 副通道（成功轮 / HTTP 失败轮 / 重试覆盖 /
   fetch 抛错轮 request 有值 response null）、debug 不进 draft/history。
3. savePlan：多计划组装（reminders×2 + offset + delay = 4 条各自落库）、L5 同现
   两计划、过去时刻条目披露、recurrence 非空全披露、跨来源同刻去重、渠道覆盖与
   预设回填逐条应用。
4. chat：FlashTurnResult.debug 透传（成功 / 失败降级 / 无 Key null）。
5. merge：reminders 掩码合并（命中拷贝 / 未命中沿用）。
6. prompt：关键句存在断言（字段行 + 判定节 + 禁止换算条款 + 摘要提醒行）。
7. cardPayload / useFlashChat：多提醒 payload、chips 全 once 顺延。
8. migrationsV16 / settings：v16 迁移与读层默认 false。

## 5. 真机矩阵（阶段 3）

1. **F1 原始语句回归**：「明天8点、10点提醒我吃药」→ 卡片提醒行两条、保存落两条
   once、无「提醒时刻已过去」误报；
2. L5 回归：「明天下午3点开会，提前10分钟提醒我，另外30分钟后提醒我准备」→ 两条 once；
3. 编辑轮：保存后「改成9点」「再加一条12点的提醒」→ reminders 意图不丢；
4. 调试查看器：两开关 × 入口消息 × 弹层三节显隐；失败轮（断网重试耗尽）可查看；
   开关全关 = 现状无入口；
5. 回归点：切片 23 alarm 推荐、切片 25 认真模式、切片 29 推迟 chips / 历史卡、
   切片 30 重试提示与重试披露；
6. schema 升级：v15 旧数据启动无迁移错误、两开关默认关、设置页即时生效。

## 6. 边界（明确不做）

- 不碰 `src/notifications/` 调度与投递；AiParser.parse 冻结签名与返回类型外层不变
  （ParsedItemDraft 字段扩展经 ai.md 变更记录，v0.15.1→v0.19 既定演化路径）；
- `localFallback.ts` 零改动（§7.40 本地兜底否决先例，远端 prompt 为主路径）；
- F2（已保存条目对话式编辑防重复）不做，另属切片 25 候选②；
- 不做调试载荷持久化 / 导出 / 复制（消息内存态，弹层只读，AI_SYSTEM_PROMPT
  查看页同纪律）；
- 不做聊天持久化、不做指数退避变更（切片 30 语义不动）。

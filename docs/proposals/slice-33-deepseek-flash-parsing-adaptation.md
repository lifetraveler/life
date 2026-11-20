# 切片 33 提案：deepseek-flash 解析适配（reasoning 拼接与毫秒同化修复）

- 日期：2026-11-19
- 提案人：AI（Claude）
- 状态：已定案（用户 2026-11-19 路线确认；证据定性见 §1）
- 关联：tasks/slice-32-closeout.md（新发现来源）、tasks/feedback-log.md L8、tasks/backlog.md §2 deepseek-flash 行

## 1. 背景与问题定性

### 1.1 症状

切片 32 真机验收发现：deepseek-flash（reasoning 模型）大量轮次「AI 服务暂不可用（返回结构异常）」降级——即 `AiParseError('schema-mismatch')`。调试弹层（切片 32 阶段 2）留存的失败轮响应原文证实两个叠加根因：

### 1.2 根因 A：reasoning-in-content（思维链拼进 content）

- deepseek-flash 的思维链**没有 `<think>` 标签包裹**，是纯散文（「我倾向…」「嗯…」「我决定…」「综合考虑…」），直接拼在最终 JSON 前进入 `choices[0].message.content`。
- 解析链 `extractContent → stripCodeFence → JSON.parse` 对此零防御：`JSON.parse("我倾向…{...}")` 直接抛错 → schema-mismatch → 降级本地解析。
- 切片 32 矩阵③（编辑轮 reminders 掩码合并，远端路径）因此被阻塞。

### 1.3 根因 B：毫秒同化（few-shot history 压过 prompt 禁令）

失败轮 CoT 原文（自述）：

> 「计算毫秒时间戳？不需要，但上一轮 assistant JSON 用了毫秒。我这里的输出格式按字段定义应写民用格式 date/time。字段定义里 start 是对象。但历史 assistant 用的是 startAt 毫秒。系统提示说 history 里 assistant 草稿 JSON 的 startAt/endAt 是毫秒时间戳。**所以输出应带 startAt 毫秒？为保持一致，输出 startAt = 1795140000000**」

机制链：

1. `chat.ts` 两处 `historyAppend` 将 assistant 文本写为 `JSON.stringify(draft)`，其中 `startAt`/`endAt`/`reminders` 均为 **epoch 毫秒**（ParsedItemDraft 域形状，ai.md:24）。
2. 模型在多轮对话中把 history 里的毫秒 JSON 当 few-shot 示例模仿，**优先级压过 system prompt 的两条禁令**（「history 毫秒仅供程序读取禁反算」:108、「严禁输出毫秒」:113）。
3. prompt :108 的措辞「history 中 assistant 草稿 JSON 的 startAt/endAt 是毫秒时间戳……」被模型反向理解为**输出侧指引**（「所以输出应带 startAt 毫秒」）。
4. 输出 JSON 形如 `{"startAt": 1795140000000, ...}`（毫秒键而非 `start: {date,time}` 对象）——即使 CoT 被剥离、JSON 被提取，`isRemoteDraftWire` 仍会因键形状不符拒绝 → **仍降级**。

### 1.4 结论

**根因 A 与根因 B 必须捆绑修复**：只剥离思维链不修毫秒同化，提取出的 JSON 依然是毫秒形状，照样降级。本片同时落地「尾部 JSON 提取 + history 序列化民用化」两个修复。

## 2. 范围与不做清单

### 2.1 做

1. 解析链新增**尾部平衡 JSON 提取**（D1，根因 A）。
2. history assistant 序列化**民用化** + briefing 双形状兼容 + prompt 措辞改写（D2，根因 B）。
3. ai.md 契约演进（v0.24 变更记录）。
4. 真机复验（含切片 32 矩阵③补验）+ L8 定性闭环（D4）。

### 2.2 不做（本切片明确排除）

- **不改 AiParser.parse 冻结签名**、不改 RemoteDraftWire 键纪律（值从严不变）。
- **不引入 `reasoning_content` 字段消费**：当前渠道思维链拼在 content 里，即使未来某些渠道分离 reasoning_content，content 本身也应可解析；本片不做多渠道 reasoning 形状探测（YAGNI）。
- **不做模型推荐/切换引导**（「建议换 deepseek-chat」之类 UI 提示）：解析适配属传输层职责，与模型选择解耦。
- **不改 localFallback**（本地降级层无此问题）。
- **不动 `lastDebug`/`lastUsage` 副通道**（调试弹层展示的 response 原文含 CoT 属预期，知悉即可）。
- **不修「AI 服务暂不可用」的其他成因**（网络错误等照旧）。
- 冻结区：`src/notifications/`、`src/domain/recurrence/` 实现文件为空（`src/domain/recurrence/civilTime.ts` 的 `getZonedParts` 为既有导出，只 import 不修改）。
- 不改 `src/domain/export.ts`（切片 12 冻结）。
- 无新依赖、无 schema 迁移（schema 停留 v16）。

## 3. 设计决策

### D1 尾部平衡 JSON 提取 `extractLastBalancedJson(text: string): string`

- 位置：`src/domain/ai/openAiCompatible.ts` 导出纯函数（同 `stripCodeFence` 先例）。
- 算法：从字符串**末尾向前**扫描；跳过 JSON 字符串字面量内的字符（处理 `\"` 转义）；维护 `{}`/`[]` 深度配平；遇到使深度归零的**最靠后**块起点（`{`），返回该子串（含花括号）。
- 无任何配平块 → 返回原文（走既有 schema-mismatch 失败路径，行为不变）。
- 输入是纯 JSON（正常模型）→ 最靠后配平块即整个字符串，**零回归**。
- 插入链序：`extractContent → stripCodeFence → extractLastBalancedJson → JSON.parse`（openAiCompatible.ts:661-662 处）。
- 为什么「从尾部」：CoT 中模型自言自语会引用/推演 JSON 片段（含转义形式 `{\"date\"...}`），从尾部扫描保证取到的是**最终输出块**；字符串字面量内的大括号不参与配平，转义片段不会被误取。

### D2 history assistant 序列化民用化 `serializeDraftForHistory`

- 位置：`src/domain/ai/prompt.ts` 导出纯函数（该文件已有 `getZonedParts`/民用格式化先例），签名 `serializeDraftForHistory(draft: ParsedItemDraft, tzid: string): string`。
- 转换规则：
  - `startAt`（epoch ms）→ `{ date: 'YYYY-MM-DD', time: 'HH:mm' }`（民用）；`allDay=true` → `{ date, time: null }`；null → null。
  - `endAt` 同构（含 null）。
  - `reminders`（epoch ms 数组）→ `[{ date, time }, ...]` 民用对象数组。
  - 其余字段（title/content/type/categoryId/tags/priority/recurrence/reminderOffsetMinutes/reminderDelayMinutes/reminderChannels/needsClarification/clarificationPrompt）原样保留。
- 接线：`chat.ts` 两处 `historyAppend` 的 assistant 文本由 `JSON.stringify(draft)` 改为 `serializeDraftForHistory(draft, deps.tzid)`（fallbackTurn 与 runFlashTurn 各一处）。
- **briefing 双形状兼容**（prompt.ts `tryParseBriefingDraft`/`renderBriefing`）：
  - `startAt`/`endAt`：`number`（legacy 毫秒，epoch→民用渲染）或 `{date,time}|null`（新，直接渲染）；两者缺一不可时的判据更新。
  - `reminders`：`number[]`（legacy）或 `{date,time}[]`（新）。
  - 兼容动机：已存会话（内存态 historyRef）在 App 运行期内混合新旧格式（升级前创建的条目 history 是毫秒），渲染侧必须双吃。
- **prompt 措辞改写**（:108）：「history 中 assistant 草稿 JSON 的 startAt/endAt 是毫秒时间戳、reminders 是毫秒时间戳数组，仅供程序读取；禁止由毫秒反算日期或时刻——民用时间一律以摘要块为准」→「history 中 assistant 草稿 JSON 一律是民用时间格式（start/end 为 date/time 对象、reminders 为对象数组）；摘要块是唯一民用时间基准；输出 JSON 严禁出现毫秒时间戳或任何非字段定义格式的日期时间」。消除「输出侧毫秒」歧义。
- 注意：旧 history 毫秒条目仍在**会话内存**中存在（升级瞬间），prompt 不再声称 history 是毫秒——模型对旧条目的「好奇」由摘要块兜底（摘要块始终民用且声明为唯一基准）。

### D3 契约演进（ai.md v0.24）

- 变更记录新增两条要点（一个条目）：
  1. **history assistant JSON 格式演进**：毫秒 → 民用（serializeDraftForHistory），消费侧（buildHistoryBriefing/renderBriefing）双形状兼容；`ParsedItemDraft` 域形状不变（reminders 仍 epoch ms），仅序列化面转换。
  2. **解析链新增尾部平衡 JSON 提取**（reasoning 拼接容错）。
- `RemoteDraftWire` 键纪律、`isRemoteDraftWire` 从严原则、12 必填键清单**零改动**。
- AGENTS.md 新增 §7.45（v0.37）。

### D4 L8 定性闭环

- tasks/feedback-log.md L8（切片 23 遗留「远端间歇 AI 服务暂不可用（返回结构异常）」）与切片 32 backlog 行的定性：schema-mismatch 降级的主因即根因 A+B。
- 本片修复后真机复验：deepseek-flash 多轮（含 CoT 长句式）若降级率显著回落，L8 标注「已定性：reasoning 拼接+毫秒同化，已修复于切片 33」；若仍复现（其他成因），记录残余症状保持观察。

### D5 验收矩阵（真机 deepseek-flash 主路径）

1. F1 原句回归：「明天8点、10点提醒我吃药」→ 远端成功轮、预览卡两条绝对时刻提醒、保存两条 once。
2. 切片 32 矩阵③补验：编辑轮「改成明天下午4点」（上一张卡含 reminders）→ 远端成功、掩码合并保留提醒。
3. 多轮编辑链：新建→改时间→补内容，全程远端无降级。
4. 普通新建（无提醒）：远端成功。
5. 长 CoT 句式（切片 32 矩阵②遗留）：「提前10分钟和30分钟后各提醒我一次」→ 远端成功轮。
6. 无 Key 降级回归：本地路径不受影响。
7. 深浅色不涉及（无 UI 改动）。

## 4. 实现细节

### 4.1 文件落点

| 文件 | 改动 |
| --- | --- |
| `src/domain/ai/openAiCompatible.ts` | 新增 `extractLastBalancedJson`；解析链 :661-662 插入 |
| `src/domain/ai/prompt.ts` | 新增 `serializeDraftForHistory`；`tryParseBriefingDraft`/`renderBriefing` 双形状兼容；:108 措辞改写 |
| `src/domain/ai/chat.ts` | 两处 `historyAppend` assistant 文本接线 |
| `docs/contracts/ai.md` | v0.24 变更记录 |
| `AGENTS.md` | v0.37：§7.45 + §8 刷新 |
| `tasks/slice-33.md` | 任务卡（随阶段 1 提交） |
| 单测 | `openAiCompatible.test.ts` 提取矩阵；`prompt.test.ts` 序列化/双形状；`chat.test.ts` history 民用断言 |

### 4.2 单测清单

- `extractLastBalancedJson`：纯 JSON 原样；CoT 散文+尾部 JSON → 提取；JSON+尾随文本 → 提取；字符串字面量内大括号不干扰配平；嵌套 `[]`/`{}` 混合；无配平块原样；CoT 内转义 JSON 片段不误取。
- `serializeDraftForHistory`：allDay（time null）；非 allDay；reminders 多条；null startAt；字段保全（recurrence/tags/clarification 等全通过）。
- `buildHistoryBriefing` 双形状：legacy 毫秒条目渲染（既有断言不回归）；新民用条目渲染；混合（旧条目在前新条目在后→取最新）。
- `chat.ts`：historyAppend assistant 文本含 `"date"`/不含 epoch ms（现有多轮测试断言需同步更新——旧断言「history 里是 JSON.stringify(draft)」改为民用形状断言）。

### 4.3 验收命令

- `npx tsc --noEmit`
- `npx jest --runInBand`（基线：98 套件 / 1408 用例，只增不减）
- `npx expo-doctor`（2 项预存基线失败无新增）
- 真机矩阵 §3.D5（deepseek-flash 配置，MuMu 127.0.0.1:7555 + Metro + adb reverse）

## 5. 风险与回退

| 风险 | 缓解 |
| --- | --- |
| 尾部提取误取 CoT 中推演的 JSON 片段 | 从尾部扫描 + 字符串字面量感知；真机矩阵覆盖 CoT 长句式；提取后仍过 `isRemoteDraftWire` 从严守卫，误取的形状不符 JSON 会正常降级（不比现状差） |
| 民用序列化丢精度（时区/DST） | `getZonedParts` 与落库换算同源（civilTime.ts 既有导出）；DST gap/回退语义由 civilTime 统一处理，序列化只是逆操作展示 |
| 旧毫秒 history 条目渲染回归 | 双形状兼容 + 既有 briefing 单测（legacy 断言）保持通过 |
| deepseek-flash 输出仍带 `startAt` 毫秒键（同化惯性） | prompt 措辞改写 + history 示范民用化双管齐下；若复验仍见毫秒键，考虑 wire 层「startAt 毫秒→拒绝」保持现状（降级可见），不做宽容解析 |
| 契约演进遗漏 | ai.md 变更记录 + AGENTS §7.45 成文；`RemoteDraftWire` 零改动降低波及面 |

## 6. 验收口径

- `npx tsc --noEmit` 0 错误。
- jest 基线 98/1408 只增不减。
- expo-doctor 2 项预存基线失败无新增。
- 无新依赖、无 `as any`、schema 停留 v16、冻结区（`src/notifications/`、`src/domain/recurrence/`、`src/domain/export.ts`）零 diff。
- 真机矩阵 §3.D5 全过（重点：切片 32 矩阵③补验）。
- L8 定性注记落 tasks/feedback-log.md。

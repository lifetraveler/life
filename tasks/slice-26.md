# 切片 26：AI 透明度（提示词查看 + 用量展示）

> 来源：slice-23 closeout §6 候选 2；backlog §2 切片 26 行（A+B 两子项打包）。
> 基点：main @ `91ed33d`（backlog 立项提交后最新 main，切片 25 merge 5ed723f）。分支：`task/slice-26`。
> 本卡与 AGENTS.md v0.28（§7.38）随本切片阶段 1 提交，不单独提交。

## 0. 目标

让用户能看到「AI 到底收到了什么指令、每轮花了多少」：

- **A. 提示词查看**：设置页新增只读界面，展示 `AI_SYSTEM_PROMPT` 静态规则串。
- **B. 用量展示**：远端解析轮可在 AI 回复消息尾追加一行用量摘要
  （输入/输出 tokens、缓存命中数、按配置单价的估算费用），设置开关控制，
  默认关闭。

## 1. 关键设计决策（先读再动手）

### D1 usage 传输走 provider 副通道，不改 AiParser.parse 返回值

backlog 原行假设「B 涉及 AiParser.parse 返回值扩展」。**规划时修订为不扩展**：
`ParsedItemDraft` 是 history wire 的序列化来源（chat.ts historyAppend 的
assistant 文本 = `JSON.stringify(draft)`）与 merge/保存链的流转对象——usage
挂在 draft 上会污染 history JSON 与下游合并。而 `runFlashTurn` 每轮
`new OpenAICompatibleProvider(...)`（chat.ts:145），provider 实例天然按轮隔离：

- `OpenAICompatibleProvider` 新增 `public readonly lastUsage: AiUsageSnapshot | null`
  （初始 null；`parse()` 开始时置 null，envelope 提取成功后赋值；抛
  `AiParseError` 保持 null）。`AiParser` 冻结接口不动（具体类加 getter 不违约）。
- `chat.ts` 的 `FlashTurnResult` 新增 `usage: AiUsageSnapshot | null`
  （域内类型，非冻结契约）；`runFlashTurn` 远端分支读 `provider.lastUsage`，
  `fallbackTurn` 恒返回 null。
- ai.md 正文（parse 签名/ParsedItemDraft/ChatMessage/RemoteDraftWire）零改动，
  仅文末「变更记录」追加 v0.20 非破坏性条目说明该边界。

### D2 开关存储：app_settings v13

`show_ai_usage`（boolean，非可选，默认 false = 不显示）。完全照抄切片 25
`careful_mode` 先例：schema.ts 列块 + migrations 单条 addColumns（零
unsafeExecuteSql）+ `AppSettingsModel` `@field` + settings.ts 接口/默认值 +
repository 读层防御归一（非 boolean 回退 false）+ 写层 patch 直通。

### D3 展示形态：消息文本合成，flash.tsx 零改动

用量行由 hook 合成进消息文本（`note + '\n' + 用量行`），不新增
FlashChatMessage 字段、不改 FlashConfirmCard/FlashResultCard 载荷：

- 正常出卡轮 / 澄清轮：追加到该轮 assistant 文本消息尾部（本轮真实消耗，
  澄清轮也显示）。
- 认真模式拦截轮：确认卡后追加一条独立用量文本消息（确认卡是结构化组件，
  不动其载荷）。
- 降级轮（本地解析）：无 usage，不显示任何用量行。

### D4 单价与估算

`AiProviderConfig` 新增可选字段 `priceInputPerMillion` / `priceOutputPerMillion`
（正数才有效；旧 JSON 缺键 → 守卫容忍 undefined，现构造即容忍，需同步扩展
重构构造透传）。两个单价都配置时 `estimatedCost = promptTokens×in/1e6 +
completionTokens×out/1e6`（round 到 6 位小数）。**估算为全价上界**——不区分
DeepSeek 缓存命中折扣，设置页 hint 注明。币种不换算不显示符号（用户按账户
计价币种自行填写）。

### D5 提示词查看为只读

只展示 `AI_SYSTEM_PROMPT`（src/domain/ai/prompt.ts:36-103 的 join 结果）；
`buildNowFacts`/`buildHistoryBriefing` 动态拼接部分不展示，页面 hint 注明。
不提供编辑/复制/导出（不装 expo-clipboard，零新依赖）。

## 2. 阶段划分

### 阶段 1：域层 usage 管道 + schema v13 开关（全部单测，无 UI）

| 文件 | 改动 |
| --- | --- |
| `src/domain/ai/usage.ts`（新建） | `AiUsageSnapshot`（promptTokens/completionTokens/cachedPromptTokens/estimatedCost）、`readAiUsageSnapshot(envelope: unknown, prices): AiUsageSnapshot \| null`（defensive 读取 chat-completions `usage.prompt_tokens`/`completion_tokens`/`prompt_tokens_details.cached_tokens`，非数值或 cached 越界 → null；usage 缺失 → null）、`formatAiUsageLine(snapshot): string`（`📊 用量：输入 123 tokens（缓存 45）· 输出 67 · ≈0.001234`，段缺失自动省略）。全程 unknown 收窄，禁 `any` |
| `src/domain/ai/openAiCompatible.ts` | envelope 解析挂点（:427-432 一带）调 `readAiUsageSnapshot`（单价取 config 两字段均为正数才传）；新增 `lastUsage` 公开只读属性（D1 语义）；`testConnection` 不动 |
| `src/domain/ai/chat.ts` | `FlashTurnResult` + `usage` 字段；`runFlashTurn`（:132-171）远端分支透传 provider.lastUsage；`fallbackTurn` 返回 null |
| `src/domain/ai/configStore.ts` | `AiProviderConfig` + 两个可选单价字段；`isAiProviderConfig`（:32-54）重构构造透传（非正数丢弃） |
| `src/db/schema.ts` | `SCHEMA_VERSION` 12→13（:17）；app_settings 列块（:143-157 一带）+ `{ name: 'show_ai_usage', type: 'boolean' }` + 头注 |
| `src/db/migrations.ts` | v13 单条 addColumns（照抄 :302-312 v12 先例，零 unsafeExecuteSql/零 UPDATE）+ 头注清单 |
| `src/db/models/AppSettingsModel.ts` | `@field('show_ai_usage') showAiUsage!: boolean;`（:39 先例旁） |
| `src/domain/settings.ts` | `AppSettings.aiUsageDisplay: boolean`（carefulMode 同款：非可选、无独立 parse/validate、注释成文）；`DEFAULT_APP_SETTINGS` + false |
| `src/data/WatermelonItemRepository.ts` | 读层 :224-226 旁 + 防御归一；写层 :1825 / :1874 / :1900-1901 三处 patch 直通 |
| `docs/contracts/ai.md` | 头部版本 v0.19→v0.20；文末「变更记录」追加 v0.20 条目（原因=透明度切片；影响范围=无冻结面变更，lastUsage 副通道 + FlashTurnResult 域内字段；迁移方案=旧数据无需迁移） |
| `tasks/slice-26.md` / `AGENTS.md` | 本卡 + v0.28（§7.38 新增、§8 刷新）随阶段 1 提交 |

测试（阶段 1 内完成）：`src/domain/ai/__tests__/usage.test.ts`（新建：
readAiUsageSnapshot 齐全/缺 usage/畸形数值/缓存越界、估算四舍五入、单价缺省、
formatAiUsageLine 各形态）、`openAiCompatible.test.ts` 增补（fake envelope 带
usage → parse 后 lastUsage 断言；无 usage → null；解析失败 → null）、
`chat.test.ts` 增补（远端轮 usage 透传 / 降级轮 null）、`migrationsV13.test.ts`
（新建）+ **版本号固定账单**：SCHEMA_VERSION 递增牵动 migrationsV8/V9/V11/V12、
seedPreset、viewQueries、ReminderScheduler stub 等既有套件的版本断言（切片 25
closeout 教训 2，逐套件过账）。

### 阶段 2：UI 三落点 + hook 接线（单测）

| 文件 | 改动 |
| --- | --- |
| `src/app/settings/ai-prompt.tsx`（新建） | 提示词查看页：ScrollView + 可选中文本展示 AI_SYSTEM_PROMPT；hint「实际请求还会动态拼接当前时间事实与多轮上下文摘要，本页只展示静态规则串」；makeStyles(colors) Token 化；expo-router 文件路由自动注册（无 settings/_layout.tsx，Stack 头样式继承根 _layout 的 Token screenOptions，验收时核对深浅色） |
| `src/app/(tabs)/profile.tsx` | 「分类与标签」section AI 配置 navRow（:398-401）下新增：①navRow「AI 提示词」→ `/settings/ai-prompt`；②widgetToggleRow「AI 用量展示」+ hint「AI 回复末尾显示本轮 token 消耗与估算费用（按设置的单价）。」——照抄 carefulMode 行（:402-416）全套：`aiUsageDisplay === true`、disabled（settingsSavingKey 互斥）、`handleAiUsageDisplayChange` + aiUsageError |
| `src/app/settings/ai.tsx` | 表单加两个选填数字输入「输入单价（每百万 tokens）」「输出单价（每百万 tokens）」+ hint「用于估算费用，按账户计价币种填写，留空只显示 token 数；估算按全价上界」；`buildConfig`（:70-79）透传两字段（parseFloat，NaN/≤0 视为清空）。**不修 buildConfig 丢 timeoutMs 的既有 quirk**（切片 15 披露，保持现状） |
| `src/ui/useFlashChat.ts` | `readCarefulMode`（:434-442）→ `readTurnSettings(): Promise<{carefulMode: boolean; showAiUsage: boolean}>`（一次 getSettings，失败双 false 回退）；`send()`（:506-593）：runFlashTurn 成功后先读 turnSettings，守卫分支（:545-561）改用 `turnSettings.carefulMode`；正常/澄清路径消息文本尾合成用量行；拦截路径 pushConfirm（:557）后追加独立用量文本消息（D3） |

测试：`useFlashChat.test.ts` 增补——showAiUsage=true 远端轮消息含用量行 /
false 不含 / 拦截轮确认卡后独立用量文本 / 降级轮无用量行 / getSettings 失败
回退不炸；profile 开关行为如既有 carefulMode 测试先例（若有）补 aiUsageDisplay。

### 阶段 3：真机验收 + 收尾

- 验收矩阵（MuMu 或 dev client，见 §4）。
- `tasks/slice-26-closeout.md` 收尾移交（§7.10）。
- backlog §1 划掉本切片条目、AGENTS §8 当前切片行刷新（§7.9 惯例）。
- 提交序列按 §7.9：切片分支提交 → push → main `--no-ff` 合并 → push main。

## 3. 验收命令与基线

- `npx tsc --noEmit` —— 0 错。
- `npx jest --runInBand` —— 基线 **79 套件 / 1087 用例**（切片 25 收尾值），
  只增不减。
- `npx expo-doctor` —— 2 项预存基线失败无新增。
- 真机验收矩阵（全部通过）：
  1. 开关默认关：远端解析轮无用量行（回归切片 25 全部行为）。
  2. 开关开、未配单价：assistant 消息尾 `📊 用量：输入 N tokens · 输出 M`
     （无缓存段/无费用段时形态正确）。
  3. 开关开、配单价：行尾 `≈0.00xxxx`；改单价后下一轮生效（config 每轮重读）。
  4. DeepSeek 缓存命中轮：缓存段 cached>0 显示正确。
  5. 澄清轮：反问消息同样带用量行。
  6. 认真模式拦截轮：确认卡后独立用量文本；应用/放弃均不影响该行。
  7. 降级轮（无 Key/断网）：无用量行，降级说明照旧。
  8. 提示词查看页：内容与 AI_SYSTEM_PROMPT 一致（抽查首尾规则句）、深浅色
     两态正常、长文本可滚动到底、hint 提示动态拼接。
  9. 持久化：开关与单价杀进程重开保持；旧库 v12→v13 升级后开关为关。
  10. 单价回显：保存后重进 /settings/ai 值保持；清空保存后估算段消失。

## 4. 明确不做

- 不改 `AiParser.parse` 冻结签名与返回类型、`AiParseContext`、`ChatMessage`、
  `RemoteDraftWire`/`isRemoteDraftWire`（D1 副通道设计）。
- usage 不进 `ParsedItemDraft`、不进 history JSON；不做跨轮累计/会话汇总/
  用量持久化/报表。
- 不引入任何新依赖（无复制按钮；usage 展示纯文本合成）。
- 不支持流式响应（本应用固定 stream:false）；仅解析 chat-completions 信封
  usage（DeepSeek/OpenAI 兼容形态）。
- 估算不区分缓存命中折扣（全价上界，hint 注明）；不做汇率/币种换算。
- 不修 `buildConfig` 丢 `timeoutMs` 的既有 quirk。
- 提示词只读：不编辑、不复制、不导出。
- 不碰 `src/notifications/`、`src/domain/recurrence/` 冻结区；不闪改其他候选
  （手动深浅色 theme_mode 不并入，v13 已被 show_ai_usage 占用，顺延 v14）。
- 不改 FlashConfirmCard/FlashResultCard 载荷结构；flash.tsx 零改动（D3）。

## 5. 风险与开放问题

- 信封 usage 字段各家兼容形态有差异（如 `prompt_tokens_details` 缺失）——
  defensive reader 一律回退 null，展示段自动省略，不炸解析主链。
- 版本号固定账单套件清单以切片 25 closeout 教训 2 为准，开工时先跑全量
  db 相关测试确认牵动面再改。
- 若真机 envelope 无缓存字段（部分兼容网关），缓存段不显示属预期行为，
  验收 4 以 DeepSeek 直连为准。

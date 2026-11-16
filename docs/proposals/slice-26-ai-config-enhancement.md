# 变更提案：AI 配置平台化预设 + DeepSeek 峰谷分层计价（切片 26 阶段 2b）

- 日期：2026-11-17（阶段 3 真机验收进行中提出，m00910）
- 提案状态：待用户确认；确认前不动任何实现文件
- 关联契约：AGENTS.md §7.38（v0.28）「单价配置」段、docs/contracts/ai.md v0.20「用量展示副通道」第 4 条
- 关联任务卡：tasks/slice-26.md（阶段 2 产出已提交：d44836b / a29a423）

## 1. 原因（为什么要改）

1. 阶段 1/2 已落地的单价模型是「两字段全价上界」（priceInputPerMillion / priceOutputPerMillion），
   无法表达 DeepSeek 现行峰谷×缓存分层计价（官方价格页：输入分缓存命中/未命中两档，每档再分
   高峰/空闲两档，输出分高峰/空闲两档，空闲价为高峰一半）。按该模型估算的费用与实际账单偏差
   可达数倍，用户明确要求完善。
2. 用户同时要求平台化配置：平台下拉选择（deepseek、火山、百炼、小米等）→ 预设 BaseURL 与常用
   Model，减少手输与错填。
3. 阶段 3 真机验收 1–6、10 尚未执行（等待 API Key）。若先按旧模型验收再改模型，验收需重跑；
   本提案落地后一次验收，避免返工。已完成的验收 7/8/9（降级轮、提示词页、迁移+持久化）与本
   变更无关，结论保持有效。

## 2. 官方口径依据（DeepSeek 价格页，2026-11 现行）

- 模型：`deepseek-flash`（DeepSeek-V4.1-Flash-1017）、`deepseek-v4-pro`（DeepSeek-V4-Pro-0813）。
- BASE URL（OpenAI 格式）：https://api.deepseek.com（应用沿用现有默认 https://api.deepseek.com/v1，
  两者均可用）。
- 价格（元 / 百万 tokens）：

| 档位 | deepseek-flash | deepseek-v4-pro |
| --- | --- | --- |
| 输入（缓存命中）· 空闲 | 0.02 | 0.15 |
| 输入（缓存命中）· 高峰 | 0.04 | 0.30 |
| 输入（缓存未命中）· 空闲 | 1 | 4.5 |
| 输入（缓存未命中）· 高峰 | 2 | 9.0 |
| 输出 · 空闲 | 4 | 13.5 |
| 输出 · 高峰 | 8 | 27.0 |

- 高峰时段定义（官方原文）：**北京时间周一至周五（不含中国法定节假日）9:00–12:00、14:00–18:00
  为高峰时段；其余时段（含周末及法定节假日全天）为空闲时段。**

## 3. 方案总览

### 3.1 平台化配置（AiProviderConfig.platform）

- 新增可选字段 `platform`：`'deepseek' | 'volcano' | 'bailian' | 'xiaomi' | 'custom'`。
  旧配置 JSON 无该字段 → 视为 `'custom'`，行为与现状完全一致（零迁移）。
- 平台预设表（选中平台时 BaseURL/Model 预填，**仍可自由编辑**；预设仅是快捷填充）：

| platform | 名称 | BaseURL 预设 | Model 预设列表 |
| --- | --- | --- | --- |
| deepseek | DeepSeek 官方 | https://api.deepseek.com/v1 | deepseek-flash、deepseek-v4-pro、deepseek-chat、deepseek-reasoner |
| volcano | 火山方舟 | https://ark.cn-beijing.volces.com/api/v3 | doubao-seed-1.6、doubao-1.5-pro-32k（待用户确认增删） |
| bailian | 阿里百炼 | https://dashscope.aliyuncs.com/compatible-mode/v1 | qwen-max、qwen-plus、qwen-flash（待用户确认增删） |
| xiaomi | 小米 | （占位，待用户补充 BaseURL） | （占位，待用户补充模型名） |
| custom | 自定义 | （沿用当前输入值） | （自由输入） |

### 3.2 DeepSeek 分层计价（仅 platform === 'deepseek' 生效）

- AiProviderConfig 新增 6 个可选价格字段（元/百万 tokens，正数有效，可空——与现有单价同口径，
  非正数丢弃不整包拒绝）：

```
priceCachedPeak / priceCachedOffPeak        // 输入·缓存命中·高峰/空闲
priceUncachedPeak / priceUncachedOffPeak    // 输入·缓存未命中·高峰/空闲
priceOutputPeak / priceOutputOffPeak        // 输出·高峰/空闲
```

- 预填规则：平台选 deepseek 且 Model 选 deepseek-flash / deepseek-v4-pro 时，按 §2 表自动预填
  对应 6 价（可改）；选其他模型名不预填。
- 高峰判定（auto，固定规则不做配置）：**北京时间周一至周五 9:00–12:00、14:00–18:00 → 高峰；
  其余 → 空闲**。法定节假日不识别（按空闲计）→ 估算口径注明「节假日轮次可能低估」，作为已知
  限制记入 ai.md v0.21 与 backlog（不做节假日表，避免每年维护；用户如要求再加）。
- estimatedCost 计算（deepseek 平台）：

```
cachedPrice = isPeak ? priceCachedPeak : priceCachedOffPeak
uncachedPrice = isPeak ? priceUncachedPeak : priceUncachedOffPeak
outputPrice = isPeak ? priceOutputPeak : priceOutputOffPeak
estimatedCost = cached×cachedPrice + (prompt−cached)×uncachedPrice + output×outputPrice  // ÷1e6 后 round 6 位
```

- 分层启用门槛：6 价中**三段各至少一个有效价**（cached 段、uncached 段、output 段）才估算；
  任一段缺价 → estimatedCost = null（费用段省略），tokens 段照常显示。
- cached_tokens 缺省（信封无 prompt_tokens_details）时：输入段**全按未命中价**计（保持「上界」
  语义），cachedPromptTokens 展示段省略规则不变（v0.20 现状）。
- 用量行格式**不变**（`📊 用量：输入 N tokens（缓存 M）· 输出 K · ≈C`），不展示时段档位标记；
  档位口径记入 ai.md。

### 3.3 通用单价字段保留

- priceInputPerMillion / priceOutputPerMillion **保留**，语义限定为「非 deepseek 平台的两段全价
  上界」（volcano/bailian/xiaomi/custom 用）。deepseek 平台两字段被忽略（分层优先）。
- 单价区 UI 按 platform 切换：deepseek → 6 价输入 + 时段规则 hint；其他平台 → 现有 2 价输入。

### 3.4 UI（src/app/settings/ai.tsx，零新依赖）

- 不引入 Picker 依赖（RN 0.8x 无内置 Picker；@react-native-picker/picker 属新依赖，§7.3 禁止）。
  形态：**横向 chips**（flexWrap，项目内已有同款：提醒渠道 chips、快捷 Chips）。
- 平台 chips：5 项（DeepSeek 官方 / 火山方舟 / 阿里百炼 / 小米 / 自定义）。
- Model chips：随平台切换的预设列表 + 自由输入框（点 chip 即填入输入框，输入框始终可编辑）。
- BaseURL：选平台时预填预设值（可改；改 platform 不清空已填 Key）。
- 保存校验沿用现状（BaseURL/Key/Model 非空），platform/价格字段不阻塞保存。

## 4. 影响范围（文件清单）

| 文件 | 变更 |
| --- | --- |
| src/domain/ai/configStore.ts | platform + 6 价字段校验/透传；预设表常量（AI_PLATFORM_PRESETS）；旧 JSON 兼容 |
| src/domain/ai/usage.ts | 高峰判定纯函数 isPeakBeijing(now)；分层 estimatedCost 计算（新函数，单测覆盖） |
| src/domain/ai/openAiCompatible.ts | 价格入参由 2 价改分层结构（config 直读，provider 行为不变——lastUsage 副通道照旧） |
| src/app/settings/ai.tsx | 平台/Model chips + 预填 + 单价区按平台切换 |
| src/ui/useFlashChat.ts | 零改动（runFlashTurn/usage 传输边界不动） |
| src/db/** | 零改动（价格全部在 SecureStore JSON，不进 WatermelonDB；schema 停在 v13） |
| 测试 | usage.test.ts（分层计算/窗口边界）、configStore.test.ts（platform 校验/兼容）、openAiCompatible.test.ts（分层 estimatedCost）、chat.test.ts（远端轮透传） |
| docs/contracts/ai.md | v0.21 非破坏性条目：修订 v0.20「全价上界」句（deepseek 分层、其余平台全价上界、行格式不变、节假日口径已知限制） |
| AGENTS.md | §7.38 单价配置段修订（v0.29 注记，随切片 26 阶段 2b 提交） |
| tasks/slice-26.md | 追加「阶段 2b：AI 配置平台化 + DeepSeek 分层计价」与验收说明 |
| tasks/backlog.md | 新增已知限制：节假日不识别（估算低估可能） |

## 5. 迁移与兼容

- SecureStore 配置 JSON 无版本概念：platform 缺省 → custom；6 价字段缺省 → undefined；
  旧配置（两价全价上界）行为逐字节不变。零数据迁移、零 schema 变更。
- estimatedCost 语义变化**仅在用户显式选 deepseek 平台并填分层价后发生**。

## 6. 回滚方案

- 全部变更集中在域层 3 文件 + ai.tsx + 文档；无 DB/无原生/无新依赖。回滚 = 还原上述文件
  （git revert 阶段 2b 提交），配置 JSON 向后兼容新旧两版。

## 7. 验收计划（阶段 2b 落地后与剩余真机验收合并执行）

- 单测：分层计算（三段齐/缺段 null/round 边界）、高峰窗口边界（08:59/09:00/12:00/13:59/14:00/
  18:00、周六周日）、cached 缺省回退未命中价、platform 校验与旧 JSON 兼容。
- 真机（含 Key 后）：验收 1–6 + 10 一次执行——远端轮用量行（无缓存/有缓存形态）、单价估算
  （flash 预设价 vs 改价下一轮生效）、澄清轮/拦截轮用量行、单价回显与清空后估算段消失。
- 既有验收 7/8/9 结论不受影响（回归跑一遍即可）。

## 8. 待用户决策项

1. 平台预设清单：火山/百炼的 BaseURL 与 Model 列表按 §3.1 表先定？小米的 BaseURL/Model
   资料缺失（公开渠道无 OpenAI 兼容网关资料）——先做占位（选小米=custom 行为，BaseURL/Model
   自由填写）还是用户补充资料后再定？
2. 节假日口径：接受「节假日按空闲计（估算可能低估）」的 auto 规则，还是要求硬编码节假日表？
3. 阶段挂靠：并入切片 26 追加「阶段 2b」（推荐，验收一次过）还是独立切片？

## 9. v2 修订：每平台独立配置槽（阶段 2c，2026-11-17 用户需求）

用户验收 2b 时指出：切换平台 chip 后 API Key 等表单内容不变——单槽设计（platform 只是
active 配置上的标签）不符合「每平台各自保存、标出正在使用」的预期。修订为：

- **存储**：AiConfig 扩展 `slots?: Record<AiPlatform, AiProviderConfig | null>` 与
  `activePlatform?: AiPlatform`；`active` 语义收窄为「= slots[activePlatform]」（消费面
  ——chat.ts/useFlashChat/OpenAICompatibleProvider——零改动）。
- **旧 JSON 迁移**：load 读到无 slots 键的旧格式时，active 按其 platform（缺省 custom）
  归入对应槽，其余槽 null；activePlatform = 该平台。守卫归一化单点（isAiConfig）。
- **UI**：点平台 chip = 切换编辑视图（从该平台槽回填表单，空槽按预设默认值初始化，
  未保存的编辑直接丢弃不提示）；点「保存配置」= 写入当前编辑平台槽 + 「使用中」标记
  切到该平台（**保存即激活**，用户已确认）；chip 显示 `· 使用中` 徽标。
- **估算链不变**：槽 config.platform = 槽平台 → deepseek 槽走分层六价，其余槽全价两价。
- **影响范围**：configStore.ts（数据模型+守卫归一）、ai.tsx（chip 切换/保存逻辑/徽标）、
  测试（isAiConfig 归一化用例）；SecureAiConfigStore 接口透传零改动；ai.md v0.22 条目、
  AGENTS v0.30 注记段更新。
- **回滚**：git revert 阶段 2c 提交；新格式 JSON 读回旧代码会因多余键被 isAiConfig 的
  旧校验拒绝（active 键存在 → 旧代码仍能读 active 字段——实际向后兼容：旧格式校验只看
  active 键，多余键忽略，故 v2 JSON 在旧代码下可读出 active 继续工作，无锁死）。

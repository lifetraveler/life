# 切片 23 阶段反馈：Phase 1（闪电录入强提醒渠道推荐与主动澄清——AI 契约层）

- 日期：2026-11-15
- 阶段范围：**Phase 1 / 共 3**——`ParsedItemDraft` 澄清/渠道字段扩展 + guard/wire 类型守卫 + Prompt 三节指令 + 本地正则强提醒词表与意图短语槽 + savePlan 强提醒落库分支 + 单测；Phase 2（远端上下文编辑 history 摘要接线）与 Phase 3（UI 澄清交互、渠道标识、真机验收）待续。
- 分支：`task/slice-23`（基点 main @ `8827699`）
- 阶段提交：`e51ac5b`（feat(s23) 阶段 1，17 files，+807/−9：src 六实现文件 + 七测试文件 + ai.md v0.19 增补 + AGENTS.md §7.35 修订 + 任务卡入库）；本反馈文件以 docs(s23) 补充提交（§7.33 允许形式）。
- 状态：**阶段 1 完成，暂停等待阶段 2 确认**。遗留项：无阻塞项；已知边界见文末。

## 成果定性表

| 验证项 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | 0 错（实现期曾报 2 错并修复：openAiCompatible wire 判空漏 null 的 TS2488；savePlan startAt 是 CreateItemInput 可选字段 `number \| undefined` 的 TS2345——`=== null` 改为显式含 undefined） |
| `npx jest --runInBand` | 74 套件 / 1012 用例全过（切片前基线 74 / 973；+39 用例、无新套件：prompt +7、localFallback +13（含既有 1 例按新行为更新）、fallbackSlots +2、merge +2、guard +4、openAiCompatible +4、savePlan +8） |
| `npx expo-doctor` | 2 项失败 = 预存基线（app config 非 CNG 同步检查、React Native Directory 元数据检查），对照 slice-21/22 无新增 |
| 真机/模拟器验收 | 不适用（本阶段纯域层，无 UI/落库行为变化面；真机验收按任务卡在阶段 3） |
| APK 版本号 | 不适用（未交付新包） |
| 冻结区纪律 | `src/notifications/`、`src/domain/recurrence/` 零 diff；无 `as any`、无 `any` 新增；无新依赖；无关未跟踪提案文件（system-calendar-display-writeback-assessment.md）未入提交 |

## 范围落点表

| 文件 | 落点 | 解决的问题 |
| --- | --- | --- |
| `src/domain/ai/types.ts` | ParsedItemDraft 增 `reminderChannels?: ReminderChannel[]` / `needsClarification?: boolean` / `clarificationPrompt?: string`（带 JSDoc 语义注记） | 解析层可表达「强提醒渠道推荐」与「需澄清」信号；undefined=未表达 |
| `src/domain/ai/guard.ts` | 新增导出 `isReminderChannelArray`（元素 ∈ 四值 + expo 家族互斥）；isParsedItemDraft 三字段值出现即从严、键可缺省 | 旧版响应兼容 + 值从严校验；`['system-notification','alarm']` 同现整体拒绝 |
| `src/domain/ai/openAiCompatible.ts` | RemoteDraftWire 三键（可 null）；isRemoteDraftWire 尾部校验（键可缺省/null，值从严→拷贝）；wireToParsedItemDraft 归一（false/空串/null→undefined） | 远端路径透传澄清与渠道推荐；缺键不炸 schema-mismatch（ai.md v0.19 对 v0.16 的刻意偏离） |
| `src/domain/ai/prompt.ts` | 字段定义区三行（必填语义）+ 三节指令：强提醒场景与渠道推荐（普通提醒 null 禁自填 ["system-notification"]）、主动澄清（缺时刻反问/带时刻不反问/已有 offset·delay·重复禁反问）、多轮上下文与澄清续答（assistant=上轮草稿 JSON；续答并入上轮草稿并置回 false；「改成/改为」定位最近卡片只更新被提及字段——阶段 2 占位） | 远端模型按契约输出三字段；反问文案纪律（复用原词、只问缺失属性、单句） |
| `src/domain/ai/localFallback.ts` | 强提醒词表正则（起床/叫我/叫醒/喊我/唤醒/响铃/闹钟，只判定不裁剪）+ 意图短语槽（(提醒\|叫醒\|叫\|喊\|唤醒)我，认领出标题）+ 澄清判定与文案模板 + 标题兜底（强命中裁空→「起床」） | 本地降级层支持验收 2/3：`明天上午8点叫我`→alarm+起床+task+不澄清；`提醒我吃药`→「你要在什么时间提醒你吃药？」 |
| `src/domain/ai/merge.ts` | DraftField + `'reminderChannels'`（掩码合并）；needsClarification/clarificationPrompt 恒取新一轮 | 渠道推荐跨轮保留；澄清信号不粘滞——续答轮自动归位出卡 |
| `src/domain/ai/savePlan.ts` | 强提醒 once 分支（channels 已表达 + 无 offset/delay → startAt 时刻建 once，闹钟语义「8点叫就8点响」；allDay/无时间不建并披露）；渠道优先级 draft 显式 > defaultChannels > 单系统通知 | 决策①落库接线：验收 2 的「卡片显示闹钟、详情页渠道=闹钟」在数据层就绪 |
| `docs/contracts/ai.md` | v0.19 节扩写：三字段语义（普通提醒不携带该字段→落库走 defaultChannels，§7.30 不变）、wire 三键可缺省偏离及理由、savePlan 落库语义、影响范围与迁移方案 | 契约正文与本阶段实现一致（§7.12 契约正文优先） |
| `AGENTS.md` | §7.35 修订：澄清触发条件收敛为「缺关键属性且无其他可推断语义」；「明天上午8点叫我」改为「带完整时刻的叫醒类不反问，默认事由起床直接出卡」（决策③） | 消除任务卡验收 3 与 §7.35 原示例的语义冲突 |
| `tasks/slice-23.md` | 任务卡入库（untracked → 版本控制） | 切片产物可追溯 |
| 七个 `__tests__` 文件 | 见成果定性表用例增量；localFallback 既有「3天后提醒我复诊」一例按新行为更新（意图短语认领后标题「复诊」+ 澄清断言，注记行为演进） | 契约变更的回归防线；tsc 0 错前提 |

## 关键设计落点（阶段 2/3 的消费面）

1. **阶段 2（远端上下文编辑）**：Prompt「多轮上下文与澄清续答」节已含「改成/改为→定位最近卡片只更新被提及字段」占位指令；history 中 assistant 消息即上轮草稿 JSON（chat.ts historyAppend 既有约定，零改动）。阶段 2 只需把该占位指令从「描述性」升级为「结构性 history 摘要」（任务卡：history 正确包含上一张卡片摘要）。
2. **阶段 3（UI）**：`draft.needsClarification===true` + `clarificationPrompt` 为 Chat 侧澄清消息的直接数据源（useFlashChat/flash.tsx 判定后不渲染预览卡，渲染 AI 文本消息并引导续输）；`draft.reminderChannels` 含 `'alarm'` 为 FlashPreviewCard/FlashResultCard 渲染「⏰ 闹钟」标识的判据；确认保存路径 buildFlashSavePlan(draft, tzid, now, defaultChannels, presets) 签名不变。
3. **澄清续答闭环（阶段 3 联调点）**：续答轮用户回复（如「下午2点」）→ 本地/远端解析出完整时刻 → merge 后 needsClarification 归位 undefined → 正常出卡。merge 的「信号不粘滞」设计保证该闭环无需 UI 特判。

## 已知边界与风险（如实披露）

- **名词性命中**：本地词表「闹钟/响铃」不区分动词/名词语义，「买个闹钟送人」仍判 alarm 并澄清（单测如实固化该边界）；语义级判定依赖远端 Prompt，本地正则按任务卡最小集执行（决策②）。
- **「改成明天」解析路径边界**（沿 slice-22 披露）：只改日期的纠正句走解析路径会变 allDay 00:00，与 editIntent「时刻缺省保目标时刻」窄规则不一致——阶段 2 处理远端编辑意图时一并评估，本阶段未修。
- **远端三字段依赖模型自觉**：wire 键可缺省（v0.19 偏离），模型不输出三字段时远端路径退化为现状（不推荐渠道、不澄清）；Prompt 已按「必填 + 禁止自填」约束，真机有 Key 场景留阶段 3 验证（验收 4）。
- **allDay 强提醒不落库**：draft 渠道推荐 + allDay → 披露「全天条目暂不创建强提醒（未表达具体时刻）」，不静默丢弃。

## 真机验收清单（留阶段 3，摘自任务卡）

1. 输入「明天上午8点叫我」→ 保存后卡片显示「⏰ 闹钟」，详情页提醒渠道为「闹钟」（验收 2；单测已覆盖解析与落库两层）。
2. 输入「提醒我吃药」→ AI 反问「你要在什么时间提醒你吃药？」，回复「下午2点」后成功生成卡片（验收 3；本地路径单测覆盖，远端路径阶段 3 有 Key 实测）。
3. 先建「明天开会」再输入「改成7点半」→ 修改上一条而非新建（验收 4；阶段 2 交付后阶段 3 实测）。

## 教训索引

- 完整教训收 slice-23 closeout（收尾时补）；本阶段先记两条：
  - savePlan 的 startAt 解构自 CreateItemInput（`startAt?: number | null`），可空判定必须显式含 `undefined`（TS2345 教训，与既有 `startAt ?? null` 写法对齐）。
  - wire 判空用 `!== undefined` 不足以豁免 `null`（TS2488 不可迭代）——三新字段「null=未表达」语义下判空必须双条件。

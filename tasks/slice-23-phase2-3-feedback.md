# slice-23 阶段反馈：Phase 2–3 / 共 4（2026-11-15）

- 分支：`task/slice-23`（基点 main @ 8827699；阶段 1 commit e51ac5b + 反馈 88bc4bf）
- 状态：**Phase 2–3 代码与测试完成，暂停等待真机验收**（验收 2/3/4 与无 Key 澄清路径，清单见 §5）；验收通过后再做 Phase 4 收尾（closeout + push/merge）。
- 各阶段提交：
  - `9a83956` feat(s23): 阶段 2——远端上下文编辑（4 files，+346/−7）
  - `0430fb0` feat(s23): 阶段 3——Chat 澄清消费 + 卡片渠道标识（10 files，+526/−28）
  - 本反馈文件随 `docs(s23)` 提交（见 §7.33 情形 2：一次连续完成多阶段后暂停，一份文件覆盖）。

## 1. 成果定性

| 项 | 结果 | 对照 |
| --- | --- | --- |
| tsc --noEmit | 0 错 | 基线 0 错，持平 |
| jest --runInBand | 76 套件 / 1036 用例全过 | 基线 74/1012（阶段 1 后）→ +2 套件 +24 用例 |
| expo-doctor | 2 项失败，与预存基线一致（app config 非 CNG 同步；RN Directory 元数据：watermelondb untested + widget-snapshot-store/battery-optimization/@nozbe/simdjson 无元数据） | 无新增 |
| 真机验收 | 未执行（本会话交付验收步骤与素材，待真机） | — |

## 2. 范围落点

| 文件 | 改动 | 解决的问题 |
| --- | --- | --- |
| `src/domain/ai/prompt.ts` | 新增 `buildHistoryBriefing(history, tzid)`（末尾向前取最近 assistant 草稿 JSON，note 跳过；民用时间 getZonedParts 换算；块头「上一张卡片草稿摘要（修改时以此为准，禁止新建条目）：」+ 标题/时间/重复/分类/标签/优先级/渠道推荐/澄清注记）；多轮节指令升级（摘要块基准 + 毫秒禁令） | 远端模型无法由毫秒 epoch 反算民用日期（v0.16 教训），编辑意图缺民用基准 |
| `src/domain/ai/openAiCompatible.ts` | parse() 在 buildNowFacts 后拼接 briefing（无草稿时 system 内容不变） | briefing 进入远端请求 |
| `src/ui/useFlashChat.ts` | ①send() 澄清分支：needsClarification → setDraft(null) 不出预览卡、clarificationPrompt（兜底「信息还不完整…」）入消息流、degraded 补降级说明；②applyEditToDraft guard：澄清待补轮不被「改成X点」窄规则劫持；③appendEditHistory 契约回正（assistant=编辑后草稿 JSON，draftJson 参数，note 只留消息流） | §7.35 主动澄清 UI 消费；澄清轮续答经 merge 自然补全出卡；编辑路径 history 违反切片 15「assistant=草稿 JSON」契约且远端会读到过期草稿 |
| `src/domain/ai/types.ts` | FlashCardReminderSnapshot + `channels: ReminderChannel[]` | 结果卡/预览卡展示渠道所需快照 |
| `src/domain/ai/cardPayload.ts` | 快照组装 + `channels: [...reminder.channels]`（防御拷贝） | 同上 |
| `src/ui/FlashPreviewCard.tsx` | 新增 `describeDraftChannelLine`（alarm→⏰ 闹钟 / system-notification→🔔 通知 / 网络渠道按 REMINDER_CHANNEL_LABELS 列出 / 未表达不渲染行）；标签行后渲染「提醒：…」 | 任务卡验收 2 的预览卡渠道标识 |
| `src/ui/FlashResultCard.tsx` | 新增 `describeCardReminderLine`（返回 {icon,text}：alarm→⏰「闹钟 · 规则摘要」、system-notification→🔔「通知 · …」、网络渠道按标签）；替换固定 🔔 图标 | 保存后结果卡保留渠道语义，时间摘要不丢 |
| 测试（4 文件） | `src/ui/__tests__/useFlashChat.test.ts`（新，6 用例：澄清不出卡/续答出卡/窄规则不劫持/澄清清卡/强提醒 alarm/保存出结果卡）；`src/ui/__tests__/flashChannelDisplay.test.ts`（新，10 用例）；prompt.test（briefing 5 用例 + 多轮节断言更新）；openAiCompatible.test（briefing 注入 2 用例）；cardPayload.test（channels 快照 + 防御拷贝） | 澄清流转与渠道标识的回归保障 |
| `docs/contracts/ai.md` | 追加「v0.19 阶段 2/3 落点记录」 | 契约正文同步 |
| `tasks/slice-23.md` | 阶段 2/3 完成注记 | 任务卡状态 |
| `chat.ts` / `flash.tsx` | **零改动**（chat.ts 计划确认项；flash.tsx 普通文本气泡已可渲染澄清消息，hook 测试验证） | 范围控制 |

## 3. 关键设计落点（后续阶段/切片消费面）

- `buildHistoryBriefing` 为导出纯函数：后续如需在别的 provider（官方代理等）注入摘要，直接复用。
- 澄清状态机不变式：draftRef 恒保留最新草稿（含澄清轮），setDraft 只控制预览卡显隐；merge.ts 的「needsClarification 恒取新一轮」保证补全后信号归位。
- FlashCardReminderSnapshot.channels 恒携带：渲染侧读当下渠道标签，未来多渠道 UI 改造不改快照结构。
- 已知边界（沿用阶段 1 记录）：「改成明天」只改日期的说法仍会走解析路径（allDay 00:00），与 editIntent 窄规则（只认时刻）并存，统一化不在本切片。

## 4. 提交与可追溯

- 阶段 2 `9a83956`：prompt.ts、openAiCompatible.ts、prompt.test.ts、openAiCompatible.test.ts。
- 阶段 3 `0430fb0`：useFlashChat.ts、types.ts、cardPayload.ts、FlashPreviewCard.tsx、FlashResultCard.tsx、useFlashChat.test.ts、flashChannelDisplay.test.ts、cardPayload.test.ts、ai.md、任务卡。注：appendEditHistory 契约回正属阶段 2 内容，但与阶段 3 澄清分支同文件不可分，随本提交落库（提交信息已注明）。
- untracked `docs/proposals/system-calendar-display-writeback-assessment.md` 不入本切片提交（沿阶段 1 惯例，属另一评估议题）。

## 5. 真机验收清单（待执行；对应任务卡验收 2/3/4）

前置：无 Key 状态可验 1/2/5；有 Key 验 3（需在设置页配置 API Key）。

1. **强提醒全链（验收 2，无 Key 可验）**：闪电录入输入「明天上午8点叫我起床」→ 预览卡显示「提醒：⏰ 闹钟」→ 确认添加 → 结果卡提醒行「⏰ 闹钟 · 单次 …08:00」→ 点卡进详情页确认渠道「闹钟」→ 到 8 点实际响铃（全屏通知模拟，观察是否响）。
2. **澄清续答（验收 3，无 Key 可验）**：输入「提醒我吃药」→ **不出预览卡**，AI 回「你要在什么时间提醒你吃药？」（无 Key 时另见「未配置 AI Key，已用本地解析」）→ 回复「下午2点」→ 出完整卡（标题吃药、今天 14:00、无 ⏰）→ 保存成功。
3. **远端上下文编辑（验收 4，需 Key）**：先建「明天开会」，草稿未保存时输入「把时间调到8点」（避开本地窄规则命中的「改成X点半」说法，briefing 专项验证远端路径）→ 卡片日期沿用明天、时刻改 08:00，不新建条目。注：「改成7点半」会被本地窄规则先拦截（切片 22 行为，属预期分流，不说明远端失败）。
4. **窄规则不受澄清干扰**：澄清反问后直接输入「改成下午2点」→ 应出卡（解析合并），而非「该条目没有具体时间…」误导提示（hook 测试用例 ③ 的真机对照）。
5. **降级纪律**：任意一步断网/无 Key，确认有「已用本地解析」或降级说明，不出现空白回复。

## 6. 教训索引

- formatItemTime 返回 'YYYY-MM-DD HH:mm' 全格式，无独立 'HH:mm' helper——时刻断言需 `${formatItemDate(...)} HH:mm` 组合（useFlashChat.test 初版 3 处断言据此修正）。
- jest.mock 路径相对**测试文件**解析：src/ui/__tests__/ 下 mock '../../data'（首版 '../data' 解析到 src/ui/data 报 Cannot find module）。
- 静态 prompt 指令节本身含「上一张卡片草稿摘要」字样：not.toContain 短词必误中，判定摘要块有无须用完整渲染块头「上一张卡片草稿摘要（修改时以此为准，禁止新建条目）：」。
- tsc exit code 经 grep 管道后失真（grep 无匹配 exit 1）：判定 0 错看输出行数而非管道 exit code。

# slice-23 阶段反馈：Phase 2–3 / 共 4（2026-11-15）

- 分支：`task/slice-23`（基点 main @ 8827699；阶段 1 commit e51ac5b + 反馈 88bc4bf）
- 状态：**Phase 2–3 代码、测试与 MuMu 实测完成，暂停等待 Phase 4 收尾**（closeout + push/merge）；实测全过，响铃触发留观察（§5a）。
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
| 真机/模拟器验收 | **MuMu（0.23.0 / versionCode 4）实测通过**，见 §5a | — |

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

## 5. 真机验收清单

前置：无 Key 状态可验 1/2/5；有 Key 验 3（需在设置页配置 API Key）。

1. **强提醒全链（验收 2，无 Key 可验）**：闪电录入输入「明天上午8点叫我起床」→ 预览卡显示「提醒：⏰ 闹钟」→ 确认添加 → 结果卡提醒行「⏰ 闹钟 · 单次 …08:00」→ 点卡进详情页确认渠道「闹钟」→ 到 8 点实际响铃（全屏通知模拟，观察是否响）。
2. **澄清续答（验收 3，无 Key 可验）**：输入「提醒我吃药」→ **不出预览卡**，AI 回「你要在什么时间提醒你吃药？」（无 Key 时另见「未配置 AI Key，已用本地解析」）→ 回复「下午2点」→ 出完整卡（标题吃药、今天 14:00、无 ⏰）→ 保存成功。
3. **远端上下文编辑（验收 4，需 Key）**：草稿未保存时输入窄规则不命中的改时短语（如「时间改一下到8点」——注意「调到/改成」均在 EDIT_VERB_PATTERN 内会被窄规则拦截，初稿曾误选「把时间调到8点」，实测改用「改一下到」句式）→ 远端经 briefing 摘要块只改时刻，标题/日期保留，不新建条目。注：「改成7点半」会被本地窄规则先拦截（切片 22 行为，属预期分流，不说明远端失败）。
4. **窄规则不受澄清干扰**：澄清反问后直接输入「改成下午2点」→ 应出卡（解析合并），而非「该条目没有具体时间…」误导提示（hook 测试用例 ③ 的真机对照）。
5. **降级纪律**：任意一步断网/无 Key，确认有「已用本地解析」或降级说明，不出现空白回复。

## 5a. MuMu 实测记录（2026-11-15，0.23.0 / versionCode 4，a11y dump 驱动）

- 环境：MuMu `adb -s 127.0.0.1:16384`（Android 15，com.vibecoding.life，时区 Asia/Shanghai）；版本提升 0.22.0/v3 → 0.23.0/v4（沿 slice-22 旧包教训）后 `gradlew.bat assembleRelease` + `adb install -r` + 冷启动。
- **重要事实纠偏：MuMu 已配置 API Key**（install -r 保留应用数据，SecureStore 键值留存）——实测全部走**远端路径**（无「未配置 AI Key」降级文案出现）；无 Key 本地路径由 hook 测试（mock 无 Key + 降级断言）覆盖，未动用户存储的 Key。阶段 1 遗留的「远端路径有 Key 实测」就此覆盖。
- **验收 2 PASS（远端）**：「明天上午8点叫我起床」→ 预览卡「时间：2026-11-16 08:00」+「提醒：⏰ 闹钟」→ 确认添加 → 结果卡「⏰」「闹钟 · 单次 11-16 08:00（Asia/Shanghai）」+ 推迟 chips → 点卡详情页「已启用 · 渠道 闹钟 · 生效起点 2026-11-16 08:00 · 上次对账 22:50」。8 点实际响铃留用户观察。
- **验收 3 PASS（远端澄清闭环）**：「提醒我吃药」→ 不出新预览卡、AI 反问「你要在什么时间提醒你吃药？」→ 续答「下午2点」→ 「已更新卡片」+ 出卡「提醒吃药 · 任务 · 2026-11-15 14:00」且**澄清信号归位**；「吃药」命中 Prompt 强提醒场景 → 远端推荐 ⏰ 闹钟（§7.35 语义正确）；保存 → 详情页「已启用 · 渠道 闹钟 · 生效起点 2026-11-15 14:00 · 上次对账 22:53」。
- **验收 4a PASS（窄规则，草稿待确认路径）**：「明天下午3点写周报」→ 卡「写周报 · 2026-11-16 15:00」无渠道行（普通提醒不渲染 ✓）→「改成7点半」→ 卡片原地改「2026-11-16 07:30」，标题/单卡不变，note「已改为 2026-11-16 07:30（请核对卡片）」。
- **验收 4b PASS（briefing 远端编辑，窄规则不命中短语）**：「时间改一下到8点」（「改一下到」无 EDIT_VERB_PATTERN 模式动词）→ 走解析路径 + briefing 摘要块 → 「已更新卡片」无降级说明（真远端）→ 卡片只改时刻 08:00，**标题「写周报」与日期 11-16 原样保留、未新建条目**（确认添加恒 1 张卡）——「以摘要民用日期为基准、其余字段照抄」指令实测生效。
- **普通提醒落库 null 分支 PASS**：写周报草稿无任何提醒表达（无提前量/延迟/渠道）→ 保存后结果卡无提醒行（describeCardReminderLine(null)）、详情页不建提醒；默认渠道仅在实际创建提醒时生效。
- MuMu 库现存测试条目（可删）：叫我起床（明天 08:00，闹钟，兼作响铃观察素材）、提醒吃药（今天 14:00，闹钟）、写周报（明天 08:00，无提醒）。
- 观察项（不属本切片修复面）：FlashPreviewCard 时间行对非 allDay 草稿渲染「时间：2026-11-16 2026-11-16 07:30」（日期重复，describeDraftTime 既有格式行为，phase 2/3 未触碰该函数），留后续 UI 打磨切片处理。
- **验收后用户反馈修补（2026-11-15 晚，fix 提交见 git log）**：用户报告长历史下新增录入的卡片「盖住」历史区不顶上去。复现确认根因：**非倒置 FlatList 不自动跟随新内容**——长历史追加消息及预览卡出现压缩列表视口时滚动偏移不跟随，列表尾部被裁出屏外（a11y 证据：修复前新消息「下午5点喝水」不在可视树）。修复：flash.tsx 加 listRef + useEffect（依赖 messages.length / hasDraft / messages）自动 scrollToEnd。MuMu 复验（versionCode 5）：5 轮连发 10+ 条消息后最新消息、回执、预览卡全部在可视树，保存出结果卡同样滚底可见。该缺陷自切片 15 起即存在，长历史下才显性化。构建插曲：mergeDexRelease 的 classes.dex 被残留 gradle daemon 占用（「另一个程序正在使用此文件」），--stop 后重建通过。

## 6. 教训索引

- formatItemTime 返回 'YYYY-MM-DD HH:mm' 全格式，无独立 'HH:mm' helper——时刻断言需 `${formatItemDate(...)} HH:mm` 组合（useFlashChat.test 初版 3 处断言据此修正）。
- jest.mock 路径相对**测试文件**解析：src/ui/__tests__/ 下 mock '../../data'（首版 '../data' 解析到 src/ui/data 报 Cannot find module）。
- 静态 prompt 指令节本身含「上一张卡片草稿摘要」字样：not.toContain 短词必误中，判定摘要块有无须用完整渲染块头「上一张卡片草稿摘要（修改时以此为准，禁止新建条目）：」。
- tsc exit code 经 grep 管道后失真（grep 无匹配 exit 1）：判定 0 错看输出行数而非管道 exit code。

# tasks/slice-18-closeout.md — 切片 18 收尾移交（§7.10）

切片 18：多渠道并行与偏好设置（AGENTS.md v0.18 §7.29；变更提案 docs/proposals/slice-18-multi-channel.md，用户 2026-11-13 确认按推荐执行 5 个决策点）。
分支 `task/slice-18`；提交链：5c3c25c 立项（提案+任务卡+AGENTS v0.18）→ 22269c1 阶段1（schema v10 + 域模型 + 读写路径 + ScopedReminder 投影 + 契约 v0.18 节，42 文件 +1290/−262）→ c7306bb 阶段2（调度器家族感知 diff + 网络复合键定时器，9 文件 +605/−221）→ 78080cd 阶段3（UI 多渠道表单 + Chips 设置页 + 预设默认，10 文件 +596/−88）→ 本提交（closeout）。

## 环境事实
- Windows 原生 bash（无 MSYS）；包管理 npm；测试 jest preset=jest-expo。
- 模拟器：MuMu「猴王」=127.0.0.1:16384（Android 15，dev client com.vibecoding.life 已装）；metro 8081 常驻复用（后台重启会因端口占用退出）；`adb -s 127.0.0.1:16384 reverse tcp:8081 tcp:8081`。
- DB 硬验证：`adb shell run-as com.vibecoding.life sqlite3 life.db "<sql>"`（WAL 模式只读可读 wal 内容）。
- push 走代理 + HTTP/1.1：`git -c http.proxy=http://172.16.100.254:7893 -c http.version=HTTP/1.1 push`。
- `npx expo-doctor`：2 失败为预存基线（android/ CNG 同步提示、watermelondb/simdjson RN Directory 元数据），非本切片引入。
- 本切片**无原生依赖新增**（package.json native 区零改动），无需 rebuild dev client。

## 数据库/构建事实
- schema v9→v10（`22269c1`），migration step 三条 addColumns，**零 unsafeExecuteSql、零 SQL 回填**：
  - `reminders` +`channels_json` / `channel_configs_json`（均 isOptional TEXT）；**旧列 `channel`/`channel_config` 保留不删不写**（WatermelonDB 无 dropColumn；非可选 channel 列对新行由 sanitizedRaw 以 `''` 零值回填，读层 bridge 对 `''` 走默认渠道）。
  - `app_settings` +`chips_increments`（isOptional TEXT，默认 `[10,60]`）；`channel_presets` +`is_default`（boolean 非可选，v10 addColumns 自动回填 false）。
  - 旧数据平滑升级：读层 legacy bridge——`channels_json` 为 null/''/坏 JSON 时回退旧 `channel` 列（v9 存量行 `''` → 默认 system-notification），`channel_configs_json` 坏 JSON/非对象 → `{}` 不抛错。
- 验证基线：`npx tsc --noEmit` 零错误；`npx jest --runInBand` 66 套件 / **845 用例**全过（830 → 阶段1 新增 +7（serialize/parse/resolve + chips + isDefault + scopeReminder）→ 阶段2 +6（多渠道并行/家族切换/双网络补发）→ 阶段3 +7（toggleReminderChannel 3/多渠道 validate 2/buildCreate 组合 2）− 调整合并）；`npx expo-doctor` 同预存基线。
- 无 `as any`；新增文件零 `any`（JSON.parse 结果经显式 Record<string, unknown> 收窄）。

## 代码地图
- **域层**：src/domain/reminder.ts——Reminder 改 `channels: ReminderChannel[]`（≥1、至多一个 expo、去重 canonical 序）+ `channelConfigs: Partial<Record<ReminderChannel,string>>`；`EXPO_REMINDER_CHANNELS`/`isExpoReminderChannel`/`isNetworkReminderChannel`/`DEFAULT_REMINDER_CHANNELS`；CreateReminderInput{channels?, channelConfigs?}、UpdateReminderInput{channels?, channelConfigs?: Partial<..., string|null>}（null=清除，per-key merge）。settings.ts——chipsIncrements + CHIPS_MIN/MAX_ITEMS=1/4、MIN/MAX_MINUTES=1/10080、parseChipsIncrements（读层防御，坏值丢弃+截断+回退默认）与 validateChipsIncrements（写层严格，空/超4/非整数/越界抛错）。channelPreset.ts——ChannelPreset +isDefault（同 type 至多一个 true 由 Repository 同事务保证）。
- **数据层**：src/db/schema.ts（v10 列）+ migrations.ts（toVersion 10）+ models 三处注记；src/data/reminderRuleMapping.ts——`normalizeReminderChannelFields`（写路径：枚举校验/Set 去重/canonical 序/≥1/expo 互斥/per-key merge+null 清除/prune 非生效键）、`serializeReminderChannels/Configs`、`resolveReminderChannelRow`（读路径：新列优先，legacy bridge）、`parseReminderChannelsJson`（坏值→null 信号 legacy）。WatermelonItemRepository——toDomain/create/update 全量改形；`unsetOtherDefaultPresets`（db.write 事务内，同 type 除目标外全取消）；settings chips 写前 validate。
- **通知层**：src/notifications/channels/types.ts——`ReminderChannelId = ReminderChannel`、`ScopedReminder = Reminder & {channel; channelConfig}`、`scopeReminderToChannel`；ReminderScheduler——`listScheduledOurFamilies()`（expo-notifications trigger.channelId==='reminder-alarm' 判 alarm 家族，iOS 无 channelId 退化已披露）、scheduleForReminder/reconcile 家族感知 diff（家族变化即 cancel+重排，identifier 保持纯 occurrenceKey）、网络渠道 per (channelId×occurrenceKey) 复合键 `${channelId}|${occurrenceKey}`（networkTimers.networkTimerKey 全量重写）、missed 补发按渠道独立 attemptStatus（webhook ok 不抑制 apprise）、游标每 reminder 一次推进；500 全局预算/30 条每提醒每渠道不变。
- **UI 层**：src/ui/reminderForm.ts——ReminderFormValues.channels 多选 + `toggleReminderChannel`（expo 替换/保 ≥1/canonical 序）+ validate errors.channels；ReminderFormEditor/ReminderChannelFields 多选渲染、选中网络渠道各展开预设+配置输入、**默认预设自动填充**（选中跳变沿 + 配置为空时拉 is_default 应用一次）；OnceAtField `chipsIncrements` prop 动态 chips + `formatChipIncrementLabel`（整小时 +N小时）；src/app/settings/chips.tsx 新页（1–4 行动态输入、validateChipsIncrements 同规则、预览）；settings/channels.tsx「设为默认」+★；（tabs)/profile.tsx 入口；item/[id].tsx 读 getSettings().chipsIncrements 传两个表单实例。

## 踩坑教训
1. **WatermelonDB 非可选列的零值回填**：schema 列非 isOptional 时，不写该列的新行经 sanitizedRaw 按类型零值回填（string→`''`，boolean→false）——SQLite NOT NULL 满足。这使「旧列保留不写」方案成立，但测试断言须写明 `raw.channel === ''` 是 sanitized 行为而非落库值。
2. **expo-notifications trigger.channelId 是 Android 专属**：mock 的 NotificationRequest trigger 默认无 channelId；家族判定测试必须自造带 `channelId:'reminder-alarm'` 的 trigger。iOS 退化路径（无 channelId 视为 system）已在代码注释与提案披露。
3. **jest.spyOn(Platform, 'OS') 不可用于 getter**（`Property OS does not have access type get`）——用 `Object.defineProperty(Platform, 'OS', {value: 'android', configurable: true})`。
4. **schema 直比断言脆弱**：migrationsV9.test 对 schema.tables 直比 columnArray，is_default 加入后失配——改为 `columnArray.filter((c) => c.name !== 'is_default')`，已发布 step 不回改。
5. **多渠道 merge 语义易测错**：patch.channels 是整体替换、channelConfigs 是 per-key merge（null=清除）+ 收尾 prune——先写错两处测试期望（期望保留旧渠道），实为产品语义正确。
6. compress 工具调用须带真实 range refs + 非空 summary；startId/endId 填范围表达式（`mX–mY`）会被判 Invalid boundary。

## 验收实证（命令侧）
- `npx tsc --noEmit`：0 错误（阶段 1/2/3 每次提交前复跑）。
- `npx jest --runInBand`：66 套件 845 用例全过（阶段 2/3 复跑）。
- `npx expo-doctor`：仅 2 项预存咨询性警告。
- 单测覆盖：Schema v10 迁移（migrationsV8/V9 版本链更新 + is_default 过滤断言）、多渠道去重/互斥/merge/prune（reminderRuleMapping 13+3 describe）、legacy bridge 防御（reminderOnce 直置 channelsJson=null 模拟 v9 存量行）、家族感知 diff/双网络补发独立性（ReminderScheduler.test 6 新用例）、复合键定时器（networkTimers.test 全量重写）、表单多选（reminderForm.test 迁移+7 新用例）。

## 遗留披露
1. **真机验收已执行（2026-11-13，用户反馈）**：①多渠道双触发「通过」；②Chips [15,120] 显示「+15分钟/+2小时」通过，另提出增强需求（长按 chip 临时改数字，见候选 B）；③默认预设自动选中「通过」。验收标准 2–4 全过，切片按 §7.9 收官合并（main 972b4a4）。
2. **Scheduler 阶段 1 shim 已在阶段 2 移除**（shimScoped 删除，家族感知 diff 全量落地），无过渡代码残留；但 `Reminder.channel`/`channel_config` 旧列仍在 schema（只读不写，无 dropColumn 能力），待未来 schema 清理切片评估。
3. **iOS 家族判定退化**：无 trigger.channelId 时一律视为 system 家族——iOS 通知通道未配置 reminder-alarm channel，alarm 渠道在 iOS 上与 system 同家族（互斥仍由写路径保证，不产生双 identifier 冲突）；Android 行为精确。
4. **Chips 校验错误文案**为中文断言（「1–4 项」「1–10080」「整数分钟」），与 validateChipsIncrements 实现耦合；文案改动需同步测试。
5. 后续切片候选（详见提案 §10）：频道级静音时段、网络渠道重试策略（当前 attemptStatus 仅 ok/failed 一次）、旧列清理。

## 后续切片候选（真机验收反馈 2026-11-13，用户手动排任务）

### 候选 A：延迟提醒——「X分钟后提醒我…」不生成提醒（缺陷修复，切片 15/16 能力缺口）
- **真机复现**：闪电添加输入「10分钟后提醒我出门」→ 只建日程，无提醒、无任何提示（静默丢失）。
- **根因**（已排查定位）：解析层只有「提前X分钟提醒」槽位（`reminderOffsetMinutes`，语义=事件 startAt 前的提前量），不存在「从现在起 X 分钟后」的延迟提醒槽位：
  1. AI 路径：src/domain/ai/prompt.ts:39 只指令「提前X分钟提醒时填 reminderOffsetMinutes」；「10分钟后提醒我」不在指令内，模型不产出提醒字段。**用户要求：AI 需要输出新字段/新格式时，必须在提示词里明确告知标准格式（含示例与边界），不能依赖模型自行推断。**
  2. 本地降级路径：src/domain/ai/localFallback.ts:467-472 正则只匹配 `提前N分钟…(提醒|叫我|闹钟|响铃)` 与 `N分钟…(之?前|以前)…(提醒|叫我)`——「10分钟**后**」两者均不命中。
  3. 即便有提前量：src/domain/ai/savePlan.ts:49-51 `buildOnceReminderPlan` 必须锚定事件 `startAt`（触发时刻=startAt−offset），「出门」无绝对时间 → startAt null → notice「需设定时间才能提前提醒」不落库；且该输入下 `reminderOffsetMinutes` 未被解析出来，`reminderNotice` 也为 null，卡片静默。
- **修复方案**：草稿（ParsedItemDraft，docs/contracts/ai.md）新增 `reminderDelayMinutes: number|null`（正整数分钟）；prompt.ts 增加字段说明与示例（用户明确要求提示词里写清标准格式）；guard.ts 校验、merge.ts 多轮纠正合并、openAiCompatible.ts 响应映射同步；LocalFallback 新增 `N(分钟|小时)…后…(提醒|叫我|闹钟|响铃)` 槽位（复用提醒句式裁剪）；savePlan 新分支：recurrence 与 offset 皆空且 delay 非空 → once 提醒触发时刻 = now + delay×60000（无需 startAt，tzid 白名单照旧）；预览卡显示意图（如「10分钟后提醒」），多轮「改成20分钟后提醒」可更新。

### 候选 B：长按快捷 Chips 临时修改数字（功能）
- once 表单（src/ui/OnceAtField.tsx）快捷 chip 长按 → 行内数字编辑框 → 点对号提交；提交后 chip 标签变为临时值，可再次长按修改。
- **语义边界（用户确认）**：临时值仅本次编辑会话生效，**不写回** app_settings.chipsIncrements（设置页配置不受影响）；下次打开表单仍用全局配置渲染。

### 候选 C：默认提醒方式（功能，需 schema v11）
- 设置页新增「默认选中渠道」：4 种渠道（system-notification/alarm/webhook/apprise）多选，沿用 ≥1 项 + expo 家族互斥校验（复用 normalizeReminderChannelFields 的 expo 互斥语义）。
- 存储：app_settings 新列 `default_channels_json`（schema v10→v11 addColumns 套路，isOptional TEXT，缺省回退 ['system-notification']；读层坏值防御参照 parseChipsIncrements）。
- 生效点：新建/编辑提醒表单（ReminderFormEditor initial channels 取默认配置；编辑已有提醒仍以提醒自身 channels 为准）——**是否只在新建时生效待排任务时定**。

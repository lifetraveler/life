# tasks/slice-19-closeout.md — 切片 19 收尾移交（§7.10）

切片 19：延迟提醒意图补全 + 默认渠道偏好 + Chip 临时编辑（AGENTS.md v0.19 §7.30）。
分支 `task/slice-19`；提交链：2e664aa 立项（AGENTS v0.19 + 任务卡）→ 1fb1141 阶段 1（AI 域 reminderDelayMinutes + schema v11 默认渠道底座）→ e9215b8 阶段 2（落库 once 计划 + 默认渠道读取）→ 5db9cad 阶段 3（UI 设置页 + 表单接入 + 长按 Chip）→ 5ef51d0 验收修正 1（延迟锚定 startAt + 渠道跟随默认）→ 210c5b3 验收修正 2（网络渠道自动取预设）→ 本提交（closeout + 网络渠道可靠性提案）。

## 环境事实
- Windows 原生 bash（无 MSYS）；包管理 npm；测试 jest preset=jest-expo。
- 真机验收由用户执行（4 轮反馈：第一轮 m00678 暴露 2 处缺陷，第二轮 m00758 补充预设回退需求，最终确认"验证通过"）；MuMu 模拟器 127.0.0.1:16384 dev client（com.vibecoding.life）可用但本切片验收未依赖模拟器。
- push 走代理 + HTTP/1.1：`git -c http.proxy=http://172.16.100.254:7893 -c http.version=HTTP/1.1 push`。
- `npx expo-doctor`：2 失败为预存基线（android/ CNG 同步提示、RN Directory 元数据 watermelondb/simdjson/widget-snapshot-store），与 slice-18 基线一致，非本切片引入。
- 本切片**无原生依赖新增**（package.json 零改动），无需 rebuild dev client。

## 数据库/构建事实
- schema v10→v11（1fb1141）：**单条 addColumns**（`app_settings` +`default_channels_json`，isOptional TEXT），零 unsafeExecuteSql、零 SQL 回填；旧数据/新行兜底=读层 `parseDefaultChannels`（null/坏值→`["system-notification"]`）+ `getSettings` 建行写默认值；真机覆盖安装后 migration 实际执行（验收 4 通过实证）。
- AI 契约 v0.17：`docs/contracts/ai.md`（ParsedItemDraft/RemoteDraftWire + reminderDelayMinutes，语义节 + 变更记录）+ `docs/contracts/data-model.md`（default_channels_json 列节）+ `docs/contracts/repository.md`（AppSettings.defaultChannels 节）。
- 验证基线：`npx tsc --noEmit` 每次提交前 0 错误；`npx jest --runInBand` 66 套件/845 用例 → **70 套件/913 用例**全过（阶段 1 +3 套件 +52 用例；阶段 2 +6；阶段 3 0；验收修正 1 +3；验收修正 2 +1 套件 +7）。
- 无 `as any`；新增文件零 `any`。

## 代码地图
- **域层**：src/domain/settings.ts——AppSettings +`defaultChannels: ReminderChannel[]`，DEFAULT_APP_SETTINGS 复用 DEFAULT_REMINDER_CHANNELS；`parseDefaultChannels`（读层防御永不抛错：null/''/坏 JSON/非数组→回退；非法渠道丢弃；去重；expo 双开保留 canonical 靠前者 system-notification 丢 alarm；REMINDER_CHANNELS canonical 序）、`validateDefaultChannels`（写路径抛错：非数组/空/非法成员/expo 双开）、`serializeDefaultChannels`。src/domain/channelPreset.ts——`resolveChannelPreset(type, presets)`（默认预设→第一条→null；"第一条"=入参序=listChannelPresets created_at 降序最新优先）。
- **AI 域**：src/domain/ai/types.ts ParsedItemDraft +`reminderDelayMinutes: number | null`；guard.ts 同 offset 纪律（≥1 整数或 null，缺键整体拒绝）；merge.ts DraftField +合并行；openAiCompatible.ts RemoteDraftWire +守卫（缺键拒绝→旧响应降级 fallback，v0.16 先例）+透传；prompt.ts 字段行 +「延迟提醒判定规则」6 条（五档示例 10/30/60/90/120、只支持分钟/小时、天后/秒后→null、start 语义→null、提前 X→offset 互不覆盖、禁换算 start/end）；localFallback.ts `REMINDER_DELAY_RE` 延迟槽（纠正槽后、提醒偏移槽前；prevCharBlocked('前')；\d{1,4}+汉字≤99；半只修饰小时）；savePlan.ts——`buildDelayReminderPlan`/`toOncePlan` 共用、同现裁决（offset+delay 同现→startAt 可锚定时提前优先+披露「已保留在卡片」）、`delayAnchoredStartAt`（仅 startAt===null 锚定 fireInstant）、buildFlashSavePlan 第 4/5 参 defaultChannels/presets（渠道跟随默认；网络渠道空配置自动取 resolveChannelPreset；全无预设才一句事实披露「尚未配置任何渠道预设，到点投递会失败」）。
- **数据层**：src/db/schema.ts SCHEMA_VERSION=11；migrations.ts toVersion 11；models/AppSettingsModel.ts +defaultChannelsJson；src/data/WatermelonItemRepository.ts settings 三处（toDomainSettings/getSettings 兜底/updateSettings patch）。
- **UI 层**：src/app/settings/default-channels.tsx 新页（4 渠道多选 toggleReminderChannel+保存）；src/app/(tabs)/profile.tsx 入口；src/ui/ReminderFormEditor.tsx defaultChannels prop（initialValues 新建取默认、编辑回填自身）；src/app/item/[id].tsx useFocusEffect getSettings 接线；src/ui/OnceAtField.tsx 长按 Chip（localIncrements 仅本组件实例、1–10080 行内校验、不调用 updateSettings）；src/ui/FlashPreviewCard.tsx「提醒：X分钟后」；src/ui/useFlashChat.ts confirmSave Promise.all(getSettings, listChannelPresets) 失败回退。

## 踩坑教训
1. **正则可选组内的量词位置**：REMINDER_DELAY_RE 初版把「个」写成组内必需（`(?<n>…)\s*个\s*`）→「10分钟后」n 组捕获不到、convert null。可选助词要落在组内尾部（`\s*个?\s*`）；正则改动先 `node -e` 直测再落码。
2. **延迟锚定不能顶掉真实 startAt**：「仅延迟 + startAt 有值」用例抓出 fireInstant 顶掉事件时间（28h 差）→ `delayAnchoredStartAt = startAt === null ? fireInstant : null`。
3. **无谓重建 plan 对象破坏全量断言**：仅在真正解析出网络渠道配置时重建 reminderPlan——mapper 的重复计划不含 channelConfigs 键，无谓重建多塞 `channelConfigs: {}` 键致 toEqual 失败。
4. **isNetworkReminderChannel 不携带类型谓词**（普通 boolean）→ 手写窄化 `channel !== 'webhook' && channel !== 'apprise'`。
5. **CreateReminderInput.channels/startAt 可选** → 分支内 `(channels ?? [])` / `startAt ?? null`，否则 tsc 空安全报错。
6. **契约字段增长时 AI 测试 fixture 必须同步补键**：mapper/savePlan/chat 的完整字面量 fixture 缺 reminderDelayMinutes 时 tsc 抓不到（Record<string,unknown> 构造器），运行时被 isParsedItemDraft/isRemoteDraftWire 拒绝→路径静默变 degraded。新增契约字段先 grep 测试 fixture。
7. 「提前 30 分钟以后提醒」类夹糊表述两侧槽位都不匹配、留在标题——既有行为非回归，localFallback.ts 文件头裁决列表已如实披露。

## 验收实证（命令侧）
- 阶段 1（1fb1141）：tsc 0 错误；jest 69 套件/897 用例全过；Mock 解析「10分钟后提醒我」输出 reminderDelayMinutes:10（localFallback/openAiCompatible 用例覆盖）。
- 阶段 2（e9215b8）：tsc 0；jest 69/903。
- 阶段 3（5db9cad）：tsc 0；jest 69/903。
- 验收修正 1（5ef51d0）：tsc 0；jest 69/906。
- 验收修正 2（210c5b3）：tsc 0；**jest 70/913**。
- `npx expo-doctor`：2 项预存警告（同 slice-18 基线）。
- 真机验收（用户执行）：验收 3 延迟落库第一轮失败（条目丢开始时间落入待办组）→ 5ef51d0 修正后 ok；验收 4 默认渠道第一轮失败（savePlan 硬编码单渠道）→ 5ef51d0 修正；第二轮用户补充网络渠道参数应自动取预设 → 210c5b3 修正后用户确认「验证通过」；验收 5 长按 Chip ok；验收 6 到点通知到达 ok。

## 遗留披露
1. **网络渠道后台送达可靠性**：webhook/apprise 投递依赖进程存活，国产 ROM 省电冻结下会丢。变更提案 `docs/proposals/slice-20-network-channel-reliability.md`（方案 1 电池优化白名单 + 方案 2 前台服务，编号暂定 slice-20）已随本提交入库，**待用户确认后按 §7.17 惯例开工**；确认前不修改 src/notifications/ 实现文件与 android 原生配置。
2. **AI 同现语义为单计划**：offset+delay 同现时按「提前优先（startAt 可锚定）/延迟兜底」落一条 once，另一意图留在卡片并披露「暂不支持一次创建两条提醒」——双提醒同现留后续需求再议。
3. **wire 缺 reminderDelayMinutes 键→整体拒绝降级本地解析**（v0.16 先例）：不支持新契约的旧模型/网关响应整卡降级，已记 ai.md v0.17 变更记录。
4. **正则延迟槽已知边界**（localFallback.ts 文件头）：「过/等10分钟提醒我」（无后）、「X天后提醒我」（天单位）、「3天后提醒我」被日期槽认领→不产 delay；语义补足由 prompt 层承担（AI 路径不受限）。
5. expo-doctor 2 项预存警告延续 slice-18 基线，未处理，留未来基线清理切片。
6. 旧列清理遗留（slice-18 披露顺延）：reminders.channel/channel_config 旧列仍保留不写，待 schema 清理切片评估。

## 后续切片候选
1. **网络渠道后台送达可靠性**（提案已入库待确认：电池优化白名单 + 前台服务）。
2. AI 双提醒同现（一次输入同时产出「提前 X」与「Y 分钟后」两条 once）。
3. reminders 旧列清理（channel/channel_config，需 WatermelonDB 迁移策略评估）。

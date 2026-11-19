# 切片 32 收尾移交 — 闪电录入多提醒（wire reminders）+ AI 调试查看器

- 日期：2026-11-19
- 分支：`task/slice-32`（基点 main @ `525c16f`）
- 提案：`docs/proposals/slice-32-f1-multi-reminder-debug-viewer.md`（设计默认值经用户确认）
- 任务卡：`tasks/slice-32.md`
- 状态：三阶段完成；真机矩阵 8 项过 7.5 项（③ 远端半项阻塞披露，见 §五遗留）

## 一、交付清单

| 阶段 | 提交 | 内容 |
| --- | --- | --- |
| 阶段 1 域+数据层 | `56dbaf3` | wire v0.23 reminders / guard / merge / savePlan 多计划（L5 关闭）/ prompt 判定节 / lastDebug 副通道 / schema v16 两开关 / ai.md v0.23 / AGENTS §7.44+§8 / backlog 立项划项 |
| 阶段 2 UI | `50f8791` | 调试入口消息 + 弹层三节 + profile 两 Switch + FlashPreviewCard 绝对时刻行 |
| 阶段 3 收尾 | 本提交 | closeout / AGENTS §8 终态 / backlog 回写 |

## 二、环境与构建事实

- Node/npm 沿用仓库现状；无新依赖（§7.3 合规）。
- schema v15→v16：`app_settings` 追加 `show_ai_request` / `show_ai_response` 两个非可选 boolean（addColumns 回填 false，careful_mode/show_ai_usage 先例；零 unsafeExecuteSql）。真机实测旧 v15 数据升级成功（logcat `[🍉] Migrating from version 15 to 16... Migration successful`），两开关默认关、即时生效、force-stop 重启保持。
- 构建命令：`cd android && JAVA_HOME='F:/code/tools/jdk17/jdk-17.0.21+9' ./gradlew assembleRelease`（bundle 2090 modules ~28s，exit 0）。APK 复制为工作区根 `life-0.23.0-v10-s32.apk`（108MB，**永不提交**），`adb install -r` Success。
- 真机：MuMu 猴王 `127.0.0.1:16384`（emulator-5544/5554 同 VM；猜猜 `127.0.0.1:16416` 勿用——旧缓存 bundle）。浅色主题（用户切 DeepSeek 平台 + 填 Key 期间）。
- 验证终态：`npx tsc --noEmit` 0 错；`npx jest --runInBand` **98 套件 / 1408 用例全绿**（基线 98/1365，+43 只增不减）；`npx expo-doctor` 2 项预存失败无新增（CNG sync + RN Directory metadata）。

## 三、代码地图（阶段 1+2 全量）

| 文件 | 修改 |
| --- | --- |
| `src/domain/ai/types.ts` | `ParsedItemDraft.reminders?: number[]`（epoch 升序去重，DST gap 已丢弃）；`FlashCardPayload.reminder` → **`reminders: FlashCardReminderSnapshot[]`**（空数组=不渲染行） |
| `src/domain/ai/merge.ts` | `DraftField` + `'reminders'`；掩码合并（表达→本轮拷贝/未表达→沿用） |
| `src/domain/ai/guard.ts` | `isParsedItemDraft` reminders 校验：键可缺省、值从严（有限正整数）、**空数组拒绝**（reminderChannels 先例） |
| `src/domain/ai/openAiCompatible.ts` | `RemoteDraftWire.reminders?: RemoteDateTimeField[] | null` + `WIRE_REMINDERS_MAX=8`（缺省宽容/值从严整体拒绝/time 必非 null）；wireToParsedItemDraft 换算（DST gap 丢弃条目、去重升序）；`AiTurnDebugSnapshot` + `lastRequestBody/lastResponseBody` + `get lastDebug()`（parse 进入清空、每轮尝试覆盖、成功失败均保留；request=发送文本不含 headers）；requestParse 记录与发送同一 requestBodyText、错误响应体照常采集 |
| `src/domain/ai/savePlan.ts` | `FlashSavePlan.reminderPlans: ReminderPlan[]` / `reminderNotices: string[]`；`formatCivilInstant` / `collectOnceResult` helper；reminders 逐条 toOncePlan（≤now 披露含民用时刻）；offset/delay 各自落库（**L5 关闭**）；强提醒锚点条件补 `reminders 未表达`；跨来源按 startAt 去重保留先产出；recurrence 非空全披露只落重复计划；渠道覆盖/预设回填循环应用、缺预设合并一句 |
| `src/domain/ai/chat.ts` | `FlashTurnResult.debug: AiTurnDebugSnapshot | null`（远端轮恒携带含失败降级轮，与 usage 只报成功轮刻意不同；不进 draft/historyAppend） |
| `src/domain/ai/prompt.ts` | reminders 字段行 + 「绝对时刻提醒判定规则」节（≤8 条/超出取最早/time 必非 null/禁换算 offset/delay）；:94 毫秒禁反算句扩展 reminders；BriefingDraftShape.reminders + isNumberArray；renderBriefing「提醒时刻（reminders）」行 |
| `src/domain/ai/cardPayload.ts` | buildFlashCardPayload 第 3 参 `reminders: ReadonlyArray<Reminder>`，逐条快照拷贝 |
| `src/db/schema.ts` / `migrations.ts` / `models/AppSettingsModel.ts` / `src/domain/settings.ts` | v16 四件套（列/迁移/装饰器/接口+DEFAULT） |
| `src/data/WatermelonItemRepository.ts` | toDomainSettings 两键守卫回退；applyConfigSnapshot 写穿；getSettings/updateSettings 两键读写 |
| `src/domain/configSnapshot.ts` | normalizeSnapshotAppSettings 两开关（缺列保留本地/boolean 写穿/非法回退） |
| `src/ui/useFlashChat.ts` | `FlashDebugPayload` / `FlashChatMessage.debugPayload?` / readTurnSettings 两开关 / `pushDebugEntry`（degraded 文案区分）/ send 双路径接线；`patchReminderSnapshot`（chips/编辑对全部 once 顺延，按 id 命中替换 onceAt）；confirmSave reminderPlans 循环 createReminder（单条失败 warn+披露不中断不回滚）、notices 聚合 |
| `src/ui/flash.tsx` | MessageRow onPress；debugView state + openDebugModal（打开时读当下设置，失败回退双关）；Modal 三节（request 随 showRequest、response+draft 随 showResponse、全关提示行）；debug* styles Token 化 |
| `src/ui/profile.tsx` | 「AI 调试·查看输入/查看输出」两 Switch（乐观更新+回滚，AI 配置区块） |
| `src/ui/FlashPreviewCard.tsx` | `describeDraftRemindersLine` + 「提醒：…（绝对时刻）」行 |
| `src/ui/FlashResultCard.tsx` | `describeCardReminderLines`（多行渲染，alarm→⏰/通知→🔔） |
| `docs/contracts/ai.md` | v0.23：wire 键纪律小节 / reminders 落库语义节 / AI 调试查看器副通道节 / 变更记录 |
| `AGENTS.md` | v0.36：§7.44 全节 + §8 终态 |
| `tasks/backlog.md` | F1/L5/调试查看器立项划项 + 新候选 |
| 测试 | guard/openAiCompatible（wire+lastDebug）/chat（debug）/merge/prompt/savePlan/cardPayload/db 迁移例行升版/configSnapshot/categorySettings/viewQueries/useFlashChat（debug 入口 4 例）/FlashPreviewCard/flashChannelDisplay 等 |

## 四、真机矩阵（8 项）与证据（.tmp-s32/）

| # | 项 | 结果 | 证据 |
| --- | --- | --- | --- |
| ① | F1 原句回归「明天8点、10点提醒我吃药」 | ✅ 远端轮出卡（健康/⏰闹钟渠道推荐/提醒：08:00、10:00（绝对时刻））→ 保存两条 once 落库（详情页提醒（2）：单次 08:00/10:00 已启用·闹钟·对账完成），灰字「提醒时刻已过去」未再现 | 17-19/20-23 |
| ② | L5 双计划（offset+delay 同现） | ✅ 本地兜底句「明天10点开会提前10分钟提醒我,35分钟后提醒我发纪要」→ 双提醒槽 → 保存两条 once（09:50 offset 锚 + 11:39 delay 锚）落库；无「暂不支持一次创建两条提醒」文案 | 50-53 |
| ③ | 编辑轮不丢提醒意图 | ✅ 本地路径全验证：「改成明天下午4点」→ updateItemTime+shiftOnceReminders 对**全部 once** 顺延（09:50→10:05→15:50；11:39→11:54→17:39，双次顺延 DB 实测吻合）+ agenda 16:00 同步；**远端 reminders 掩码合并半项阻塞**（deepseek-flash CoT 问题，见遗留）；merge/briefing/wire 换算已由 jest 12+ 用例覆盖 | 56-59/61-72 |
| ④ | 查看器开关显隐 | ✅ 开→🔍 入口出现（成功/失败文案区分）+ 弹层三节（请求体/响应/草稿 JSON）；关→无入口 | 29-36 |
| ⑤ | 失败轮调试 | ✅ schema-mismatch 降级轮 debug 仍携带：弹层可见完整请求体（含系统提示词 reminders 节）+ 响应原文（usage: reasoning_tokens:1411）+ 本地兜底草稿 | 31-36 |
| ⑥ | 隐私无 Key | ✅ 无 Key 轮无 🔍 入口无用量行；弹层请求体**无 Authorization/headers**；响应含 usage token 数（show_ai_usage 关闭时聊天流不显示，弹层不受控——见遗留披露） | 07-09/32-35 |
| ⑦ | 回归点 23-25-29-30 | ✅ 23 alarm 强提醒推荐（吃药→闹钟）；25 认真模式开关默认 off、时间编辑轮不拦截（§7.37 语义）；29 chips +15分钟/+1小时 双 chips 在且全 once 顺延；30 重试关闭态失败文案无「已重试」尾缀（aiRetryMax=0 用户原设置） | 18/59/56 |
| ⑧ | schema v15→v16 | ✅ 迁移成功无错误；两开关默认关/即时生效/重启保持 | logcat + 01/08-10 |

## 五、踩坑与遗留披露

**踩坑（复现防护）**：
1. **deepseek-flash（reasoning 模型）把思维链直接拼进 `content`**（completion_tokens_details.reasoning_tokens>0），导致 JSON.parse 失败 → schema-mismatch 大面积降级；且会把 reminders 输出成毫秒数组（受 history assistant 毫秒 JSON 同化）。矩阵①成功轮证明模型行为不稳定（同模型偶发正确民用输出）。→ 新 backlog 候选：解析层适配（剥离 `<think>`/reasoning_content 或 prompt 加固）。**F1 修复本身已验证有效**（①的远端成功轮端到端过）。
2. MuMu 截图坐标换算：`adb exec-out screencap` 原图 900×1600，crop 截图坐标需加回偏移量——本会话多次把 crop 内坐标当全屏坐标误触（修改字段表单/详情页误导航）。教训：tap 前先整屏截图定位，crop 仅用于读图。
3. MuMu `input text` 中文直过（无软键盘硬件输入模式），但**百分比编码会留残串**（%E6%98 形式）；输入前先 `input keyevent 67`×20 清场。
4. uiautomator dump 对 RN（新架构）Text 节点**无 text 属性**，元素定位不可靠；改用整屏截图目测定位。
5. 聊天页输入框聚焦后 y 位移：聚焦前 (390,1443)、聚焦后 (390,1243)；发送按钮 (818,1443)/(818,1413 两行文本时)。tap 前先截屏确认当下布局。
6. jest 全量 12min+，`--runInBand` 下 DeepSeek 测试套件（openAiCompatible）含 1s 重试间隔用例属正常耗时。

**遗留（非本片范围）**：
1. **F2（切片 25 候选②，存量）**：已保存条目再保存=新建重复条目。本轮「开会」卡 confirmSave 后聊天卡与 DB 交互符合现状设计；未回归。
2. **deepseek-flash reasoning-in-content 适配**（新候选）：见踩坑 1；阻塞远端 reminders 掩码合并与复杂多提醒句式的真机完整验证。域层（wire/guard/merge/savePlan）已由 jest 全覆盖。
3. **调试弹层响应节含 usage 明细**：response 是原始信封（含 prompt_tokens/cache 命中/费用可推算面）。传输边界冻结只约束 request 不含 headers（Authorization 不采集）；usage 出现在 response 属信封原文固有内容，与 show_ai_usage 开关解耦（弹层受 show_ai_response 单独控制）。知悉即可，不改契约。
4. 猴王实例的 AI 服务重试设置仍为用户原值 0（关闭）；两调试开关已恢复默认关。

## 六、验证命令与结果汇总

- `npx tsc --noEmit` → 0 错（阶段 1/2/收尾三轮均过）
- `npx jest --runInBand` → 98 套件 / 1408 用例全绿（基线 98/1365 → +43）
- `npx expo-doctor` → 2 项预存失败（CNG sync / RN Directory metadata），无新增
- 真机： assembleRelease + install -r + 矩阵 8 项（§四）

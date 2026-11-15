# 切片 22 阶段反馈：Phase 1–3（闪电录入结果卡片化与快捷操作）

- 日期：2026-11-15（Phase 1–2 上午；Phase 3 下午续作）
- 阶段范围：**Phase 1–3 / 共 4**——ChatMessage 载荷扩展 + 保存成功出卡片消息 + 卡片 UI 与点击跳转详情 + 快捷推迟接线（startAt/onceAt 联动）与「修改成X点」编辑窄规则；Phase 4 真机验收随 Phase 3 同场完成（见文末实测记录），closeout 见 `tasks/slice-22-closeout.md`。
- 分支：`task/slice-22`（基点 main @ `076d291`）
- 状态：**全部阶段完成**（Phase 1–2 曾于上午暂停移交并写本反馈；下午续作 Phase 3 并同步完成 Phase 4 真机验收，收尾移交统一进 closeout）。

## 各阶段提交

| 提交 | 内容 | 文件/增删 |
| --- | --- | --- |
| `78f02c0` | docs(s22)：任务卡 + AGENTS.md §7.34 成文（v0.24） | 2 files, +74/−1 |
| `02444a0` | 阶段 1：ChatMessage 扩展 kind/cardPayload + buildFlashCardPayload 快照组装（ai.md v0.18 变更记录） | 5 files, +351/−12 |
| `88fa7b2` | 阶段 2：FlashResultCard 卡片 UI + flash.tsx 渲染 kind:'card' 消息、点卡跳 /item/[id] | 2 files, +255/−1 |
| `59876aa` | 阶段 3 纯函数层：postpone.ts（推迟计算）+ editIntent.ts（编辑窄规则）+ 任务卡范围注记/允许清单扩充 | 5 files, +330/−1 |
| `8461034` | 阶段 3 接线：useFlashChat postponeCard（startAt+Δ/endAt 保时长/onceAt 联动/卡片原地刷新）+ send() 编辑路径 + flash.tsx onPostpone 接通 | 2 files, +274/−9 |

## 成果定性表

| 验证项 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | 0 错（Phase 3 复验亦 0 错） |
| `npx jest --runInBand` | 74 套件 / 973 用例全过（Phase 1–2 后基线 72 / 932；+2 套件 +41 用例 = postpone.test.ts / editIntent.test.ts） |
| `npx expo-doctor` | 16/18 过；2 项失败 = 预存基线（app config 非 CNG 同步检查、React Native Directory 元数据检查），对照 slice-21 无新增 |
| APK 版本号 | 0.22.0 / versionCode 3（release 包，commit `4f710f0`；Phase 3 后重打装机仍为 0.22.0/versionCode 3——开发验证包不另升版本号） |
| 真机/模拟器验收 | MuMu 0.22.0/versionCode 3：保存出卡+点卡跳详情（含塌缩缺陷修复复验 61cc489）✓；Phase 3 推迟 chips+onceAt 联动+「修改成7点半」编辑路径 ✓（详见文末实测记录）；清单 3/4/5 留用户手验 |

## 范围落点表

| 文件 | 落点 | 解决的问题 |
| --- | --- | --- |
| `src/domain/ai/types.ts` | FlashCardCategorySnapshot / FlashCardReminderSnapshot / FlashCardPayload；ChatMessage 加可选 `kind`/`cardPayload`（非判别联合） | 卡片载荷结构化快照契约；既有构造点（chat.ts historyAppend 等）零改动 |
| `src/domain/ai/cardPayload.ts`（新） | `buildFlashCardPayload(created, timePatch, reminder, categories)` 纯函数 | 保存链落库产物 → 展示快照；startAt/endAt/allDay 取 plan.timePatch 落库终值（含切片 19 delay 锚定）；weekdays/onceAt 防御性拷贝 |
| `src/domain/ai/__tests__/cardPayload.test.ts`（新） | 6 用例 | 快照组装 / 终值透传 / 分类·提醒缺席回退 / 快照互不串扰 |
| `src/ui/useFlashChat.ts` | FlashChatMessage.kind 必填（push 默认 'text'）；pushCard；categoriesRef 镜像 + 空时兜底重读（失败回退空数组）；confirmSave 保存成功出卡片消息 | 保存成功恒追加 kind:'card' 消息，reminderNotice≠null 再补一条纯文本说明（Alert 行为不变）；保存链失败仍纯文本不出卡 |
| `src/ui/FlashResultCard.tsx`（新） | 左侧 4px 分类色条（null→#9E9E9E）+ 分类行（emoji+名）+ 标题 17/700 两行 + 📅 日期行 + 🔔 提醒行（formatReminderRuleSummary 现算）+ 推迟 chips 占位 | §7.34 卡片必含要素；chip 容器 flexWrap 自适应（§7.32）；startAt null 整行不渲染日期行 |
| `src/app/(tabs)/flash.tsx` | renderMessage 按 kind==='card' 分支渲染；useRouter + 点卡 `router.push('/item/'+itemId)` | 点击卡片主体跳详情页；chips 本阶段禁用占位（onPostpone 未接线） |
| `docs/contracts/ai.md` | v0.18 变更记录 | ChatMessage 实现侧形状扩展契约化（兑现 v0.15.1「如后续需要扩展在此契约补充」） |
| `src/domain/ai/postpone.ts`（新，Phase 3） | `computePostponedStartAt`（绝对毫秒平移）+ `computePostponedOnceAt`（onceAt 民用时刻平移后经 getZonedParts 归位；解析失败返 null） | 快捷推迟计算纯函数化；绝对平移天然 DST 安全，onceAt 民用日算术防漂移 |
| `src/domain/ai/editIntent.ts`（新，Phase 3） | `matchesEditIntent`（动宾短语后紧跟时间 token 才判定）+ `parseEditTimeRequest`/`resolveEditStartAt` | 「修改成7点半吧」改上一条而非建新事项；防误伤「修改简历下午3点」；半点/午别/全角数字支持；日期缺省保目标日期、时刻缺省保目标时刻 |
| `src/domain/ai/__tests__/postpone.test.ts`（新，Phase 3） | 8 用例 | startAt 平移 / onceAt 民用归位 / 脏 onceAt 跳过 |
| `src/domain/ai/__tests__/editIntent.test.ts`（新，Phase 3） | 33 用例 | 意图识别（含 7 条防误伤）/ 半点·午别·冒号·全角 / 目标日期·时刻缺省保留 / DST 民用日不漂移（America/New_York 春季缺口用例）/ gap → null |
| `src/ui/useFlashChat.ts`（Phase 3 增量） | `postponeCard`（busy 守卫 + updateItemTime + shiftOnceReminders + reconcile warn + updateCard 原地刷新）；`send()` 编辑窄规则路径（草稿→改草稿；结果卡→updateItemTime+onceAt 联动+卡片刷新）；messagesRef 镜像 + getLastCardPayload | chips 联动落库与卡片原地重渲染；编辑意图改时间不建新事项；失败推 `推迟失败：…`/`修改失败：…` 不落回解析 |
| `src/app/(tabs)/flash.tsx`（Phase 3 增量） | 卡片分支传 `onPostpone` → `chat.postponeCard(payload.itemId, minutes)` | +15分钟/+1小时 chips 从禁用占位变为可用 |
| `tasks/slice-22.md` | 阶段 3 范围注记（用户 2026-11-15 确认折叠问题 2）+ 允许清单/验收 2 扩充 | editIntent/postpone 及单测纳入本切片范围；创建流半点解析保持已知限制披露 |

## 关键设计落点（后续切片/消费面）

- **Phase 3 已接线（原预留描述，现为完成态）**：flash.tsx 传 `onPostpone` → `useFlashChat.postponeCard(itemId, minutes)` → `updateItemTime(startAt+Δ，endAt 有值同 Δ 保时长)` + `shiftOnceReminders`（once 提醒 `updateReminder({onceAt})` 联动顺延）+ `updateCard` 原地替换 cardPayload（结构化快照：只替换 startAt / endAt / reminder.onceAt，🔔 行 once 文案自动随快照变化）。chips 未传 onPostpone 时仍呈禁用占位（防御路径保留）。
- **onceAt 联动计算**：`computePostponedOnceAt`（postpone.ts）——getZonedParts 解析现 onceAt+tzid → +minutes → resolveCivilTimeToInstant 回民用；解析失败返 null 由调用方跳过该提醒（脏数据不阻断推迟）。单测覆盖推迟计算/onceAt 顺延（任务卡验收 2）。
- **编辑窄规则（用户 2026-11-15 确认折叠）**：`editIntent.ts` 动宾短语（改成/改到/改为/改至/调成/换到/换成/修改成/修改时间至/调整成/更改成…）后紧跟日期/时刻 token 才判定编辑意图；仅降级层语义（远端 AI Key 路径不经此规则）；`send()` 开头先于原解析流程：有未保存草稿改草稿，否则取最近结果卡改时间（updateItemTime + onceAt 联动 + 卡片刷新）。创建流的「7点半」半点解析仍是已知限制。
- **提醒行文案来源**：formatReminderRuleSummary(snapshot)，once 显示绝对触发时刻（单次 11-07 08:50（Asia/Shanghai）），daily/weekly/monthly 走各自文案；tzid 后缀恒带。
- **导航纪律**：FlashResultCard 只发 onPress，路由在屏幕层（§7.23 UI 不自查数据）。

## 真机验收清单（Phase 4 执行；1–5 可随本阶段先行核对）

1. ✅ 「明早9点开周会 提前10分钟提醒」→ 聊天流出卡片（📅 行含 09:00，🔔 行 08:50）（本轮以 15:00/14:50 同构验证）；
2. ✅ 点击卡片主体 → `/item/[id]` 详情页正确条目；
3. ⬜ allDay 条目 → 日期行「全天」、无推迟 chips（单测已覆盖，真机手验留用户）；
4. ⬜ 无时间待办（startAt null）→ 无日期行、无 chips（单测已覆盖，真机手验留用户）；
5. ⬜ 保存链失败 → 仍纯文本「保存失败：…」不出卡（留用户手验）；
6. ✅ （Phase 3）+15分钟 → 卡片 +15、提醒同步 +15、详情页 startAt/onceAt 已改（本轮 15:00/14:50 → 15:15/15:05）；
7. ✅ （Phase 3 追加）保存成功后紧跟「修改成7点半吧」→ 原卡片改时间不建新事项（本轮 15:15 → 07:30，提醒 15:05 → 07:20，助手消息「已改为 2026-11-16 07:30」）。

### 本阶段 MuMu 实测记录（2026-11-15，0.22.0/versionCode 3，a11y dump + 截图驱动）

- ✅ 清单 1/2 已先行核对：输入「明天下午3点开周会 提前10分钟提醒 #工作」→ 确认添加 → 聊天流出卡（左侧工作色条、💼 工作、粗体标题、📅 11月16日周一 | 15:00、🔔 单次 11-16 14:50（Asia/Shanghai）、+15分钟/+1小时 占位 chips）；点卡主体跳 `/item/[id]`，详情页「开始：2026-11-16 15:00」「单次 11-16 14:50（Asia/Shanghai）」一致。测试条目「开周会」暂留 MuMu 库中（可兼作 11-16 14:50 once 提醒触发验证素材，不需要时详情页删除）。
- ❌→✅ 缺陷修复：首版卡片在聊天流中塌缩为 ~55px×280px 竖条（仅分类色条，正文零宽不进 a11y 树），见教训 2；修复后复验通过（提交 61cc489）。
- 驱动方法沉淀：`adb shell input text` 直接过 UTF-8 中文（MuMu 验证），**空格需写 `%s`**（字面空格截断参数；MuMu 对 `%s` 亦不转换、按字面入库，本轮靠本地降级解析的容错通过——正式验收手输中文为宜）。

### Phase 3 MuMu 实测记录（2026-11-15 下午，0.22.0/versionCode 3 重打装机，同法驱动）

- ✅ 清单 6（推迟 chips）：新建「明天下午3点开周会提前10分钟提醒」→ 出卡（15:00 / 14:50）→ 点 +15分钟 → 卡片原地变「📅 11月16日周一 | 15:15」「🔔 单次 11-16 15:05（Asia/Shanghai）」，无新消息条目、无新事项。
- ✅ 清单 7（编辑窄规则，用户回归场景）：输入「修改成7点半吧」→ 原卡片变「07:30」，提醒行变「单次 11-16 07:20（Asia/Shanghai）」，追加助手消息「已改为 2026-11-16 07:30」，未建新事项；07:20 = 15:05 − 7h45m（与 startAt 偏移一致，onceAt 联动正确）。
- ✅ 详情页 DB 真值：点卡进 `/item/[id]`，「开始：2026-11-16 07:30」「提醒（1）单次 11-16 07:20（Asia/Shanghai）」「上次对账 2026-11-15 15:02」（updateItemTime/updateReminder/reconcile 全部落库）。
- 驱动注意：本轮 `%s` 在输入框按字面保留（与上轮观察一致），清空重输无空格中文串「明天下午3点开周会提前10分钟提醒」后本地降级解析正常。
- 本轮测试条目「开周会」（11-16 07:20 once 提醒）与上轮「开周会」（11-16 14:50 once 提醒）均暂留 MuMu 库，可兼作 11-16 两条 once 提醒触发验证素材，不需要时详情页删除。

## 教训索引

- 待切片收尾汇总至 `tasks/slice-22-closeout.md`。本阶段踩坑 2 条：
  1. Reminder.startAt 为 `number` 非可空（once 提醒以 fireInstant 落库，savePlan 语义），测试夹具初版写 `null` 触发 TS2322，改 `new Date('2026-11-16T08:50:00+08:00').getTime()`。
  2. **row 容器内 flex:1 塌缩**：renderMessage 曾把 FlashResultCard 包进 `flexDirection:'row'` 的 cardRow wrapper——row 主轴按内容测宽，卡内 `flex:1`（flexBasis 0%）的 body 在内容尺寸容器中贡献 0 宽，整卡塌缩只剩 4px 色条；FlashPreviewCard 一直正常是因为其父容器为默认 column（交叉轴拉伸）。修复=卡片直接作 FlatList 单元渲染，不包 row wrapper（61cc489）。推论：凡 maxWidth 卡片放进聊天流列表，根布局不要套水平方向容器。
- Phase 3 踩坑 2 条：
  1. **dayShift 语义是「相对今天」的民用日偏移**，不是相对目标条目日期——resolveEditStartAt 首版测试按「目标+1 天」写期望两次跑挂（得 11-16 期望 11-17），修正为 dayShift:2 后天才得 11-17；「明天/后天」是相对说话时刻的日期词，实现语义正确、测试语义错。
  2. **DST gap 用例的目标日要真正落进缺口日**：dayShift:null 会取目标条目民用日（03-07，该日 02:30 存在）——gap 断言必须 dayShift:1 把民用日推进到 03-08 才会命中缺口返回 null。

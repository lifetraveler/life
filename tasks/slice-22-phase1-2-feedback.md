# 切片 22 阶段反馈：Phase 1–2（闪电录入结果卡片化）

- 日期：2026-11-15
- 阶段范围：**Phase 1–2 / 共 4**——ChatMessage 载荷扩展 + 保存成功出卡片消息 + 卡片 UI 与点击跳转详情；快捷推迟（Phase 3）与真机验证收尾（Phase 4）未做。
- 分支：`task/slice-22`（基点 main @ `076d291`）
- 状态：**暂停等待下一阶段**（Phase 3 快捷推迟接线、Phase 4 真机验证与 closeout 留待后续会话，开工按 §7.1 逐阶段确认）。

## 各阶段提交

| 提交 | 内容 | 文件/增删 |
| --- | --- | --- |
| `78f02c0` | docs(s22)：任务卡 + AGENTS.md §7.34 成文（v0.24） | 2 files, +74/−1 |
| `02444a0` | 阶段 1：ChatMessage 扩展 kind/cardPayload + buildFlashCardPayload 快照组装（ai.md v0.18 变更记录） | 5 files, +351/−12 |
| `88fa7b2` | 阶段 2：FlashResultCard 卡片 UI + flash.tsx 渲染 kind:'card' 消息、点卡跳 /item/[id] | 2 files, +255/−1 |

## 成果定性表

| 验证项 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | 0 错 |
| `npx jest --runInBand` | 72 套件 / 932 用例全过（基线 71 / 926，+1 套件 +6 用例 = cardPayload.test.ts） |
| `npx expo-doctor` | 16/18 过；2 项失败 = 预存基线（app config 非 CNG 同步检查、React Native Directory 元数据检查），对照 slice-21 无新增 |
| APK 版本号 | 0.22.0 / versionCode 3（release 包，commit `4f710f0`；MuMu 127.0.0.1:16384 已装并冷启动 ✓） |
| 真机/模拟器验收 | MuMu 0.22.0/versionCode 3：保存出卡+点卡跳详情已实测通过（含塌缩缺陷修复复验 61cc489）；清单 3/4/5 与 Phase 4 正式验收待做 |

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

## 关键设计落点（Phase 3/4 的消费面）

- **Phase 3 接线点**：FlashResultCard 已预留 `onPostpone?: (minutes: number) => void`，未传时 chips 呈禁用占位；接线 = flash.tsx 传回调（更新 `updateItemTime(startAt+minutes)` + `updateReminder(onceAt)` 联动顺延）+ 原地替换消息的 cardPayload（结构化快照：只替换 startAt / onceAt 字段，🔔 行 once 文案自动随快照变化）。
- **onceAt 联动计算**（Phase 3 实现，任务卡验收要求单测覆盖推迟计算/onceAt 顺延）：getZonedParts 解析现 onceAt+tzid → +minutes → resolveCivilTimeToInstant 回民用。
- **提醒行文案来源**：formatReminderRuleSummary(snapshot)，once 显示绝对触发时刻（单次 11-07 08:50（Asia/Shanghai）），daily/weekly/monthly 走各自文案；tzid 后缀恒带。
- **导航纪律**：FlashResultCard 只发 onPress，路由在屏幕层（§7.23 UI 不自查数据）。

## 真机验收清单（Phase 4 执行；1–5 可随本阶段先行核对）

1. 「明早9点开周会 提前10分钟提醒」→ 聊天流出卡片（📅 行含 09:00，🔔 行 08:50）；
2. 点击卡片主体 → `/item/[id]` 详情页正确条目；
3. allDay 条目 → 日期行「全天」、无推迟 chips；
4. 无时间待办（startAt null）→ 无日期行、无 chips；
5. 保存链失败 → 仍纯文本「保存失败：…」不出卡；
6. （Phase 3 后）+15分钟 → 卡片 09:15、提醒 08:50→09:05、详情页 startAt/onceAt 已改（任务卡 §6）。

### 本阶段 MuMu 实测记录（2026-11-15，0.22.0/versionCode 3，a11y dump + 截图驱动）

- ✅ 清单 1/2 已先行核对：输入「明天下午3点开周会 提前10分钟提醒 #工作」→ 确认添加 → 聊天流出卡（左侧工作色条、💼 工作、粗体标题、📅 11月16日周一 | 15:00、🔔 单次 11-16 14:50（Asia/Shanghai）、+15分钟/+1小时 占位 chips）；点卡主体跳 `/item/[id]`，详情页「开始：2026-11-16 15:00」「单次 11-16 14:50（Asia/Shanghai）」一致。测试条目「开周会」暂留 MuMu 库中（可兼作 11-16 14:50 once 提醒触发验证素材，不需要时详情页删除）。
- ❌→✅ 缺陷修复：首版卡片在聊天流中塌缩为 ~55px×280px 竖条（仅分类色条，正文零宽不进 a11y 树），见教训 2；修复后复验通过（提交 61cc489）。
- 驱动方法沉淀：`adb shell input text` 直接过 UTF-8 中文（MuMu 验证），**空格需写 `%s`**（字面空格截断参数；MuMu 对 `%s` 亦不转换、按字面入库，本轮靠本地降级解析的容错通过——正式验收手输中文为宜）。

## 教训索引

- 待切片收尾汇总至 `tasks/slice-22-closeout.md`。本阶段踩坑 2 条：
  1. Reminder.startAt 为 `number` 非可空（once 提醒以 fireInstant 落库，savePlan 语义），测试夹具初版写 `null` 触发 TS2322，改 `new Date('2026-11-16T08:50:00+08:00').getTime()`。
  2. **row 容器内 flex:1 塌缩**：renderMessage 曾把 FlashResultCard 包进 `flexDirection:'row'` 的 cardRow wrapper——row 主轴按内容测宽，卡内 `flex:1`（flexBasis 0%）的 body 在内容尺寸容器中贡献 0 宽，整卡塌缩只剩 4px 色条；FlashPreviewCard 一直正常是因为其父容器为默认 column（交叉轴拉伸）。修复=卡片直接作 FlatList 单元渲染，不包 row wrapper（61cc489）。推论：凡 maxWidth 卡片放进聊天流列表，根布局不要套水平方向容器。

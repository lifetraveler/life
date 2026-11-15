# 系统日历「直读显示」与「写入系统日历」调研报告

- 日期：2026-11-15
- 性质：**纯调研，零代码改动**（不触碰任何源码/契约/配置）
- 动机：用户提出两个问题——①日程能否写入系统日历；②Toki 里可以选择显示哪些日历、直接读取显示，我们现在是「导入→转成本库数据」，能否不导入直接读系统日历显示
- 参考：Toki 实机截图（`tasks/toki_2.webp` 系统事件详情页底部标「只读」、`tasks/toki_3.webp` 系统日历事件与自有条目混排同视图，系统事件用日历色块渲染）——证实 Toki 是**直读显示**模式而非导入模式
- 工程版本基线：Expo SDK ~54.0.0 / expo-calendar ~15.0.8（package.json:25）

---

## 1. 结论速览

| 问题 | 结论 |
| --- | --- |
| 能否不导入、直读系统日历显示（Toki 式，可选日历） | **可行，且工程条件很好**——切片 9 已有 `SystemCalendarReader` 读取端口（权限、日历列表、范围查询全部现成），缺的只是「日历多选持久化 + 视图合并渲染」。不落库，不触碰 7.15 的 sourceType/sourceUid 冻结语义 |
| 能否把我们的日程写入系统日历 | **技术可行，契约禁止**。expo-calendar 15.0.8 写 API 全套存在且 Android `WRITE_CALENDAR` 权限已随切片 9 读权限一并授予（7.15 方案 A 事实）；但 `AGENTS.md` §7.15 与 `docs/contracts/repository.md:142` 明文「不调用任何写入系统日历的 API」——写回属于契约变更，必须先走变更提案（先例：slice-11/16） |
| 推荐路线 | 先做 **live 直读显示**（纯读、低风险、高感知），把「导入」降级为可选升级动作（想参与提醒/搜索/小组件再导入）；**写回单独立项**，推荐「写入 App 专属日历」方案，提案确认后实施 |

---

## 2. 工程现状盘点（已有哪些资产）

| 资产 | 位置 | 对新方案的意义 |
| --- | --- | --- |
| 系统日历读取端口 `SystemCalendarReader`（requestPermissions / getCalendars / getEvents，窗口外扩 1 天解决 Android Instances 纯包含式查询） | `src/data/systemCalendarAdapters.ts:16-99` | **live 显示可直接复用**，一行不用改；仅需扩 `SystemCalendarInfo` 返回 color / source 名（目前只透传 id/title，`src/domain/systemCalendar/types.ts:7-12`） |
| 纯类型与 sourceUid 生成（event-id 优先，否则 SHA-256 前 16 位 of `${calendarId}|${title}|${startAt}|${endAt}`） | `src/domain/systemCalendar/sourceUid.ts:17-40` | live 显示与已导入项的比对可复用同一函数 |
| 导入管线（预览→确认→落库，`importSystemCalendarEvents` 签名冻结） | `docs/contracts/repository.md:127-142`、`src/data/ItemRepository.ts:45-80` | 保持不动；live 方案下导入从「唯一入口」变为「可选动作」 |
| 权限事实：expo-calendar 15.0.8 Android `requestCalendarPermissionsAsync` 单弹窗同时请求 READ_CALENDAR + WRITE_CALENDAR，两者均授予才放行 | `AGENTS.md` §7.15、`src/data/systemCalendarAdapters.ts:32-36` | **写回不需要任何新权限弹窗**（WRITE_CALENDAR 已在手） |
| 视图数据流：`observeItemsWithTags` 单订阅全量条目 → 客户端按日分组，4 视图（日程/周/月/日） | `src/app/(tabs)/plan.tsx:390`（§7.21） | live 事件作为第二条数据流，在「分组前」合并进同一管道即可，视图分组逻辑零改动 |
| app_settings 迁移先例（v7/v10/v11 均为 addColumns、默认回填） | `src/db/schema.ts:138-149` | 日历多选持久化照抄此模式（v12） |
| 筛选面板已有「日历源 sourceType」多选 | `src/ui/FilterSheet.tsx` | live 显示需要新增一个 UI 级「系统日历（实时）」筛选类别（不改冻结枚举本身） |

---

## 3. expo-calendar 15.0.8 能力事实（已验证）

签名来自 `node_modules/expo-calendar/build/Calendar.d.ts`（本机已装版本，非文档猜测）：

**写入 API（全部存在）：**
- `createEventAsync(calendarId, eventData?) => Promise<string>`（d.ts:721）
- `updateEventAsync(id, details?, recurringEventOptions?) => Promise<string>`（d.ts:729）
- `deleteEventAsync(id, recurringEventOptions?) => Promise<void>`（d.ts:735）
- `createCalendarAsync(details?) => Promise<string>`（d.ts:682）/ `deleteCalendarAsync(id)`（d.ts:694）
- `getEventAsync(id, recurringEventOptions?) => Promise<Event>`（d.ts:714）
- `createEventInCalendarAsync(eventData?, presentationOptions?) => Promise<DialogEventResult>`（d.ts:648）——**调起系统自带新建事件表单**；官方文档明确：只用系统 UI 时 Android 无需申请任何日历权限；代价是 Android 返回的 `DialogEventResult.id` 恒为 `null`，无法跟踪后续编辑/删除

**事件可写字段（ModifiableEventProperties）：** `title` / `location` / `timeZone` / `url` / `notes` / `alarms` / `recurrenceRule` / `availability` / `startDate` / `endDate` / `allDay`

**闹钟 alarms：** `{ relativeOffset }`（相对开始时刻的分钟数，文档明确「负值 = 提前触发」）+ Android `method`（ALARM/ALERT/DEFAULT/EMAIL/SMS）→ 与本库 Reminder「提前 X 分钟」**一一对应可映射**（仅 system-notification 渠道可映射；webhook/apprise 无系统对应物）

**重复 recurrenceRule：** `frequency` DAILY/WEEKLY/MONTHLY/YEARLY + `interval` + `occurrence | endDate`。
⚠️ 本库冻结枚举恰好是 daily/weekly/monthly（AGENTS §4.5）→ **单频率重复可无损映射**；但 `daysOfTheWeek`（「每周一三五」多选日）等复杂字段**标注 iOS-only** → Android 写「weekdays 多选日」的重复规则**表达不了**，只能降级（单次或不写该类项）。这是写回方案的一个硬约束。

**重复事件的 ID 语义（关键发现，读原生源码验证）：**
- `getEventsAsync` 查的是 Instances 表，返回的是**实例**；投影第 0 列 = `CalendarContract.Instances.EVENT_ID`（`node_modules/expo-calendar/android/src/main/java/expo/modules/calendar/Constants.kt:54`），映射进 `event.id`（`CalendarModule.kt:711`）；实例唯一 id 在第 18 列 `Instances._ID`，映射进 `event.instanceId`（CalendarModule.kt:731-735）
- 即：**同一重复系列的所有实例，`event.id` 相同，`instanceId` 才互不相同**
- 而本库 `toDomainEvent` 只取 `raw.id`（`src/data/systemCalendarAdapters.ts:52-53`）→ 推论（待真机复核）：切片 9 导入一个重复系列时，范围内 N 个实例 sourceUid 全部相同 → 按 (sourceType, sourceUid) 去重后**只有第一个实例落库，其余计 skippedDuplicate**
- 对 live 显示的影响：按 externalId 匹配「已导入」会误伤整个系列——自动去重必须叠加「startAt 相等」条件（见 §5）

**平台与权限：**
- Android 直写需 `WRITE_CALENDAR`——已在手（§2 权限事实）
- iOS：EventKit 同形状 API；iOS 17+ 支持 write-only 授权模式（config 插件 `writeOnlyAccess`）；`recurringEventOptions`（单实例/未来系列更新）为 iOS-only
- Web：expo-calendar 平台限定 `ios* / android*`，**不支持 web** → 入口与读取路径需平台 gating
- 已知历史坑：Android `allowsModifications` 曾被报告恒为 false（expo#15011）→ 选写回目标日历不能只信该字段，需真机验证

**升级断裂点（提前知情）：** SDK 57/58 起 expo-calendar 换新 class API（`ExpoCalendar`/`ExpoCalendarEvent`）：去掉 Async 后缀、create 返回实例而非 id、新 API 的 update/delete 只支持「整系列」（`recurringEventOptions` 移除）；legacy API 保留在 `expo-calendar/legacy` 子路径可渐进迁移。当前 15.0.8 就是 legacy API，近期无影响，但**未来 SDK 升级时 calendar 模块要预留迁移工作量**。

---

## 4. 方案对比

| 方案 | 内容 | 契约影响 | 工作量 | 主要风险 |
| --- | --- | --- | --- | --- |
| A 维持现状 | 只有单向导入 | 无 | — | 日历事件不导入就看不见；系统侧改动不会反映到已导入项 |
| **B live 直读显示**（Toki 式） | 设置页多选日历（app_settings v12）→ 按视图窗口实时 `getEvents` → 与自有条目合并渲染，只读徽标 | 不违反冻结语义（不落库、不动 sourceType/sourceUid/签名）；ui.md 需新增条款（正常版本推进） | ≈1 个切片（读路径全现成） | 与已导入项同显重复；live 事件不参与提醒/搜索/小组件 |
| **C = B + 可选导入** | B 的超集：导入入口保留，定位为「想要提醒/搜索/小组件时把它转正」 | 同 B | 同 B | 无额外 |
| D1 写回·专属日历（推荐写回形态） | `createCalendarAsync` 建「Life」日历，我们的条目写入该日历；源数据仍在本库（镜像写） | **违反 §7.15/repository.md:142，必须变更提案** | 1–1.5 切片 | 回环防重、删除语义、Android 重复规则限制 |
| D2 写回·用户选定日历 | 写入用户日历（Google 等） | 同 D1 + 数据出设备（经系统 sync 上云） | 同 D1 | 与用户数据混杂、误删/误改风险、无法整体断开 |
| D3 写回·仅系统表单 | 只做 `createEventInCalendarAsync` 预填表单，用户在系统 UI 里自己存 | 免权限、几乎零契约风险（不调写 API？——**算**，它落库即写入系统日历，仍需提案，但程度最轻） | <0.5 切片 | Android 拿不到 event id，无法跟踪更新/删除 |

---

## 5. live 直读显示的关键设计点

1. **日历多选持久化**：`app_settings` 新增 `display_calendar_ids_json`（JSON 字符串数组，isOptional，空=功能关闭），schema v12 addColumns 迁移，照 v7/v10/v11 先例。选日历的设置页复用切片 9 的 `getCalendars()`，需扩返回 `color` 与 `source.name`（账户名，区分「Google-工作」「本地」）。
2. **数据流**：UI 层新增 live hook（如 `useSystemCalendarEvents`）：输入 = 选中日历 ids + 当前可见窗口；内部复用 `SystemCalendarReader.getEvents`（窗口外扩逻辑现成）；输出映射为视图行模型（日历色条 + 时间 + 标题 + 🔒/「只读」徽标）。在 plan.tsx 分组管道**入口前**与 `observeItemsWithTags` 结果合并，按日分组逻辑零改动（§7.21 分组要求天然满足）。
3. **刷新时机**：可见窗口变化（切视图/翻月，防抖）、AppState 回前台、useFocusEffect（切片 21 已有同款触发器）；不做后台轮询（对齐 7.16 不引轮询的取向）。
4. **与已导入项的重叠**：
   - 事实约束：重复系列所有实例共享 `event.id`（§3 关键发现）→ 纯 sourceUid 匹配会误伤系列
   - 建议规则：**live 事件隐藏 ⟺ 存在 sourceType='system-calendar' 的已导入项，sourceUid 相同且 startAt 相同**（单事件精确命中；系列只命中被导入的首实例，其余实例正常显示）；sourceUid 计算直接复用 `resolveSystemEventSourceUid`
   - 交互兜底：设置页对「已导入过事件的日历」提示「同时显示可能重复」，不做静默自动处理之外的花活
5. **功能边界（明确不做，写入契约）**：live 事件不参与——提醒调度（ReminderScheduler 只认本库 Reminder）、搜索（LIKE 只搜本库）、小组件快照（7.16 只序列化本库今日待办）、闪电录入卡片、ICS/数据导出（只导自有数据）。点击行为：只读详情弹层（对齐 Toki 的「只读」页），不提供编辑。
6. **性能**：Instances 查询原生轻量；按（日历集合，月窗口）做内存缓存，切回已看过的月直接命中。
7. **平台 gating**：web 下 expo-calendar 不可用，入口隐藏 + 读取路径早退（切片 9 入口在 profile.tsx，需同款处理）。

## 6. 写回（D1）的关键设计点（若立项）

1. **回环防重（核心）**：写进「Life」日历的事件，在 live 显示的日历选择列表与导入流程中**默认排除/标记**（日历 id 记入 app_settings）；写事件 notes 前缀「[Life]」作二次识别。这样 B/C 与 D 可共存不打架。
2. **镜像 id 存储**：不能复用 `items.source_uid`（其语义 = 导入来源，被 (sourceType, sourceUid) 去重冻结占用；写回条目 sourceType 仍是 'local'）→ 新列 `mirror_calendar_event_id`（schema v12 一并加）或独立映射表。
3. **更新语义**：Android 无 `recurringEventOptions` → 改重复项 = 整系列改；重复定义变化建议「删旧事件 + 写新事件」（简单可靠）。删除联动：MVP 建议**不删**（归档/删除条目不动系统事件），提供「断开连接」= `deleteCalendarAsync(Life 日历)` 一键清理全部镜像——这是专属日历方案的最大优势。
4. **重复规则映射**：daily/weekly/monthly 单频率 → Frequency + interval；**weekdays 多选日在 Android 表达不了** → 降级策略需用户决策（写单次 or 跳过并提示）。
5. **提醒映射**：system-notification 渠道提前 X 分钟 → `alarms: [{ relativeOffset: -X }]`（文档语义：负=提前）；其他渠道不映射。
6. **失败语义**：本地优先——写系统日历失败不阻断本地保存，toast + 详情页手动「同步到系统日历」重试入口。
7. **立项前置真机验证清单**：①createEventAsync 写入本地日历与 Google 日历各一次（确认可见性与同步延迟）；②重复事件写入后 getEventsAsync 实例展开符合预期；③allDay 事件跨日显示；④写入后立即 updateEventAsync/deleteEventAsync 全链路。

---

## 7. 契约与流程影响

| 动作 | 涉及 | 性质 |
| --- | --- | --- |
| live 直读显示立项 | 新契约条款（ui.md 视图节 + repository.md 新节「系统日历实时显示」）；AGENTS.md §7.x 新条；app_settings schema v12 | **不触碰 7.15 冻结语义**（不落库、不改 sourceType/sourceUid、不调用写 API），属正常契约演进 |
| 写回立项 | **必须变更提案**修改 §7.15「不写回、无写回调用路径」与 repository.md:142「不调用任何写入系统日历的 API」 | 先例：slice-11 可靠性提案、slice-16 渠道解禁提案（`docs/proposals/slice-16-reminder-channels.md`） |
| 两案共用的 schema v12 | `display_calendar_ids_json`（live）+ `mirror_calendar_event_id`（写回，若做） | addColumns，禁止重建表（§4 冻结） |

## 8. 建议路线

1. 切片 22（闪电卡片化 Phase 3/4）收尾不动摇。
2. 下一候选切片（可插队或排 23+）：**live 直读显示（方案 C）**，阶段式：阶段 1 设置页 + 日历多选持久化 + Reader 扩 color/source；阶段 2 四视图合并渲染 + 只读徽标 + 空态；阶段 3 与已导入项重叠处理 + 真机验收。
3. 写回（D1）独立提案独立切片，提案确认前不写任何一行写回代码（§7.5/§7.15 闸门）。

## 9. 待用户决策的开放问题

1. live 显示要做吗？四个视图全做还是先做日程（agenda）视图？
2. 已导入日历与 live 同显的重复策略：按 §5 规则自动去重 + 设置页提示，还是仅提示不去重？
3. 写回要吗？接受「Life 专用日历」形态吗？删除联动默认不做（条目删除不删系统事件），接受吗？
4. 若写回：weekdays 多选日重复项在 Android 无法按重复规则写入，降级为「写单次事件」还是「跳过并在 UI 提示」？

## 附：事实来源

- `node_modules/expo-calendar/build/Calendar.d.ts:648,682,694,714,721,729,735`（写 API 签名）
- `node_modules/expo-calendar/android/src/main/java/expo/modules/calendar/Constants.kt:53-73`（Instances 投影 EVENT_ID 首列）、`CalendarModule.kt:280-311,706-736`（id/instanceId 映射、纯包含式窗口）
- 官方文档：[Calendar API](https://docs.expo.dev/versions/latest/sdk/calendar/)、[迁移指南（新 class API）](https://docs.expo.dev/guides/sdk-libraries-migration/calendar/)
- 历史坑：[expo#15011 allowsModifications always false](https://github.com/expo/expo/issues/15011)
- 工程现状：`src/data/systemCalendarAdapters.ts`、`src/domain/systemCalendar/sourceUid.ts`、`src/data/ItemRepository.ts`、`src/app/(tabs)/plan.tsx`、`src/db/schema.ts`、`docs/contracts/repository.md`、`AGENTS.md` §7.15

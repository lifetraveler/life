# 切片 27 任务卡：系统日历 live 直读显示（方案 C）

- 立项日期：2026-11-17
- 基点：main @ `7e43fee`（切片 26 合并 + backlog 立项登记后）
- 分支：`task/slice-27`（从最新 main 新建，§7.8）
- 来源：调研报告 `docs/proposals/system-calendar-display-writeback-assessment.md`（§5 live 关键设计、§8 建议路线）+ backlog §2 切片 27 行
- **前置决策（调研报告 §9 四问，用户 2026-11-17 全部定案）**：
  - Q1 范围 → **四视图全做**（agenda/week/month/day）；
  - Q2 重叠策略 → **自动去重 + 筛选面板提示**；
  - Q3 写回 → **本片不做写回**（独立变更提案 + 独立切片，本片零写回代码）；
  - Q4 weekdays 降级（写回立项时生效的备查决策）→ **跳过并在 UI 提示**。
- 关联遗留：**L10（重复系列导入疑缺陷）按 backlog 约定并入本切片阶段 3 复核定性**。

## 0. 冻结区与明确不做清单

- 不碰 `src/notifications/`、`src/domain/recurrence/`（冻结区，无闸门需求）。
- **不做写回**：无 createEvent/updateEvent/deleteEvent 等任何系统日历写入调用路径
  （AGENTS §7.15 与 docs/contracts/repository.md:142「不调用任何写入系统日历的 API」
  冻结语义一字不动）；写回如立项走独立变更提案 + 独立切片。
- 不触碰「系统日历导入接口」签名与去重键语义（repository.md v0.9 节
  findItemBySource(sourceType, sourceUid) 冻结）；**L10 只真机复核 + 定性**——若确认
  缺陷且修复涉及去重键语义变更（如 event.id+startAt），另立变更提案，不在本切片顺手改。
- 不引入新依赖（expo-calendar / expo-crypto 均已有）；新增文件不得 `any`、不得 `as any`。
- **live 事件功能边界（写入契约）**：不落库、不参与提醒调度（ReminderScheduler 只认
  本库 Reminder）、不参与搜索（LIKE 只搜本库）、不参与筛选面板谓词、不进小组件快照
  （§7.16 只序列化本库）、不进闪电录入、不进 ICS/数据导出。
- 不修改 `groupItemsForAgenda` / `itemsByDay` / `layoutDayEvents` / `filterItems` 等既有
  函数签名（live 经合成视图条目走既有管道，见 D6）。
- 不做后台轮询（刷新时机见 D7，对齐 §7.16 不引轮询取向）。
- schema v2–v13 step 保持原样不得修改；v14 单条 addColumns，严禁重建表或清库（§4）。
- 不逐日历静态判「已导入」状态（sourceUid 不含 calendarId，无法从已存字段归属到日历）；
  筛选面板日历区以固定说明文案替代逐日历提示（见 D8）。
- 既有 quirk 不修：ai.tsx buildConfig 丢 timeoutMs 等（非本切片范围）。
- 报告原文的「schema v12」引用已过时（v12/v13 被切片 25/26 占用），本切片迁移顺延为
  **v14**（backlog §2 注记一致）。

## 1. 设计决策（D 编号）

- **D1 范围（Q1）**：四视图全做。四条数据路径（agenda 分组、周双态分组、月历分桶、
  日时间轴）在同一层合并 live 条目。
- **D2 重叠去重（Q2）**：live 事件隐藏 ⟺ 存在 sourceType='system-calendar' 的已导入
  项，sourceUid 相同且 startAt 相同。单事件精确命中；重复系列只命中被导入的首实例，
  其余实例正常显示（报告 §5.4 规则原文）。sourceUid 计算复用
  `resolveSystemEventSourceUid`（event.id 优先，缺省内容哈希前 16 位）。
- **D3 写回不做（Q3）**：本片零写回代码；weekdays 降级备查决策 = 跳过并在 UI 提示
  （Q4），随写回提案届时启用。
- **D4 schema v14**：app_settings 加 `display_calendar_ids_json`（string，isOptional；
  空/缺省 = 功能关闭），v13→v14 单条 addColumns（chips_increments/default_channels_json
  同款先例）；领域字段 `AppSettings.displayCalendarIds: string[]` 默认 `[]`；读层防御
  归一 parseDisplayCalendarIds（非 JSON/含非串/空串剔除，不抛错回退 []）、写路径校验
  validateDisplayCalendarIds（仅非空字符串、去重；validateDefaultChannels 同风格）。
- **D5 Reader 扩展**：`SystemCalendarInfo` 扩 `color: string | null` 与
  `sourceName: string | null`（账户名，区分「Google-工作」「本地」）；
  `expoSystemCalendarReader.getCalendars` 映射 expo-calendar 的 color/sourceName；
  属 SystemCalendarReader 端口的契约外显式扩展（observeItemsWithTags 先例），不改
  importSystemCalendarEvents 冻结签名。UI 容忍 null（色条回退主题 Token 次要色）。
- **D6 合并位置与合成条目**：live hook 输出经
  `src/domain/views/liveCalendar.ts` 纯函数（窗口过滤复用 filterEventsInRange、D2 去重、
  映射）转为**满足 ItemWithRelations 结构的合成视图条目**（id=`live:<sourceUid>:<startAt>`
  确定性键、title、startAt/endAt/allDay、sourceType='system-calendar'、sourceUid、
  sourceReadOnly=true、tags=[]、category=null、status='active'、priority=0 等其余字段取
  类型默认值），在**各视图「filterItems 之后、分组/布局之前」**并入——筛选谓词零改动、
  分组逻辑零改动（报告 §5.2）。渲染行带日历色条 + 🔒/「只读」徽标 + sourceName 副行；
  点击弹只读详情弹层（不提供编辑/跳详情页）。
- **D7 窗口与刷新**：month=锚点月；week=自然周/单日；day=锚点日；
  **agenda=今天 00:00 起 +30 天**（历史系统事件不回显——合成条目不进过去的分组）；
  刷新 = 窗口变化防抖 + AppState 回前台 + useFocusEffect（plan.tsx 已有同款触发器）；
  per (calendarIds, windowKey) 内存缓存，切回已看窗口直接命中（报告 §5.6）。
  30 天常量如真机体验不佳只调常量，不动契约。
- **D8 日历选择入口（2026-11-17 用户决策：取消独立设置页）**：不新建
  /settings/calendar-display、profile 不加 navRow；计划页筛选面板新增「日历显示」区，
  为日历选择唯一入口：按账户分组（组头 = sourceName 原样显示，null/空归「其他」组）、
  每行 = 色点（color，null 回退主题 Token）+ 日历名（title）+ 显隐开关；点选即时写
  display_calendar_ids_json，四视图即时生效；区底固定说明文案（功能语义 + 去重规则 +
  「已导入过的日历同时显示可能重复」提示）；权限拒绝态在区底提示 + 重新授权按钮；
  web 平台该区不渲染 + hook 早退（切片 9 入口 gating 先例）；MVP 不做分组折叠。

## 2. 阶段划分

- **阶段 1（域 + 数据层 + 契约文档）**：schema.ts SCHEMA_VERSION 13→14 +
  app_settings 加列；migrations.ts toVersion 14 单条 addColumns（v2–v13 不动）；
  AppSettingsModel @text('display_calendar_ids_json')；settings.ts
  AppSettings.displayCalendarIds +
  DEFAULT_APP_SETTINGS + parse/validate + serialize；WatermelonItemRepository 读层防御
  归一 + 写层三处（getSettings 补插 / updateSettings 建行 / update patch 直通，
  show_ai_usage 全链路先例）；D5 Reader/adapter 扩展；单测：migrationsV14、settings
  parse/validate、adapter 扩展映射（其余基线测试版本号例行更新）。**本阶段同时提交
  任务卡与 AGENTS.md（v0.31 §7.39 + §8 刷新）**；ui.md 新节「筛选面板日历显示区」、
  repository.md 新节「全局设置扩展（displayCalendarIds）与系统日历 live 直读」
  （不触碰 v0.9 冻结节）随阶段 1 提交。
- **阶段 2（live 管道 + UI）**：`src/domain/views/liveCalendar.ts` 纯函数 +
  单测（去重/窗口/合成映射/groupItemsForAgenda 消费字段覆盖）；
  `src/ui/useSystemCalendarEvents.ts` hook（权限 requestPermissions、设置读取、窗口
  防抖、缓存、web 早退、Probe 模式单测先例）；plan.tsx 四条数据路径合并 + 只读徽标 +
  色条 + 只读弹层；plan.tsx 筛选面板「日历显示」区（D8：分组/色点/开关/固定文案/
  权限态，独立组件文件便于单测）；不新建设置页路由。
- **阶段 3（复核 + 验收 + 收尾）**：L10 真机复核（重复系列导入是否只落首实例）
  定性记 closeout（不修，如需修复走变更提案）；真机验收矩阵全过；closeout +
  backlog 划项 + AGENTS §8 刷新 + §7.9 提交序列。

## 3. 真机验收矩阵（MuMu / dev client，非 release APK——切片 26 教训 8）

1. 默认未选日历 = 功能关闭：四视图无 live 行，与切片 26 前行为一致。
2. 选定日历后 agenda/week/month/day 各出现 live 行：日历色条 + 时间 + 标题 +
   🔒/「只读」徽标 + sourceName 副行。
3. 去重命中：已导入的单事件 live 不再重复显示；重复系列未被导入的实例正常显示。
4. 点击 live 行 → 只读详情弹层（无编辑入口、不跳 item/[id]）。
5. 月视图翻页回已看过的月：缓存命中、无重复读取（翻页即时渲染）。
6. 回前台 / 切回页签刷新：系统日历外部增删事件后回 App 可见变化。
7. 权限拒绝态：筛选面板日历区底提示 + 重新授权按钮；视图无 live 行、不崩溃。
8. 深浅色两态（adb shell cmd uimode night yes/no）live 行与弹层 Token 正常。
9. 重启保持：选中集合杀进程重开保持（PRAGMA user_version=14 + app_settings 值核对）；
   **v13→v14 迁移实测**（既有行 display_calendar_ids_json 缺省）。
10. 边界抽查：live 行不进搜索结果、不进小组件今日快照、不进导出 JSON。
11. L10 复核记录（重复系列导入行为定性，结论记 closeout §遗留）。
12. 筛选面板日历显示区：按账户分组正确（组头 sourceName、缺失归「其他」组）、
    色点取日历 color（null 回退默认色）、开关点选即时生效（勾选后四视图即时出现
    live 行、取消即时隐藏）、区底固定说明文案可见。
13. 外部 CalDAV 日历（MuMu 环境具备则验）：服务器侧新增/改名日历在面板正常列出，
    颜色取服务器同步色。

## 4. 验收命令

- `npx tsc --noEmit`（0 错）
- `npx jest --runInBand`（基线 81 套件 / 1145 用例，只增不减）
- `npx expo-doctor`（2 项预存基线失败无新增）
- Android 真机（MuMu 7555 + Metro 主树 8081）按 §3 矩阵执行

## 5. 风险与预案

- expo-calendar 的 color/sourceName 在部分日历上可能为空：UI 全链路容忍 null
  （色条回退 textMuted/次要 Token，sourceName 缺省不显示副行）——D5 已内置。
- 合成条目字段不全可能在分组函数抛错：阶段 2 单测覆盖 groupItemsForAgenda /
  itemsByDay / layoutDayEvents 对合成条目的消费字段（D6 明确字段清单）。
- agenda 30 天窗口参数需按真机体验调整：只调常量不动契约（D7）。
- Instances 原生纯包含式窗口丢弃跨范围事件：expandReaderWindow 外扩兜底已有
  （切片 9 先例），live hook 复用同一函数。
- jest 环境无 expo-calendar 原生模块：hook 测试经端口注入内存 reader
  （WatermelonItemRepository 第三参同款依赖注入先例）。

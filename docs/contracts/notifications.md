# 契约：通知与提醒调度

> 适用范围：ReminderScheduler 接口与语义、对账/补提醒、expo-notifications 约束、Hermes Intl polyfill、调试入口、通知点击跳转。
> 最后更新切片：切片 6（v0.6）
> 来源：原 AGENTS.md 4.3、4.16、4.19、4.20、4.21、4.22、4.26（2026-11 由 AGENTS.md §4 拆分迁移至此，正文逐字保留，仅标题层级调整，语义未变）
> 相关契约：recurrence.md（occurrence 展开唯一来源）、data-model.md（Reminder 模型）、ui.md（时区白名单与详情页对账触发）

## 4.3 ReminderScheduler 接口

当前切片不实现。后续所有提醒调度必须通过该接口，UI 不得直接调用 expo-notifications。
接口签名在切片 5 前冻结。

## 4.16 ReminderScheduler 接口契约（v0.5 冻结）
新增 `src/notifications/ReminderScheduler`，接口签名冻结：
- `scheduleForReminder(reminderId: string): Promise<void>`
  - 读取 Reminder + Item，若 Item 已完成/已归档或 Reminder.enabled=false，等价于 cancel；
  - 调用 `expandOccurrences({ scheduleId: reminderId, rule, startAt, tzid, count: 30 })`；
  - 过滤 `instant > now` 且 `instant <= now + 30 天` 的 occurrence；
  - 以 `occurrenceKey` 作为 notification identifier 调用 expo-notifications 的 `scheduleNotificationAsync`；
  - 已存在同 identifier 的通知不重复注册。
- `cancelForReminder(reminderId: string): Promise<void>`
  - 取消该 reminder 名下所有已调度通知；identifier 前缀为 `recurrence:v1|<encodeURIComponent(reminderId)>|`。
- `cancelAll(): Promise<void>`
  - 取消本 App 调度过的所有通知；不得取消非本 App 前缀的通知。
- `reconcile(): Promise<ReconcileResult>`
  - 幂等；可在启动、回前台、任意时刻多次调用；
  - 返回 `{ newlyScheduled: string[]; cancelled: string[]; missed: Occurrence[] }`；
  - 更新每个 Reminder 的 `lastReconciledAt`。

`ReconcileResult.missed` 为本次对账新发现的错过 occurrence；同一 occurrence 不得在后续对账中重复计入。

## 4.19 对账与补提醒语义（v0.5 冻结）
- 对账窗口：`[lastReconciledAt ?? startAt, now]`。
- 该窗口内的 occurrence 若满足：`instant <= now` 且 `occurrenceKey > lastFiredOccurrenceKey`（按 occurrence 生成顺序比较，不按字符串字典序；实现上以“窗口内按 instant 升序取 lastFiredOccurrenceKey 之后的项”为准），计入 `missed`。
- `missed` 去重依赖 `markReminderFired`：对账报告 missed 后必须把该 reminder 的 `lastFiredOccurrenceKey` 更新为窗口内最后一个 missed occurrenceKey；同一 occurrence 不会在下次对账重复进入 missed。
- 系统已调度通知的 diff 以 `occurrenceKey` 集合为准；不比对通知的触发时间字段。
- 本切片不实现“missed 聚合通知”的 UI 展示；是否弹通知由调用方决定。调试入口可在对账后立即调用 `expo-notifications.presentNotificationAsync` 发一条聚合提示，仅用于真机验收。

## 4.20 expo-notifications 使用约束（v0.5 冻结）
- 只有 `src/notifications/` 下的文件可以 import `expo-notifications`；UI、domain、data 层不得直接 import。
- 必须在 app 入口（`app.config.*` / `app.json`）配置 expo-notifications plugin；不得依赖运行期申请权限的隐式行为。
- Android 13+ 的 POST_NOTIFICATIONS 权限必须显式申请，拒绝后必须能降级为“无通知”而不是崩溃。
- notification identifier 必须是 `occurrenceKey`，不得另造 ID；这样对账可以纯靠 identifier 前缀和集合 diff 完成。
- 单条 reminder 最多调度 30 个通知；`listEnabledReminders` 规模 × 30 若超过 500，需在 reconcile 中对最远的一批跳过并记录 warning，不得静默截断。

## 4.21 Hermes Intl polyfill（v0.5 必须处理）
- 切片 4 遗留风险：`@date-fns/tz` 依赖完整 `Intl.DateTimeFormat` 的 `timeZone` 支持；Hermes 默认不保证。
- 切片 5 必须在 app 入口最早处引入 FormatJS polyfill，至少覆盖：`Intl.DateTimeFormat`（含 `timeZone`）、`Intl.Locale`、`Intl.getCanonicalLocales`，并加载 `Asia/Shanghai`、`America/New_York` 所需 locale data。
- 该 polyfill 不得影响 Jest 环境；Jest 已有显式 tzid 隔离，polyfill 只应在 RN 入口生效。
- 真机验收必须包含一条 DST 时区的规则（建议 `America/New_York`），验证 `expandOccurrences` 在 Hermes 下的结果与 Jest 一致。

## 4.22 调试入口约定（v0.5 新增）
- 允许在 `src/app/` 下新增一个仅 `__DEV__` 可见的调试页，用于：创建/删除 reminder、手动触发 `reconcile()`、查看 `getAllScheduledNotificationsAsync()` 结果、触发一次聚合补提醒通知。
- 调试页不是正式 UI，不得被正式导航入口引用；切片 6 正式 UI 完成后可保留在 dev 菜单。
- 调试页不得绕过 Repository 直接写库。

## 4.26 通知点击跳转契约（v0.6 冻结）
- 通知 data 必须含 occurrenceKey、reminderId、itemId（切片 5 已实现）。
- 点击通知（前台、后台、冷启动三种路径）必须导航到 Item 详情页。
- Item 不存在时显示“条目已删除”占位页，不崩溃。
- 通知点击不得自动标记 Item 完成，不得自动 acknowledge missed；missed 确认在后续切片。


## reconcile forceRebuild（v0.11，切片 11 落地）

- `reconcile(options?: { forceRebuild?: boolean }): Promise<ReconcileResult>`。
- `forceRebuild=true` 时，先 `cancelAllScheduledNotificationsAsync()`，
  再对全部 enabled reminder 重新 `scheduleForReminder`；
  `missed` 计算逻辑不变，仍基于 `lastFiredOccurrenceKey`。
- `forceRebuild=false` 或缺省时，行为与 v0.5 完全一致。
- 调用约定：App cold start 且距上次 reconcile > 60s 时传 true；
  前台恢复、数据变更、WIDGET_UPDATE 传 false。
- 500 条预算逻辑不变；forceRebuild 后若超出预算，最远的 reminder 仍跳过并记 warning。


## once occurrenceKey 与渠道抽象（v0.16，切片 16 阶段 2 落地）

> 依据：变更提案 docs/proposals/slice-16-reminder-channels.md（用户已确认）与 AGENTS.md §7.26。
> 本节为 §4.16–4.20 的增补，不改变上述条款对 expo 渠道（system-notification / alarm）的既有约束。

### occurrenceKey 的 once 规则

- once 提醒只有一个 occurrence；触发时刻 = `onceAt`（民用五元组，§7.26 模型扩展）在
  reminder.tzid 下的确定性换算，DST 语义与 recurrence.md（§4.12–4.13）完全一致：
  gap 无 occurrence（跳过不平移）、fold 取较早瞬间。
- occurrenceKey 格式：`once:<reminderId>:<onceAt 换算后的 epoch 毫秒>`。
  键内嵌的毫秒时间戳由 (onceAt, tzid) 经确定性换算得出，重复展开必然得到同一键，
  仍满足 §4.20「identifier 必须为 occurrenceKey、确定性」的要求。
- identifier 根前缀自此为双族：recurring 族 `recurrence:v1|…`（§4.16 原条款，语义不变）
  与 once 族 `once:…`。现网集合 diff（§4.19）、cancelForReminder、cancelAll、
  forceRebuild 清理范围均以双族并集为准；他 App 前缀照旧不得触碰。

### 渠道抽象（ReminderChannel）

- 接口：`schedule(reminder, occurrenceKey, fireAt)` / `cancel(reminderId, occurrenceKey?)`，
  位于 `src/notifications/channels/`；ReminderScheduler 按 reminder.channel 经渠道工厂
  分发。UI / domain / data 层仍不得触达 expo-notifications（§4.3 / §4.20 原样生效）。
- SystemNotificationChannel / AlarmChannel：expo-notifications 路径，受 §4.16–4.20
  全部既有约束（identifier = occurrenceKey、30 条/提醒、500 条全局预算）。alarm 为
  高优先级全屏通知模拟（Android 通知渠道 importance MAX），不引入原生 Schedule
  Exact Alarm 模块（§7.26 渠道实现约束 1）。
- WebhookChannel / AppriseChannel：网络渠道，不向 OS 注册任何通知；App 进程存活期间
  以内存定时器（setTimeout，溢出 2^31-1 ms 续链）到点直接 fetch（10s 超时，
  2xx 视为成功），配置经手写类型守卫校验（§7.24 同款纪律）。
- 网络渠道可靠性边界（§7.26 渠道实现约束 2，UI 阶段必须注明「仅 App 存活时保证推送」）：
  - 定时器随进程消亡；重启后由 reconcile 重建；
  - reconcile 发现 missed 的网络 occurrence（未被本进程确认投递）立即补发一次，
    并按 §4.19 推进 lastFiredOccurrenceKey 游标（每轮 reconcile 至多一次补发机会）；
  - 跨进程语义为 at-least-once：定时器已成功发送、但进程在对账推进游标前被杀，
    重启后会补发一次——已知并接受的边界；
  - 本进程内以内存 attempts 记录抑制双发（同一 occurrence 定时器与补发互斥）；
    attempts 随进程生命周期存在，不持久化。
- 网络渠道不占 §4.20 的 500 条通知预算（无 OS 注册上限）；missed 去重仅依赖
  lastFiredOccurrenceKey，不引入 AsyncStorage / WorkManager（§4.19 精神延续）。
- 渠道互不干扰：多渠道提醒各自独立调度（§7.26 渠道实现约束 3）；reminder 更换渠道时，
  调度器负责清理旧渠道残留（expo 通知或内存定时器）。
# 契约：UI（详情/编辑/白名单/视图）

> 适用范围：Reminder 时区白名单、详情页与编辑页、missed 展示推迟、今日/本周视图定义。
> 最后更新切片：切片 6（v0.6）
> 来源：原 AGENTS.md 4.25、4.27、4.28、4.29（2026-11 由 AGENTS.md §4 拆分迁移至此，正文逐字保留，仅标题层级调整，语义未变）
> 相关契约：data-model.md（Item 时间字段）、notifications.md（reconcile 触发与通知跳转）、repository.md（读写只经 Repository）

## 4.25 Reminder 时区白名单（v0.6 冻结）
- 允许的 tzid 仅：`Asia/Shanghai`、`America/New_York`。
- UI 时区选择器只展示这两个；Repository.createReminder / updateReminder 遇到白名单外 tzid 必须抛明确错误。
- DB 中已存在白名单外 tzid 的 reminder（如切片 5 调试数据）：详情页只读展示并标注“该时区暂不支持编辑”，不得自动改写 tzid，不得删除。
- 理由：Hermes polyfill 用 `add-golden-tz`，只含这两个时区数据；其他时区在真机未验证。
- 扩展白名单必须先换 `add-all-tz` 并真机验证，再改本节；AI 不得自行替换 polyfill 策略。

## 4.27 详情页与编辑页契约（v0.6）
- 详情页：`src/app/item/[id].tsx`；编辑页：`src/app/item/[id]/edit.tsx`（或等价的 modal 路由，以项目现有导航为准）。
- 详情页展示：title、type、content、tags、startAt/endAt（按设备当前 IANA 时区格式化）、allDay、reminders 列表（frequency、localTime、weekdays/dayOfMonth、tzid、enabled、lastReconciledAt）、status。
- 编辑页可改：title、content、type、startAt/endAt/allDay、tags。
- Reminder 的创建/编辑/删除在详情页内完成，不在编辑页；删除 reminder 必须同时 `cancelForReminder`。
- 保存涉及 reminder 或 Item 状态变更后必须调用 `reconcile()`；reconcile 失败不得阻断保存，错误写日志并在详情页 dev 信息区可见。

## 4.28 missed 正式展示推迟（v0.6 记录）
- 切片 6 不实现 missed 的正式 UI 展示；已知缺口：用户可能错过提醒而不知道。
- `getLastAutoReconcileResult()` 仍在 dev 调试页可见。
- 不得在切片 6 用 AsyncStorage 临时存 missed 来“先凑合”；missed 持久化与展示必须在后续切片以 schema 变更方式正式设计，避免数据一致性债务。

## 今日/本周视图（v0.7，切片 7 落地）

### 时区与范围
- 分组以设备当前 IANA 时区为准；reminder 的 tzid 不影响视图分组。
- 今日：设备时区当天 00:00–24:00。
- 本周：设备时区周一 00:00 至下周一 00:00。
- 范围边界必须由领域层纯函数计算并显式传入 startMs/endMs；UI 不得自行用 new Date(y,m,d) 构造边界。

### 分组
- 今日视图三个分组，顺序固定：过期 → 已安排 → 今日创建。
- 本周视图两个分组，顺序固定：过期 → 已安排（本周）。
- 过期：endAt 非 null 且 endAt < now，且 status='active'。
- 已安排：命中条件以 docs/contracts/repository.md「视图查询接口（v0.7）」为准：startAt ∈ [rangeStart, rangeEnd)；或 startAt < rangeStart 且 endAt 非 null 且 endAt > rangeStart。不在 ui.md 重复条件描述，避免两处歧义。
- 今日创建：startAt 为 null 且 createdAt 落在今日范围内；仅今日视图有此分组。
- allDay=true 的 Item 进入已安排分组，展示“全天”，排序按 startAt（当天 00:00）参与。
- 同一 Item 只进一个分组，优先级：过期 > 已安排 > 今日创建。

### 排序
- 过期：endAt 升序。
- 已安排：startAt 升序；相同时 createdAt 升序。
- 今日创建：createdAt 降序。

### 状态与交互
- 过期组：仅 status='active'。
- 已安排组：status='active' 与 'done'；done 项置灰并排在同组末尾。
- 今日创建组：仅 status='active'。
- 点击 Item 进入详情页。
- 快速完成/取消完成必须触发一次 reconcile()；失败不阻断 UI，记录日志。
- 归档/删除不在视图内提供，通过详情页操作。

### 空态
- 今日全空：显示“今天没有安排”+ 快速记录入口。
- 本周全空：显示“本周没有安排”。
- 单个分组为空时隐藏该分组标题，不展示空分组。

### 刷新
- 使用 WatermelonDB 响应式查询，Item/Reminder 变更后自动刷新。
- 不轮询、不提供下拉刷新（可后置）。

## 修复记录（v0.8，切片 8 前置）

以下两节替换 v0.7 对应条目，实现不变（切片 7 已按 repository.md 实现）：

### 已安排（替换 v0.7 原条件）
- 命中条件以 docs/contracts/repository.md「视图查询接口（v0.7）」为准：
  `startAt ∈ [rangeStart, rangeEnd)`；或 `startAt < rangeStart 且 endAt 非 null 且 endAt > rangeStart`。
- 不在 ui.md 重复条件描述，避免两处歧义。

### 分组内 status（替换 v0.7 原描述）
- 过期组：仅 status='active'。
- 已安排组：status='active' 与 'done'；done 项置灰并排在同组末尾。
- 今日创建组：仅 status='active'。

## Android 桌面小组件（v0.10，切片 10 落地）

### 数据快照 schema（SharedPreferences `widget_today_snapshot_v1`）

```json
{
  "generatedAt": 1799999999999,
  "tzid": "UTC",
  "groups": {
    "overdue": [{ "id": "...", "title": "...", "type": "task", "timeLabel": "已过期" }],
    "scheduled": [{ "id": "...", "title": "...", "type": "event", "timeLabel": "14:00" }]
  }
}
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

## 4.29 今日/本周定义（v0.6 预冻结，切片 7 实现）
- 以设备当前 IANA 时区为准；reminder 的 tzid 不影响视图分组。
- 今日：设备时区当天 00:00–24:00；本周：设备时区周一 00:00 至下周一 00:00。
- 无 startAt 的 Item 不进入今日/本周；是否用 createdAt 进入“今日创建”分组在切片 7 决定。
- “以设备时区为准”在切片 7 前不改；其余细节可在切片 7 任务卡中微调。

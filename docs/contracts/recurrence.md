# 契约：重复规则（recurrence）

> 适用范围：src/domain/recurrence/ 的模块定位、计算模型、DST 处理、occurrenceKey、测试时区约定。
> 最后更新切片：切片 4（v0.4）
> 来源：原 AGENTS.md 4.11–4.15（2026-11 由 AGENTS.md §4 拆分迁移至此，正文逐字保留，仅标题层级调整，语义未变）
> 相关契约：notifications.md（ReminderScheduler 为唯一调度消费方）、data-model.md（Reminder 规则字段一一映射）

## 4.11 重复规则模块的定位（v0.4）
- 切片 4 新增 `src/domain/recurrence/`，为纯 TypeScript 模块，不得 import React、React Native、WatermelonDB、expo-notifications、UI 组件或任何数据库代码。
- 该模块是后续 `ReminderScheduler`（切片 5）的唯一重复规则来源；UI 和通知层不得自行实现重复计算。
- 不得引入 `rrule` 或任何依赖 floating-time 语义的日历库。rrule 的日期应被视为“floating times wearing UTC clothing”，其 DST 行为不可靠且上游长期未修复。

## 4.12 重复规则的计算模型（v0.4）
重复提醒的本质是“民用时间规则”，不是“固定间隔的 UTC 瞬间”。必须同时存储：
- `localTime`：用户本地民用时间（小时、分钟）；
- `tzid`：IANA 时区标识（如 `Asia/Shanghai`、`America/New_York`）。

规则类型（MVP 冻结，不得扩展）：
- `daily`：每天 `localTime`；
- `weekly`：每周指定星期几（1–7）的 `localTime`；
- `monthly`：每月指定“日”（1–31）的 `localTime`；该“日”超过当月天数时，**固定回退到当月最后一天**，不采用 RFC 5545 `SKIP=BACKWARD` 的“回退到最近有效日”语义。

时间范围：
- 以 `startAt`（绝对时刻，毫秒）作为规则生效起点；`startAt` 本身不一定是 occurrence。
- 输出未来 N 个 occurrence，默认 N=30；不得一次性展开全年或无限展开。
- 该模块不感知“错过补提醒”；补提醒由切片 5 的调度器基于实际触发记录判断。

## 4.13 DST 处理契约（v0.4）
- 模块内部不得使用 `new Date(y, m, d, h, min)` 这类依赖系统本地时区的构造方式；所有“民用时间 → 绝对时刻”的解析必须显式传入 IANA `tzid`。
- 春季时钟前拨导致的 **不存在本地时间**（gap）：该 occurrence 跳过，不向前后平移。
- 秋季时钟后拨导致的 **重复本地时间**（fold）：取较早的瞬间（第一次出现），不生成两个 occurrence。
- 时区规则以运行时 IANA 数据库为准；不得硬编码任何时区的 DST 起止日期。

## 4.14 Occurrence key 契约（v0.4）
- 每个 occurrence 必须携带 `occurrenceKey: string`，由确定性字段拼接生成，至少包含：`scheduleId`、`localDate`（YYYY-MM-DD）、`localTime`（HH:mm）、`tzid`。
- `occurrenceKey` 在规则编辑、DST 变化、重新展开后，对同一“民用时间 occurrence”必须保持不变。
- 禁止用 UTC 时间戳单独作为 occurrence 的唯一标识；UTC 时间戳会随 DST 规则或时区数据更新而变化。

## 4.15 测试时区约定（v0.4）
- 该模块的单元测试必须在显式指定 IANA 时区的上下文中运行，不得依赖开发机或 CI 的默认系统时区。
- Jest 运行该模块测试时，建议通过 `process.env.TZ` 或测试内显式 `tzid` 参数隔离时区影响；涉及 DST 的用例必须使用真实 IANA 时区标识（如 `America/New_York`），不得用固定偏移冒充时区。
- 测试文件不得修改全局时区后不恢复；如确需修改，必须在 `afterEach` / `afterAll` 中还原。

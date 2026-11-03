# 切片 4：纯逻辑重复规则计算模块

## 目标
在 `src/domain/recurrence/` 中实现纯 TypeScript 的重复规则展开模块：给定规则、`startAt`、`tzid` 和数量 N，输出未来 N 个 occurrence。
本切片不碰通知、不碰 UI、不碰数据库、不做 schema 变更、不新增 WatermelonDB migration。

## 允许修改/新增的范围
- `src/domain/recurrence/`：规则类型、展开函数、民用时间解析、occurrence key 生成、纯函数工具
- `src/domain/recurrence/__tests__/`：单元测试
- `package.json`：允许新增一个 IANA 时区处理依赖（如 `date-fns-tz` 或 `@date-fns/tz`），必须说明理由
- `jest.config.*` 或测试 setup 文件：如需要，设置测试时区隔离

## 禁止修改/实现
- 不引入 `rrule`
- 不 import React、React Native、WatermelonDB、expo-notifications、UI 组件
- 不修改任何 WatermelonDB schema / model / migration
- 不实现 `ReminderScheduler`
- 不实现“错过补提醒”
- 不展开超过 N=30 个 occurrence（测试中可显式传更小 N，但默认不得无限展开）
- 不硬编码任何时区的 DST 起止日期
- 不把 occurrence 的 UTC 时间戳作为唯一 key
- 不修改 AGENTS.md 中 v0.2/v0.3 的既有契约

## 实现要求

### 1. 规则类型（冻结）
```
type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly';

type RecurrenceRule =
  | { frequency: 'daily'; localTime: { hour: number; minute: number } }
  | { frequency: 'weekly'; weekdays: number[]; localTime: { hour: number; minute: number } } // 1=Mon … 7=Sun
  | { frequency: 'monthly'; dayOfMonth: number; localTime: { hour: number; minute: number } }; // 1–31
```

### 2. 核心函数签名（冻结）
```
function expandOccurrences(input: {
  scheduleId: string;
  rule: RecurrenceRule;
  startAt: number;   // 绝对毫秒时间戳，规则生效起点
  tzid: string;      // IANA 时区，如 'Asia/Shanghai'
  count?: number;    // 默认 30，上限 30
}): Occurrence[];

type Occurrence = {
  occurrenceKey: string;   // 确定性生成，见契约 4.14
  localDate: string;       // 'YYYY-MM-DD'
  localTime: string;       // 'HH:mm'
  tzid: string;
  instant: number;         // 对应的绝对毫秒时间戳
};
```

### 3. 短月回退
- `monthly` 的 `dayOfMonth` 超过当月天数时，取当月最后一天。
- 不得跨月回退；不得产生“2 月 31 日回退到 3 月 3 日”这类结果。

### 4. DST 行为
- 春季 gap：该 occurrence 跳过。
- 秋季 fold：取较早的瞬间。
- 必须通过真实 IANA 时区测试验证，不得用固定偏移模拟。

### 5. occurrenceKey
- 由 `scheduleId`、`localDate`、`localTime`、`tzid` 确定性拼接生成；同一民用时间 occurrence 在重新展开后 key 不变。
- 实现一个纯函数 `buildOccurrenceKey(...)`，并单独测试其稳定性。

### 6. 边界
- `count` 默认 30，上限 30；传入负数或非整数时抛出明确错误。
- `weekdays` 为空数组时返回空数组，不抛异常。
- `dayOfMonth` 不在 1–31 范围内时抛出明确错误。
- `startAt` 对应的本地日期之前不产生 occurrence；`startAt` 当天如果 `localTime` 已过，从下一个周期开始。

## 验收标准（逐条执行并报告）

1. `npx tsc --noEmit` 零错误。
2. `npx jest --runInBand` 通过，且以下测试存在并通过：
   - **daily**：在 `Asia/Shanghai` 下，从给定 `startAt` 展开 3 天，`localTime` 正确，`instant` 递增。
   - **weekly**：在 `America/New_York` 下，指定周一/周三/周五，展开结果星期正确。
   - **monthly 短月**：`dayOfMonth=31`，覆盖 2 月（闰年与非闰年）、4 月、6 月，结果均为当月最后一天。
   - **DST 春季 gap**：`America/New_York`，`localTime=02:30`，规则落在 3 月第二个周日，该 occurrence 被跳过，前后 occurrence 正常。
   - **DST 秋季 fold**：`America/New_York`，`localTime=01:30`，规则落在 11 月第一个周日，只产生一个 occurrence，且 `instant` 为较早瞬间。
   - **occurrenceKey 稳定性**：同一输入展开两次，key 集合完全一致；修改 `count` 不改变已产生 occurrence 的 key。
   - **边界**：`count=0` 返回空；`count=31` 被拒绝或截断到 30（二选一，在代码注释中说明）；`weekdays=[]` 返回空；`dayOfMonth=0` 抛错。
3. `npx expo-doctor` 无阻塞性错误（本切片未改构建配置，此项应无变化）。
4. 代码检查：`src/domain/recurrence/` 下无 `any` / `as any`；无 React / React Native / WatermelonDB / expo-notifications import；无 `rrule` 依赖。
5. 检查 `git diff`：未修改 `src/db/`、`src/data/`、`src/app/`、`src/ui/`；未新增 migration。

## 完成后输出
- 修改/新增文件列表
- 新增的 IANA 时区依赖名称及选择理由
- 执行的命令及结果
- 每条验收标准对应的测试名称与结果
- occurrenceKey 的构造格式示例
- 未完成项与风险
- 是否触碰受保护契约（应为“否”；若为“是”，附变更提案）

> 契约位置已迁移（2026-11）：AGENTS.md §4 拆分至 docs/contracts/，本文件引用的 4.14→docs/contracts/recurrence.md；完整映射见 AGENTS.md §4 索引；本文件为历史记录，正文未改。

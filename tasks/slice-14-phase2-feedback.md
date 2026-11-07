# 切片 14 · 阶段 2 反馈总结（纯逻辑与基础 UI 组件）

- 日期：2026-11-07
- 阶段：Phase 2 / 6（纯逻辑与基础 UI 组件）
- 分支：`task/slice-14`
- 阶段提交：`fbc17a8 feat(s14): 阶段2 纯逻辑与基础UI组件`（17 文件，+1007/-18）
- 状态：✅ 完成（tsc 0 error，jest 35 套件 / 432 用例全过），已暂停等待阶段 3 确认

## 一、成果定性：达标，可进入阶段 3

| 维度 | 结果 |
| --- | --- |
| 类型安全 | `npx tsc --noEmit` 0 error |
| 测试 | `npx jest --runInBand` 35 套件 / 432 用例全过（较阶段 1 +4 套件 / +50 用例，恰为本次新增） |
| 提交 | `fbc17a8`，17 文件 +1007/-18，未触碰 recurrence/、notifications/、schema/migrations |
| 依赖 | 零新增（渲染测试走纯函数抽离路线，方案 A） |

## 二、交付清单

**纯逻辑（4 个新模块 + 1 个扩展）**
- `src/domain/views/agenda.ts`：`groupItemsForAgenda(items, { viewKind, nowMs, tzid })` — 按显式 tzid 的民用日期分天组（复用 `recurrence/civilTime.ts` 只读导出，未改该目录）；标签 今天/明天/`周X D`/跨年 `YYYY年M月D日`；待办组（无 startAt）置顶、组内 createdAt 降序；today 视图未安排项并入「今天」组且排在有 startAt 项之后；组内 startAt 升序（并列 createdAt 升序再按 id 确定化）；archived 防御性排除；按 id 去重。
- `src/domain/views/filters.ts`：`filterItems(items, filters)` — 维度内 OR、维度间 AND，空数组维度不过滤；`EMPTY_ITEM_FILTERS` 常量兜底。`ItemFilters` 仅含 categoryIds/sourceTypes/tagIds，「状态」维度留待阶段 4 接面板时扩展。
- `src/domain/tags/tagDisplay.ts`：`formatTagDisplay(tag, mode)` — text/emoji/both 三模式；emoji 为 null 或空串时 emoji、both 均回退 tag.name（任务卡兜底要求，含专项断言）。
- `src/ui/color.ts`：`parseHexColor` / `relativeLuminance` / `contrastTextColor` — WCAG sRGB 线性化亮度，对黑/白算对比度取高者（无魔法阈值）；解析失败返回 null 由调用方回退默认样式。5 个预置分类色全部验证为黑字。
- `src/ui/timeFormat.ts`：追加 `formatAgendaTimeRange({startAt,endAt,allDay}, tzid)` → `'HH:mm - HH:mm' | '全天' | 'HH:mm' | null`（跨民用日自动带完整日期）。

**基础 UI 组件（1 新增 + 2 重构/新增）**
- `src/ui/CategoryChip.tsx`（新）：背景取 category.color，文字按对比度自动黑/白，emoji + 名称，可点击。
- `src/ui/TagChip.tsx`（重构）：API 改为 `{ tag?, label?, mode = 'text', onRemove?, onPress? }`；传 tag 时文案走 formatTagDisplay、背景取 tag.color（null/非法色回退既有中性样式 `#eef2ff/#3730a3`，视觉零漂移）；保留 `label` 纯文字路径（快速添加页的未保存标签草稿无 Tag 对象，走此路径）。
- `src/ui/AgendaItemCard.tsx`（新，静态骨架）：4px 左色条（缺失/非法回退 `#9E9E9E`）→ emoji → 右侧标题+时间段列；无边框、圆角 8、极简（对齐 Toki 图3）；时间段文字取分类色（无有效色回退灰）。

**调用点迁移（机械，4 页 5 处）**：`src/app/index.tsx:307,351`、`src/app/archived.tsx:70`、`src/app/item/[id].tsx:253`、`src/app/item/[id]/edit.tsx:238` 的 `label={tag.name}` → `tag={tag}`；`index.tsx:414` 待办草稿（纯字符串）保留 label 路径。默认 mode='text'，全部调用点视觉零变化，阶段 3/4 再接 `getSettings().tagDisplayMode`。

## 三、经确认的 3 个设计决策

1. **签名**：`groupItemsForAgenda(items, { viewKind, nowMs, tzid })` — 分天与「今天/明天」标签必须显式知道 now 与时区（§4.13 精神），不依赖系统本地时区。
2. **待办组置顶**：Agenda 视图无日期项进「待办」组且排最前（日期组纯时间序）；today 视图按任务卡并入「今天」组。
3. **渲染测试方案 A**：不引入 react-test-renderer，可测逻辑全部抽纯函数（formatTagDisplay / 对比色 / 时间段文案 / 分组 / 筛选），组件保持薄壳。

## 四、过程问题与教训

1. **`GroupItemsForAgendaInput` 冗余字段（子代理 review 发现，已修）**：初版把 `items` 同时放在第一参与 input 对象，函数只消费第一参——调用方只填 input.items 会静默得到空结果。提交前已从 input 接口删除（测试 helper 同步简化）。教训：双通道传同一数据是阶段 4 接线的静默陷阱，API 定型前应自查「同一数据只有一个入口」。
2. **提交漏文件（自查抓出，已 amend）**：首次 `git add` 漏了 `src/ui/timeFormat.ts`（测试进了、实现没进，提交树不可编译）。amend 后完整。教训：按「实现+测试成对」检查暂存清单，而不是按记忆罗列。
3. 单测整包子代理交付质量好（含 tz 分歧、allDay 排序、去重、空串 emoji 回退等边角），一次通过无规格偏差；Captain review 聚焦 API 形状与边角断言即可。

## 五、遗留披露与给阶段 3 的建议

1. `TagChip.mode` 默认 `'text'`：设置页接线（读 `getSettings()`/响应式更新）是阶段 3 工作，当前全部调用点仍是纯文字样式——这是刻意分阶段，不是遗漏。
2. 组件渲染断言（真实 render 快照）受限于无 react-test-renderer 未做；若阶段 4 需要视觉回归测试，届时再议依赖引入。
3. `contrastTextColor` 在对比度恰好相等（理论中性灰 L≈0.1791）时取白，规格未定义该边界，测试未过度约束；实际调色盘不会命中。
4. `formatAgendaTimeRange` 对 allDay 跨天事件统一显示「全天」（不显示跨度）；如阶段 4 视觉上需要「全天 × N 天」再扩展。
5. 本阶段无 schema 变更，`npx expo-doctor` 与真机验收按任务卡节奏留到切片收尾统一执行。

## 附：阶段 2 修改文件清单

- **新增实现**：`src/domain/views/agenda.ts`、`src/domain/views/filters.ts`、`src/domain/tags/tagDisplay.ts`、`src/ui/color.ts`、`src/ui/CategoryChip.tsx`、`src/ui/AgendaItemCard.tsx`
- **修改实现**：`src/ui/TagChip.tsx`（API 重构）、`src/ui/timeFormat.ts`（追加 formatAgendaTimeRange）、`src/app/index.tsx`、`src/app/archived.tsx`、`src/app/item/[id].tsx`、`src/app/item/[id]/edit.tsx`（调用点迁移）
- **新增/扩展测试**：`src/domain/views/__tests__/agenda.test.ts`（18 例）、`src/domain/views/__tests__/filters.test.ts`（11 例）、`src/domain/tags/__tests__/tagDisplay.test.ts`（7 例）、`src/ui/__tests__/color.test.ts`（8 例）、`src/ui/__tests__/timeFormat.test.ts`（追加 6 例）

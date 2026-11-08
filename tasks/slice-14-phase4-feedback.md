# 切片 14 · 阶段 4 反馈总结（核心页面重构：Agenda 与筛选）

- 日期：2026-11-08
- 阶段：Phase 4 / 6（核心页面重构：Agenda 与筛选）
- 分支：`task/slice-14`
- 阶段提交：`3a51292 feat(s14): 阶段4 核心页面重构Agenda与筛选`（9 文件，+1136/-314）
- 状态：✅ 完成（tsc 0 error，jest 36 套件 / 456 用例全过；MuMu 模拟器验收 8/9/10/11 全过；无验收修复提交）

## 一、成果定性：达标，一次验收通过

| 维度 | 结果 |
| --- | --- |
| 类型安全 | `npx tsc --noEmit` 0 error（首轮 4 个 chip 样式数组字面量推断错误，显式标注 `ViewStyle[]` 后清零） |
| 测试 | `npx jest --runInBand` 36 套件 / 456 用例全过（较阶段 3 +12 用例：filters 状态维度 + `hasActiveFilters`、`getMonthRange` 含 NY DST 边界） |
| 依赖 | 零新增（FilterSheet 为原生 Modal+Animated 手写，未引入 BottomSheet 库） |
| 契约 | 未触碰 recurrence/、notifications/、schema/migrations；UI 只消费 `ItemWithRelations`（§7.23） |
| 真机 | MuMu 模拟器（dev client + Metro 热载）验收 8/9/10/11 通过（用户确认）；另交付手机 release APK 独立验证 |

## 二、交付清单

**新增（1 文件）**
- `src/ui/FilterSheet.tsx`：零依赖底部滑出筛选面板（Modal transparent + Animated parallel 220ms，translateY+backdrop opacity，反向动画结束后才 `onClose` 卸载）；草稿模型（应用=提交筛选并收起、重置不关面板、✕/遮罩丢弃草稿）；四区块多选：分类（CategoryChip）/ 标签（TagChip + useTagDisplayMode）/ 日历源（本地/ICS 导入/系统日历）/ 状态（未完成/已完成）；面板打开时经 `getCategories()` 现取最新分类视觉。

**修改（8 文件）**
- `src/app/index.tsx`：整体重写。顶栏=左分段视图切换（日程/今日/本周/本月，选中黑底白字胶囊）+ 右筛选图标（纯 View 两行滑杆，`hasActiveFilters` 时 6px 红点）；数据链=`observeItemsWithTags` 单订阅 → 视图范围谓词（agenda=全量；today/week/month 用 ranges 纯函数，`startAt=null` 恒通过进「待办」组）→ `filterItems` → `groupItemsForAgenda` → FlatList 摊平渲染（header|item 行模型；今天组黑底白字胶囊高亮；组内卡 8px、组间 24px）；卡片=左侧 4px 分类色条+Emoji+标题+时间段（`formatAgendaTimeRange`），点击 `router.push(/item/<id>)`；本月组序倒序；搜索结果跨视图按日程分组且筛选持续生效；创建表单默认折叠为「＋ 新建记录」一行入口（quick-add 深链命中自动展开+聚焦，切片 12 契约保留）；保留切片 3 搜索防抖 300ms+竞态序号、返回键草稿判定。
- `src/app/item/[id].tsx`：详情页新增「归档」按钮（Alert 确认 → `archiveItem`，已归档态隐藏；语义与旧主页一致，不级联取消提醒）。用户决策：主页行内归档入口移到详情页，主页卡片保持干净。
- `src/ui/CategoryChip.tsx` / `src/ui/TagChip.tsx`：加三态 `selected?: boolean`（true=2px 黑描边；false=同宽透明描边+opacity 0.45 防布局跳动；undefined=既有展示视觉零漂移）。
- `src/domain/views/filters.ts`：`ItemFilters` 加第 4 维度 `statuses: ItemStatus[]`；新增 `hasActiveFilters()`（四维度任一非空）。
- `src/domain/views/ranges.ts`：新增 `getMonthRange(nowMs, tzid)`（自然月 `[start,end)`；NY 3 月 DST 边界=31 天−1h，测试交叉校验）。
- `src/domain/views/__tests__/filters.test.ts` / `ranges.test.ts`：对应新用例。

## 三、真机验收对照（任务卡 §阶段 4 验收）

| # | 标准 | 结果 |
| --- | --- | --- |
| 8 | 主页按日期分组、今天胶囊高亮 | ✅ |
| 9 | 工作分类卡片左侧色条+💼 | ✅ |
| 10 | 筛选面板按分类/标签多选过滤（含日历源/状态） | ✅ |
| 11 | 本月视图正常（按日期倒序承载本月范围） | ✅ |

## 四、功能收敛披露与已知限制

1. 主页行内「转为任务/添加标签」入口移除——`item/[id]/edit.tsx` 有同等能力（改类型、增删标签）。
2. 「归档」入口移至详情页（用户决策）；「已归档」页取消归档能力不变。
3. 今日/本周/本月 tab 不含过期项（已确认决策 B）：过期项在日程视图按原日期显示；旧 `/today` `/week` 页面原样保留，入口链接已从主页移除。
4. 日程视图全量升序、无「跳到今天」锚点（已确认决策 C，记为已知限制）。
5. 视图时间坐标沿用 today.tsx 模式：挂载时固化 `tzid`+`nowMs`，App 挂后台跨天后返回主页不会自动刷新日期分组（后续切片处理）。
6. 交付物：`life-s14-phase4-release.apk`（105MB universal，debug 签名，内嵌 JS 经字节级校验含阶段 4 代码标识）已交用户手机安装验证。

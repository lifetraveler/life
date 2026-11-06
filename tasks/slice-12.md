# 切片 12：搜索增强 + 已归档视图 + 数据导出 + 快速记录优化

## 相关契约
- docs/contracts/repository.md §搜索与归档增强接口（v0.12，本切片落地）
- docs/contracts/ui.md §已归档视图（v0.12）、§快速记录增强（v0.12）
- docs/contracts/ui.md §时区来源修正（v0.11）——搜索日期匹配使用修正后的设备时区
- docs/contracts/notifications.md §reconcile forceRebuild（v0.11）——导出不触发 reconcile
- slice-11-closeout.md（时区修正后的 getDeviceTzid 行为、冻结区清单）

## 目标
1. 搜索增强：在 title/content/tag 基础上，匹配 Item 的格式化日期（startAt/endAt）。
2. 已归档视图：独立的归档列表页，支持取消归档。
3. 数据导出：将本地数据导出为 JSON 文件，复用 expo-sharing 分享。
4. 快速记录优化：保存后留在输入框，支持连续创建。

## 允许修改/新增的范围
- src/data/：searchItems 实现扩展匹配范围；listArchivedItemsWithTags 新增
- src/domain/：搜索关键词预处理（如有日期格式化需求）；导出数据序列化纯函数
- src/app/archived.tsx：新增归档列表页
- src/app/index.tsx / settings.tsx：增加“已归档”入口（与“今日”并列）和“导出数据”入口
- src/app/quick-add.tsx / 主页快速输入组件：保存后行为调整
- src/ui/：归档列表项组件、导出结果提示
- 测试：searchItems 日期匹配、listArchivedItemsWithTags、导出序列化、快速记录行为

## 禁止修改/实现
- 不修改 src/domain/recurrence/ 任何文件
- 不修改 src/notifications/ 任何文件（切片 11 刚落地的 forceRebuild 不动）
- 不修改 src/polyfill.ts
- 不修改 src/db/ schema 或 migration（仍 v5）
- 不引入 FTS5、不引入新搜索库、不改变 LIKE 匹配语义
- 不新增原生依赖（package.json 的 native 依赖不变；expo-file-system / expo-sharing 已存在）
- 不修改 quick-add 的 deep link 约定
- 不实现“导出为 ICS”（切片 8 已做；本切片导出 JSON 是不同用途）
- 不实现批量取消归档
- 不实现搜索历史、搜索高亮

## 实现要求

### 1. 搜索增强
- `searchItems` 在现有 title/content/tag 匹配基础上，新增对 `startAt` / `endAt` 的日期字符串匹配：
  - 将 startAt/endAt 格式化为 `YYYY-MM-DD`（设备时区，用切片 11 的 getDeviceTzid）。
  - 关键词匹配规则：若关键词能解析为日期片段（如“2026-11”“11-05”“2026”），
    对格式化日期做子串匹配；否则跳过日期匹配，保持原行为。
  - 不改变 LIKE 转义；不新增查询参数。
- 实现中注意：WatermelonDB 不能在单条查询里跨表 OR，日期匹配在 Item 表上直接完成，
  标签匹配仍分步（切片 3 契约不变）。

### 2. 已归档视图
- Repository 新增 `listArchivedItemsWithTags`（契约 v0.12），保留 v0.3 的 listArchivedItems 不删。
- 页面 `src/app/archived.tsx`：列表 + 取消归档按钮 + 空态。
- 取消归档成功后从列表移除；失败时提示错误，不静默。
- 入口：主页“已有记录”行右侧增加“已归档”链接，与“今日”并列；或设置页。
  实现中固定一种，不两处都放。

### 3. 数据导出
- 入口：设置页“导出数据”→ 序列化 → 写文件 → expo-sharing 分享。
- 导出内容：所有 Item（含 tags、reminders 摘要、status、sourceType），不含内部迁移字段。
- 序列化纯函数 `serializeExportData(items: ItemWithTags[], reminders: Reminder[]): string`，
  输出 JSON，可单测。
- 文件命名：`life-export-YYYYMMDD-HHmmss.json`；写入 `FileSystem.cacheDirectory`（或切片 8 的等价路径）。
- 导出不触发 reconcile；不修改任何数据。
- 导出成功/失败用页面内提示，不用 Alert（与切片 11 快速完成提示风格一致）。

### 4. 快速记录优化
- 当前 quick-add 行为：导航到主页并聚焦标题输入。保持。
- 保存后：不自动 dismiss 键盘、不清空输入框外的焦点；清空输入框内容，允许连续输入。
- 返回键行为：
  - 输入框为空：关闭键盘，取消聚焦。
  - 输入框有内容：仅关闭键盘，内容保留；再次聚焦可继续编辑。
- 不修改 quick-add 的路由行为（仍 replace 到主页）。
- 若主页快速输入组件与 quick-add 是两个入口，两处行为保持一致。

## 验收标准

### 静态与单测
1. `npx tsc --noEmit` 零错误。
2. `npx jest --runInBand` 全部通过，至少包含：
   - searchItems 日期匹配：关键词“2026-11”命中 startAt 在该月的 Item；关键词“11-05”
     命中当天 Item；非日期关键词不改变原搜索结果。
   - 日期格式化在 Asia/Shanghai 下的预期值（不依赖 process.env.TZ）。
   - listArchivedItemsWithTags：仅返回 archived，按 updatedAt 降序，含 tags。
   - serializeExportData：空列表、含 tags/reminders 的 Item、JSON 可反解析。
   - 快速记录保存后行为：输入框清空、焦点保留（用组件测试或纯函数模拟）。
3. `npx expo-doctor` 与切片 11 基线对比：不得新增阻塞项。
4. 代码检查：
   - `git diff -- src/domain/recurrence src/notifications src/polyfill.ts src/db` 为空；
   - 无 FTS5 引入；无新原生依赖；无 `any`。

### 真机（development build，Android）
5. 覆盖安装，数据不丢；schema 仍 v5。
6. 搜索日期：在搜索框输入“2026-11”，命中 startAt 在该月的 Item；输入“11-05”，
   命中当天 Item；输入“周会”，原 title/content/tag 匹配不变。
7. 已归档视图：归档一条 Item 后，入口可进入归档列表；取消归档后，该 Item 从归档列表消失、
   回到默认列表；重启后状态一致。
8. 数据导出：设置页导出，系统分享面板出现；导出的 JSON 可被 JSON 解析器打开，
   Item 数量与库内一致；不含内部迁移字段。
9. 导出不触发 reconcile：导出前后 `getAllScheduledNotificationsAsync` 数量不变。
10. 快速记录：quick-add 进入后聚焦；保存一条后输入框清空、键盘不收起，可连续保存第二条；
    空输入按返回关闭键盘；有内容按返回仅关闭键盘、内容保留。
11. 时区回归：搜索日期匹配使用设备时区（Asia/Shanghai），与切片 11 修正后的 getDeviceTzid 一致；
    不出现 UTC 坐标系下的日期错位。

### 分支与提交
12. 按 AGENTS.md §7.8–7.11 建 task/slice-12，验收后合并；
    push 遇 reset 加 -c http.version=HTTP/1.1。

## 完成后输出
- 修改/新增文件列表
- 确认无 schema 变更 / 无原生依赖新增 / 冻结区零 diff
- searchItems 日期匹配的实际命中示例（真机数据）
- 导出 JSON 的字段清单（确认不含内部迁移字段）
- 导出文件的实际大小与条数
- 快速记录连续创建的实际观察（键盘、焦点、输入框状态）
- 每条验收标准对应的测试名称或真机观察
- 未完成项与风险（搜索日期匹配的歧义边界、导出不含 reminders 完整规则的影响）
- 是否触碰受保护契约（应为“否”）
- 分支名、commit hash、merge hash、远端核对结果
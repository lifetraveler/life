# 切片 2：标签系统 + 类型转换（灵感转任务）

## 目标
在切片 1 的 Item 基础上，引入 Tag / ItemTag 多对多标签系统，并支持将 note 类型 Item 转换为 task。
本切片结束时，标签关系在重启后不丢，类型转换持久化生效。

## 允许修改/新增的范围
- src/db/：Tag、ItemTag model；schema version 1→2；migration step；Item 的 @children('item_tags') 关系
- src/data/：Repository 实现新增 updateItem、addTagToItem、removeTagFromItem、listItemsWithTags
- src/domain/：UpdateItemInput、ItemWithTags 类型；标签名规范化函数（trim、大小写去重）
- src/app/：记录页增加标签输入；列表项展示标签；列表项增加“转为任务”操作
- src/ui/：标签 chip 展示组件（如需要）

## 禁止修改/实现
- 不实现搜索、归档、今日/本周视图、提醒、ICS、系统日历、小组件
- 不引入新状态库
- 不修改切片 1 已发布的 migration step；只在末尾追加
- 不把标签存为 Item 字段字符串
- 不删除或“简化”WatermelonDB 装饰器与构建配置
- 不修改 AGENTS.md 4.1 中 Item 的既有字段与 type 枚举

## 实现要求
1. Schema version 1→2：新增 tags、item_tags 表；migration 必须显式建表。
2. Tag.name 唯一性：addTagToItem 时先按 trim + 大小写不敏感查找，存在则复用，不存在才创建。
3. 标签输入交互（最小实现）：
   - 输入标签名后按回车或逗号创建并绑定到当前 Item；
   - 已有标签可点击选择复用；
   - 标签可移除。
4. 列表项展示标签 chip；使用 listItemsWithTags 获取数据。
5. “转为任务”：仅对 type=note 的 Item 显示；点击后调用 updateItem({ type: 'task' })；列表即时刷新，重启后仍为 task。
6. 新增文件不得出现 `any` / `as any`；UI 不得直接 import WatermelonDB database/model。

## 验收标准（逐条执行并报告）
1. `npx tsc --noEmit` 零错误。
2. `npx expo-doctor` 无阻塞性错误。
3. Android 真机 development build 覆盖安装（不卸载），确认 migration 执行且切片 1 数据仍在。
4. 手动步骤：
   a. 新建 Item，标题“切片2标签A”，添加标签“工作”，保存；
   b. 再新建 Item，标题“切片2标签B”，添加标签“工作”，保存；
   c. 检查数据库中 Tag“工作”只有一条，两条 Item 均关联该标签；
   d. 移除“切片2标签A”的“工作”标签，列表不再显示该 chip；
   e. 将“切片2标签B”从 note 转为 task，列表 type 变为 task；
   f. 杀掉进程重开，确认标签关系与类型转换均保留。
5. 代码检查：migration 为追加而非修改；无 `any`；UI 未直连数据库。

## 完成后输出
- 修改/新增文件列表
- schema version 与 migration step 摘要
- 执行的命令及结果
- 真机验收每一步的实际观察
- 未完成项与风险
- 是否触碰受保护契约（应为“否”；若为“是”，附变更提案）
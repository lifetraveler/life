# 切片 1：工程骨架 + 一条记录的完整闭环

## 目标

初始化 Expo + TypeScript 工程，接入 WatermelonDB，实现 Item 的创建和列表读取，数据重启不丢。
本切片结束时，App 必须可在 Android 真机 development build 上安装运行。

## 允许修改/新增的范围

- 工程初始化文件：package.json、app.json/app.config.*、babel.config.*、tsconfig.json
- src/db/：WatermelonDB schema、Item model、database 初始化、migrations 占位
- src/data/：Repository 接口与 WatermelonDB 实现
- src/domain/：CreateItemInput、Item 类型定义（纯 TypeScript）
- src/app/：一个最小页面，包含输入框、类型选择（note/task/event）、保存按钮、列表
- src/ui/：如需要，最小展示组件
- 允许新增 WatermelonDB / Expo 构建所需的最小依赖

## 禁止修改/实现

- 不实现提醒、通知、重复规则
- 不实现标签、搜索、归档
- 不实现今日/本周视图、ICS、系统日历、桌面小组件
- 不引入 Redux/MobX/Zustand
- 不修改 AGENTS.md 中的受保护契约
- 不为了绕过构建问题删除 WatermelonDB 的 Babel / plugin / expo-build-properties 配置

## 实现要求

1. Item 模型字段严格按 AGENTS.md 4.1：
   id、type、title、content、status、createdAt、updatedAt。
2. Repository 至少提供：
   - createItem(input: CreateItemInput): Promise<Item>
   - listItems(): Promise<Item[]>
     UI 只能通过 Repository 访问数据。
3. 最小页面行为：
   - 输入标题（必填）、可选内容；
   - 选择 type：note/task/event；
   - 点击保存后写入 WatermelonDB；
   - 列表展示已有 Item 的 title、type、createdAt；
   - 重启 App 后列表仍存在。
4. 新增 TypeScript 文件不得出现 `any` 或 `as any`。
5. 使用 development build 验证，不使用 Expo Go 作为数据库功能验收环境。

## 验收标准（必须逐条执行并报告结果）

1. `npx tsc --noEmit` 零错误。
2. `npx expo-doctor` 无阻塞性错误；如有 warning，逐条说明是否影响本切片。
3. Android 真机 development build 安装成功。
4. 手动步骤：
   a. 打开 App，新建一条 type=note 的记录，标题为“切片1验收”；
   b. 杀掉 App 进程，重新打开；
   c. 列表中仍能看到“切片1验收”，且 type 正确；
   d. 再新建一条 type=task 的记录，列表出现两条。
5. 代码检查：新增文件中无 `any` / `as any`；UI 未直接 import WatermelonDB database/model；UI 未直接 import expo-notifications。

## 完成后输出

- 修改/新增文件列表
- 执行的命令及结果
- 真机验收结果（每一步的实际观察）
- 未完成项与风险
- 是否触碰受保护契约（应为“否”）

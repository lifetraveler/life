# 切片 14 · 阶段 1 反馈总结（数据底座与迁移）

- 日期：2026-11-07
- 阶段：Phase 1 / 6（数据底座与迁移）
- 分支：`task/slice-14`（基点 task/slice-13 @ 9930c01）
- 阶段提交：`55c8c01 feat(s14): 阶段1 数据底座与迁移`（34 文件，+1643/-127）
- 状态：✅ 完成，已暂停等待阶段 2 确认

## 一、成果定性：达标，可进入阶段 2

阶段 1 的目标是给整个切片 14 打数据地基，交付质量用三个硬指标背书：

| 维度 | 结果 |
| --- | --- |
| 类型安全 | `npx tsc --noEmit` 0 error（含 21 个测试夹具错误全部清零） |
| 测试 | `npx jest --runInBand` 31 套件 / 382 用例全过，其中新增 16 个用例专测本阶段行为 |
| 提交 | `55c8c01`，34 文件 +1643/-127，历史 migration step 未动一行 |

架构上最重要的两个决策都按任务卡落地：

1. **Item 不再有 color**（schema v6 移除路径由颜色统一由 Category 提供承接）。
2. **所有查询返回 `ItemWithRelations`**（Repository 内批量 `Q.oneOf` 水合 Category+Tags，UI 层零 N+1、零自查表，AGENTS.md §7.23）。

## 二、做得好的三点

1. **水合方案选型正确**。没有用 `@children/@relation` 装饰器（会引入 N+1），也没有全表 join 扫描，而是 items → 收集 categoryId/itemId → `Q.oneOf` 批量取 categories/tags → 内存 Map 合并。`categorySettings.test.ts` 连「悬挂 categoryId → category 返回 null 不抛错」的数据异常容错都测到了（repository.md v0.14 约定）。
2. **升级/全新安装两条路径都兜住了**。升级安装走 migration（`INSERT OR IGNORE` 预置 5 分类 + SQL 回填 `category_id='other'` + app_settings 默认行）；全新安装走 `src/db/seed.ts` 幂等种子（database.ts 模块加载 kick + Repository 写路径 `ensureSeeded()` 双保险）。预置数据只有 `src/domain/category.ts` 的 `PRESET_CATEGORIES` 一个数据源，migration 与 seed 均由它派生，不会漂移。
3. **低 Token 协作纪律执行到位**：核心架构（schema/migration/repository）由 Captain 亲自写；单测+夹具整包派发子代理（只回文件清单/tsc/jest 状态/三个发现）；Captain review 时抓住子代理漏掉的绑定顺序毫秒抖动（两次 `addTagToItem` 同毫秒导致标签顺序断言随机），补 `sleep(5)` 后复跑确认。

## 三、过程中暴露的问题（均已修复，留作教训）

1. **lokijs 测试适配器静默忽略 `sql` 迁移步骤**——行为级迁移验证在单测环境不可能，只能结构断言（step 类型序列/表名/列名/SQL 字符串）+ 真机覆盖安装兜底。教训：测不到的路径必须显式声明验收手段。
2. **v6 让 7 个旧测试套件预存失败**（modelClasses 未注册新表 → `CollectionMap.get` 返回 null 而非报错 → TypeError）。教训：schema 加表是全局涟漪，所有 `new Database` 调用点（含测试夹具）都要同步登记。
3. **`ensureSeeded` 在导入批写前多了一次 `db.write`**，导致依赖 write 计数的 spy 断言偏差（importExport.test.ts）。修法：`getCategories()` 预热 + `mockClear()` 保「2 批写入」语义。教训：给写路径加前置副作用时要全量排查 spy 计数断言。
4. **实现期小失误链**（均由 tsc 兜住）：`seed.ts` 在 Collection 上误调 `fetchCount`（应 `.query().fetchCount()`）、`TagModel` 漏导 `field` 装饰器、migration 里裸字符串未包裹成 step。教训：「每写完一批立刻 tsc」的节奏有效，保持。

## 四、契约合规与遗留风险（按优先级）

1. **真机验收是本阶段唯一未闭环项**：迁移回填与预置插入的行为级验证只能靠真机覆盖安装（验收点：老数据 items 全部落 `other`、tags 颜色为空、5 条预置分类就位）。**建议阶段 2 开工前或任意真机节点优先做覆盖安装验证**，避免带未验证的迁移风险越走越远。
2. **priority 入参是契约外扩展**（repository.md v0.14 只明文 categoryId；`CreateItemInput/UpdateItemInput.priority?: number` 已在 `src/data/ItemRepository.ts` 文档头循 deleteItem/observe* 先例声明）。closeout 时如实披露。
3. **分支基点偏差**：`task/slice-14` 基于未合并的 `task/slice-13`（main 尚无切片 13 提交），合并回 main 时注意顺序，勿强推。
4. 12 个消费 `ItemWithTags` 的旧 UI/domain 文件靠结构兼容暂时编译通过，尚未消费 category 新字段——阶段 2+ 范围，不算技术债。

## 五、给阶段 2 的一句话建议

数据层已「只欠真机验证」，阶段 2（纯逻辑与基础 UI 组件）可放心消费 `ItemWithRelations.category/tags` 与 `getCategories()`；唯一前置动作建议是那一次真机覆盖安装。

## 附：阶段 1 修改文件清单

- **核心实现**：`src/db/schema.ts`（v6）、`src/db/migrations.ts`（v6 步骤，历史 step 未动）、`src/db/seed.ts`（新）、`src/db/models/CategoryModel.ts`（新）、`src/db/models/AppSettingsModel.ts`（新）、`src/db/models/ItemModel.ts`、`src/db/models/TagModel.ts`、`src/db/database.ts`、`src/domain/category.ts`（新）、`src/domain/settings.ts`（新）、`src/domain/relations/itemWithRelations.ts`（新）、`src/domain/item.ts`、`src/domain/tag.ts`、`src/data/ItemRepository.ts`、`src/data/WatermelonItemRepository.ts`
- **测试**：新增 `src/db/__tests__/seedPreset.test.ts`、`src/data/__tests__/categorySettings.test.ts`；修 12 个旧测试夹具（modelClasses 补注册 / FakeRepository 签名与 5 个新方法 stub / 字面量夹具补字段 / spy 预热）
- **文档**：AGENTS.md（v0.14 + §7.21 去重）、docs/contracts/{data-model,repository,ui}.md、本文件

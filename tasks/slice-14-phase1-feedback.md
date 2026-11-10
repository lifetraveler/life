# 切片 14 · 阶段 1 反馈总结（数据底座与迁移）

- 日期：2026-11-07
- 阶段：Phase 1 / 6（数据底座与迁移）
- 分支：`task/slice-14`（基点 task/slice-13 @ 9930c01）
- 阶段提交：`55c8c01 feat(s14): 阶段1 数据底座与迁移`（34 文件，+1643/-127）
- 状态：✅ 完成（含真机覆盖安装验收，2026-11-07 补），已暂停等待阶段 2 确认

## 一、成果定性：达标，可进入阶段 2

阶段 1 的目标是给整个切片 14 打数据地基，交付质量用三个硬指标背书：

| 维度 | 结果 |
| --- | --- |
| 类型安全 | `npx tsc --noEmit` 0 error（含 21 个测试夹具错误全部清零） |
| 测试 | `npx jest --runInBand` 31 套件 / 382 用例全过，其中新增 16 个用例专测本阶段行为 |
| 提交 | `55c8c01`，34 文件 +1643/-127，历史 migration step 未动一行 |
| 真机验收 | MuMu 覆盖安装 migration v5→v6 实际执行，7 项断言全过（见 §六） |

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

1. ~~真机验收是本阶段唯一未闭环项~~ → **已闭环**（2026-11-07 真机覆盖安装验收通过，记录见 §六）。任务卡阶段 1 三项验收（tsc 零错误 / 覆盖安装后旧数据关联 other、tags 颜色为空 / 查询接口返回 ItemWithRelations）全部满足。
2. **priority 入参是契约外扩展**（repository.md v0.14 只明文 categoryId；`CreateItemInput/UpdateItemInput.priority?: number` 已在 `src/data/ItemRepository.ts` 文档头循 deleteItem/observe* 先例声明）。closeout 时如实披露。
3. **分支基点偏差**：`task/slice-14` 基于未合并的 `task/slice-13`（main 尚无切片 13 提交），合并回 main 时注意顺序，勿强推。
4. 12 个消费 `ItemWithTags` 的旧 UI/domain 文件靠结构兼容暂时编译通过，尚未消费 category 新字段——阶段 2+ 范围，不算技术债。

## 五、给阶段 2 的一句话建议

数据层已全部验证闭环（单测 + 真机迁移），阶段 2（纯逻辑与基础 UI 组件）可放心消费 `ItemWithRelations.category/tags` 与 `getCategories()`，无前置阻塞。

## 六、真机覆盖安装验收记录（2026-11-07，MuMu 模拟器）

**环境**：MuMu（adb 127.0.0.1:7555，adb root 可用）、Oracle JDK 17.0.10、Gradle 8.14.3 增量构建 1m25s（626 tasks，562 up-to-date）、`adb install -r` 流式安装 179MB APK。

**升级前基线**（旧安装 2026-11-06 切片 13 版本）：`user_version=5`；表 items/item_tags/reminders/tags/local_storage；数据 9 items / 1 tag（seed-tag-1）/ 1 绑定 / 4 reminders；items 表 15 列无 category_id/priority。

**升级后断言（7/7 通过）**：

| # | 断言 | 结果 |
| --- | --- | --- |
| 1 | `categories` + `app_settings` 表已建 | ✅ |
| 2 | 5 条预置分类精确匹配契约（work 工作 #E57373 💼 1 / personal 个人 #64B5F6 🏠 2 / study 学习 #FFB74D 📚 3 / health 健康 #81C784 🏃 4 / other 其他 #9E9E9E 📌 5，`_status='synced'`） | ✅ |
| 3 | `app_settings` 单行 `global` / `text`（`_changed=''`） | ✅ |
| 4 | 9 条旧 items 全部回填 `category_id='other'`、`priority=0` | ✅ |
| 5 | 旧 tag `seed-tag-1` 的 color/emoji 为 NULL | ✅ |
| 6 | 旧数据零丢失（9 items，id/标题与升级前快照一致：连续二/连续一/样例E/D…） | ✅ |
| 7 | `items_category_id` 索引已建（isIndexed 生效） | ✅ |

**可观察验收**：app 进程存活（pid 3325），logcat 无 WatermelonDB/FATAL 错误；首页截图正常渲染旧条目（已归档样例E / SLICE11-CAL-EVENT / 连续二），证明查询接口经新的 `ItemWithRelations` 水合路径端到端工作。证据截图：`.tmp-session-log/acceptance-home.png`。

**补充事实**：
- `user_version` 由 JS 层打开数据库时从 5 升至 6（安装后、启动前确认仍为 5，启动后为 6——迁移确由新 bundle 触发，非安装时）。
- 升级路径中 migration 先插 5 条预置分类，模块级 `seedPresetData` 幂等跳过（categories 恰 5 行，无重复）——两条预置路径的互斥性在真机得到验证。
- 全新安装（无旧数据）的 seed 路径由单测覆盖；未在真机做全新安装（会清掉本次验收的旧数据基线，不值得）。
- 环境坑（已绕过，未改用户配置）：本会话 shell 的 `JAVA_HOME` 指向已删除目录（jenv 全局配置指向失效路径），构建时以调用级变量 `JAVA_HOME=D:\enviroment\java\jdk\oracle-jdk-17.0.10` 覆盖；expo CLI 的设备解析会撞 adb 僵尸条目 `emulator-5556`，改走「gradlew assembleDebug → adb install -r → expo start --dev-client → adb reverse → monkey 启动」手动管线。

## 附：阶段 1 修改文件清单

- **核心实现**：`src/db/schema.ts`（v6）、`src/db/migrations.ts`（v6 步骤，历史 step 未动）、`src/db/seed.ts`（新）、`src/db/models/CategoryModel.ts`（新）、`src/db/models/AppSettingsModel.ts`（新）、`src/db/models/ItemModel.ts`、`src/db/models/TagModel.ts`、`src/db/database.ts`、`src/domain/category.ts`（新）、`src/domain/settings.ts`（新）、`src/domain/relations/itemWithRelations.ts`（新）、`src/domain/item.ts`、`src/domain/tag.ts`、`src/data/ItemRepository.ts`、`src/data/WatermelonItemRepository.ts`
- **测试**：新增 `src/db/__tests__/seedPreset.test.ts`、`src/data/__tests__/categorySettings.test.ts`；修 12 个旧测试夹具（modelClasses 补注册 / FakeRepository 签名与 5 个新方法 stub / 字面量夹具补字段 / spy 预热）
- **文档**：AGENTS.md（v0.14 + §7.21 去重）、docs/contracts/{data-model,repository,ui}.md、本文件

# 切片 2 收尾移交（Close-out Handoff）

> 生成于切片 2 正式关闭时。切片 3 新会话按 AGENTS.md §7.1 读 AGENTS.md（v0.2）+ tasks/slice-03.md（如已创建），本文件只补充环境事实与教训，不改变任何契约。
> 验收结论：切片 2 全部验收标准通过，报告已交付。本次证据形式与切片 1 不同：adb UI dump XML + 设备 sqlite 库逐项检查（含 tags 表唯一性、join 指向、migration 后 user_version），**未存 acceptance/ 截图**。

## 环境事实（实测，勿重查）

- JDK / SDK / MuMu adb 与切片 1 完全一致：JAVA_HOME=`D:\enviroment\java\jdk\oracle-jdk-17.0.10`（构建前 export）；ANDROID_HOME=`D:\Android\Sdk`；adb 用 `E:\Program Files\Netease\MuMu\nx_device\15.0\shell\adb.exe`，设备 `127.0.0.1:16384`（Android 15）。
- app：`com.vibecoding.life`，versionName 仍 0.1.0（切片 2 未改版本号）；已装入 schema v2 的构建（17:36 覆盖安装，未卸载）。
- Metro：切片 2 收尾时已关闭（用户确认）。下次开发重新 `npx expo run:android`，增量构建约 3 分钟；dev client 杀进程后回 launcher，需 `adb reverse tcp:8081 tcp:8081` 后点 life 条目重载。
- 后台任务纪律（用户明确要求）：任务完成的当个回合必须宣告完成并收掉所有后台 job，不留 running 状态；切片完成经 dsh-im 微信通知用户。

## 数据库事实（切片 3 验收要用）

- 当前设备库状态 = 切片 1 基线：2 items（note「切片1验收」、task「切片1任务」）、0 tags、0 joins、`user_version=2`；测试数据（Slice2TestA/B + work 标签）已在收尾时清除。
- ⚠️ 披露：清理测试数据时直接操作过一次设备库文件（force-stop 后本地 sqlite 删行 → push 回推），schema 与用户数据未受影响。
- 库文件位置不变：`/data/data/com.vibecoding.life/life.db`（根目录，WAL 模式）。
- 切片 3 若动 schema：只能**在 migrations.ts 末尾追加** `toVersion: 3`，不得改既有 step（切片 1 的 v1 基线 + 切片 2 的 v2 createTable tags/item_tags 均已"发布"）。

## 切片 2 新增代码地图（切片 3 起点）

- `src/domain/tag.ts`：Tag / ItemTag / ItemWithTags / NormalizedTagName + `normalizeTagName()`（trim + toLowerCase）。
- `src/domain/item.ts`：追加 `UpdateItemInput{title?/content?/type?/status?}`。
- `src/db/schema.ts`：SCHEMA_VERSION=2，tags(name isIndexed)、item_tags(item_id/tag_id isIndexed)。
- `src/db/migrations.ts`：末尾 `{ toVersion:2, steps:[createTable tags, createTable item_tags] }`。
- `src/db/models/`：TagModel、ItemTagModel（`@text('item_id'/'tag_id')` + Q.where，**未用 @relation**）；ItemModel 加 `@children('item_tags')` + `static associations = associations(['item_tags',{type:'has_many',foreignKey:'item_id'}])` —— WatermelonDB 0.28 不自动收集 association，漏写运行时 invariant 崩。
- `src/data/ItemRepository.ts` / `WatermelonItemRepository.ts`：§4.5 冻结四方法 + 观察扩展；标签唯一性在 Repository 层保证（全量内存 toLowerCase 比对、复用孤儿 Tag、join 幂等）。
- `src/ui/TagChip.tsx`、`src/app/index.tsx`：标签输入（回车/逗号）、chips、行内编辑器+复用建议、转为任务。

## 踩坑教训（切片 2 新增，含对切片 1 教训的升级）

1. **二进制拉库必须 `adb exec-out`**：`adb shell` 走 pty 会把输出 LF→CRLF，破坏 sqlite 校验和（切片 1 只做 grep 文本所以没炸）。拉 life.db/-wal/-shm 三文件需一致快照：先 `am force-stop` 再顺序 cat。
2. **库回推**：勿用 `exec-in` + `sh -c`（git-bash 嵌套引号静默失败，exit 0 假象）→ 用 `adb push life.db /data/local/tmp/ && chmod 644 && run-as cp`。
3. **UI 自动化**：`uiautomator dump /sdcard/w.xml` 后 `exec-out cat` 取 XML；bounds "[l,t][r,b]" 解析用 `sed 's/\]\[/ /g; s/\[//g; s/\]//g; s/,/ /g'`（直接 tr 会吃掉 ] 分隔符）；焦点检查 grep `<node[^>]*EditText` 后看 focused="true"。
4. **adb input text 无法输中文** → 中文手动验收步骤需用户协作，AI 先做 DB 级验证。
5. 继承切片 1：MSYS 路径改写（adb shell 内一律相对路径）、MuMu UTC 显示晚 8 小时、expo-doctor 16/18 基线（信息级非阻塞）、WatermelonDB 构建配置受保护勿动。
6. 时间戳：updated_at 由 WatermelonDB `prepareUpdate` 自动刷新（绕过 readonly setter），updateItem 只写业务字段。

## 切片 2 遗留披露（原样带入切片 3 报告）

- 契约外观察扩展共 3 个：`observeItems`（切片 1，ItemRepository.ts:14 / WatermelonItemRepository.ts:55）、`observeItemsWithTags`、`observeTags`（切片 2，两文件新增部分；源码注释已声明理由）。
- ItemTagModel 不用 @relation（用 @text 列 + Q.where）；ItemModel static associations 为 @children 必要增量；均已在切片 2 报告披露。
- babel.config.js 仍缺可选 `@nozbe/watermelondb/babel` 性能插件（WARN，非必需）。

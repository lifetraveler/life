# 切片 3 收尾移交（Close-out Handoff）

> 生成于切片 3 正式关闭时。切片 4 新会话按 AGENTS.md §7.1 读 AGENTS.md（v0.3）+ tasks/slice-04.md（如已创建），本文件只补充环境事实与教训，不改变任何契约。
> 验收结论：切片 3 全部验收标准通过，报告已在会话内交付。证据形式：adb UI dump XML + 设备 sqlite 库逐项检查 + jest 单测，**未存 acceptance/ 截图**（中途关键节点留有会话内截图）。

## 环境事实（实测，勿重查）

- JDK / SDK / MuMu adb 与切片 1/2 一致：JAVA_HOME=`D:\enviroment\java\jdk\oracle-jdk-17.0.10`；ANDROID_HOME=`D:\Android\Sdk`；adb=`E:\Program Files\Netease\MuMu\nx_device\15.0\shell\adb.exe`，设备 `127.0.0.1:16384`（Android 15）。
- app：`com.vibecoding.life`，versionName 仍 0.1.0；本次经 `npx expo run:android` 覆盖安装（BUILD SUCCESSFUL in 38s，增量），未卸载。
- Metro：切片 3 收尾时按后台任务纪律已关闭（job 已收）。下次开发重新 `npx expo run:android`。
- dev client 冷启动流程（本次实测）：`am force-stop` 后 `am start -n com.vibecoding.life/.MainActivity` 会落 launcher 页，需点 Connect（或用深链 `exp+life://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081` 直连，前提先 `adb reverse tcp:8081 tcp:8081`）。
- 后台任务纪律（用户明确要求，继承切片 2）：任务完成的当个回合宣告完成并收掉所有后台 job；切片完成经 dsh-im 微信通知用户。

## 数据库事实（切片 4 验收要用）

- 当前设备库 = 切片 3 收尾基线：5 items（note「杂技」content=今天开了周会、note「周会纪要」、note「买菜」、note「切片1验收」、task「切片1任务」，全部 active）、2 tags（工作、生活）、2 joins（周会纪要↔工作、买菜↔生活）、`user_version=2`。
- 本次全程未直接写设备库文件（与切片 2 不同）：所有数据变更均经 app UI 驱动产生；测试用 zztest/zztag 表单在保存前被 app 重启清掉，库中无残留（已查 `LIKE '%zztest%'` = 0）。
- 库文件位置不变：`/data/data/com.vibecoding.life/life.db`（根目录，WAL 模式）；快照 = force-stop 后 `exec-out run-as ... cat` 拉 life.db/-wal（-shm 可省）本地重放。
- 切片 4 若动 schema：只能在 migrations.ts 末尾追加 `toVersion: 4`，不得改既有 step（v1 基线 + v2 tags/item_tags 已"发布"；切片 3 未动 schema，仍 toVersion:2）。

## 切片 3 新增代码地图（切片 4 起点）

- `src/domain/search.ts`：`normalizeSearchKeyword()`（trim）+ `escapeLikePattern()`（`raw.replace(/[\\%_]/g, '\\$&')`，LIKE_SPECIALS=/[\\%_]/g）。
- `src/domain/__tests__/search.test.ts`：15 用例（trim/空白/转义 % _ \ / 组合/拼接约定）。
- `src/data/ItemRepository.ts` / `WatermelonItemRepository.ts`：§4.7 冻结四方法（searchItems / archiveItem / unarchiveItem / listArchivedItems）+ 常量 NOT_ARCHIVED、SORT_BY_UPDATED_DESC；searchItems 分步实现（tags→item_tags→title/content→合并去重→updatedAt 降序）；`loadItemsWithTagsByItemQuery(db, itemQuery)` helper。
- `src/ui/SearchInput.tsx`、`src/ui/EmptyState.tsx`、`src/ui/display.ts`（TYPE_LABELS + formatTimestamp，从 index.tsx 提取共用）。
- `src/app/index.tsx`：搜索防抖 300ms + searchSeqRef 竞态序号（最后一次输入为准）；`displayedItems = searching ? searchResults : items`（纯空白也进搜索模式）；归档按钮；搜索模式下归档后 runSearch 重放。
- `src/app/archived.tsx`：已归档页（useFocusEffect 刷新 + 取消归档后 refresh + TagChip 只读）。
- `src/app/_layout.tsx`：注册 `<Stack.Screen name="archived" options={{ title: '已归档' }} />`。
- `jest.config.js`：preset 'jest-expo'，testMatch `<rootDir>/src/**/*.test.@(ts|tsx)`。

## 踩坑教训（切片 3 新增，含对切片 1/2 教训的继承）

1. **Metro 死后 dev client 的 JS 列表快照会失真**：本切片实测宿主 Metro 进程死亡后（8081 无监听），app 仍在前台但列表渲染出"幽灵行"（只有 meta 行无标题）且漏行——而 DB 数据始终正确。验收时 UI 与 DB 不符，先拉库对比再怀疑代码；恢复 = 重启 Metro + `adb reverse` + 冷启动深链重连。
2. **Metro 健康检查**：`curl http://localhost:8081/status` 返回 `packager-status:running` 即健康；每次长间隔 UI 操作前顺手查一次。
3. `input swipe` 起点必须落在列表滚动区内（落在表单 TextInput 上手势无效）；uiautomator dump 只含视口内节点，长列表先滚回顶部/目标行再取坐标；**每次点击前重新 dump**（归档/取消归档会 bump updated_at 触发行重排）。
4. 本会话 bash 是原生 Windows GNU bash（无 cygpath）：`/tmp` 是 MSYS 映射，Windows 版 Python 看不见 → 用 `readlink -f` 转真实路径传给 Python；Python 输出中文用 `sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')`。
5. 标签输入**必须回车/逗号确认成 chip** 才会在保存时绑定（用户预置数据时漏过一次，Metro 日志无 `createItem with tags failed` 即代码路径未被调用）；补绑可用行内「添加标签」编辑器。
6. Q.like 编译为裸 LIKE（无 ESCAPE 子句，encodeQuery/index.js:53,118），`Q.sanitizeLikeString` 会毁中文——转义必须自己做（`src/domain/search.ts`），`Q.where(col, Q.like(pattern))` 是唯一正确用法。
7. 归档/取消归档复用 updateItem → updated_at 被刷新、列表位置随之变化：这是 §4.8 的预期行为（unarchive 后置顶不是 bug）；unarchive 统一恢复 'active'（MVP 不追踪归档前状态）。
8. 继承切片 2：exec-out 拉二进制库、UI dump 解析 sed、adb 无法输中文（中文步骤用户协作）、MuMu UTC 显示晚 8h、expo-doctor 16/18 信息级基线、WatermelonDB 构建配置受保护。

## 切片 3 遗留披露（原样带入切片 4 报告）

- **LIKE ESCAPE 库限制**：WatermelonDB 0.28 Q.like 无 ESCAPE 子句，`%`/`_`/`\` 转义后无法按字面精确命中含这三个字符的内容（如搜 `%` 会匹配含字面反斜杠的串而非含 % 的串）；满足任务卡"不报错、不返回全部"，精确命中受库限制已披露，修复需等上游 ESCAPE 支持或 FTS5（两者都被卡禁）。
- observe* 契约外扩展（切片 1/2 遗留）原样带入：`observeItems`、`observeItemsWithTags`、`observeTags`。
- ItemTagModel 不用 @relation、ItemModel static associations 为 @children 必要增量（切片 2 披露，未变）。
- babel.config.js 仍缺可选 `@nozbe/watermelondb/babel` 性能插件（WARN，非必需）。
- dev 环境观察一条：上述"幽灵列表"事件仅出现于 Metro 死亡后的会话；Metro 健康期间未复现。若后续真机/生产 build 再现同类失真，需按 WatermelonDB observer 方向排查。

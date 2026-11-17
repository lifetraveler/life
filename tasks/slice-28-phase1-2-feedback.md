# 切片 28 阶段反馈：Phase 1–2（配置备份 WebDAV 域/数据层 + 设置页 UI）

- 日期：2026-11-18
- 阶段范围：**Phase 1–2 / 共 3**——域快照层（configSnapshot + webdav 纯函数）、数据层（WebdavClient / SecureWebdavConfigStore / Repository 成对扩展 + 单测）、UI 设置页（backup.tsx 全流程 + profile navRow + Stack 注册）；Phase 3（真机矩阵 10 条 + closeout）待执行。
- 分支：`task/slice-28`（基点 main @ `4c8e6ea`）
- 状态：**Phase 1–2 完成，暂停等待 Phase 3 真机验收**（MuMu + 宿主机临时 node WebDAV，验收后 closeout）。

## 各阶段提交

| 提交 | 内容 | 文件/增删 |
| --- | --- | --- |
| `2125ba3` | 阶段 1：域+数据层（快照组包/增量覆盖恢复/WebDAV 客户端/SecureStore 连接配置/repository.md v0.34 注记节/AGENTS v0.34/卡+提案） | 19 files, +2618/−4 |
| `90774f1` | 阶段 2：备份与恢复设置页（连接表单/测试连接/立即备份/快照列表恢复删除 + profile navRow + Stack.Screen） | 3 files, +612 |

## 成果定性表

| 验证项 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | 0 错（两阶段各自复验均 0 错） |
| `npx jest --runInBand` | **95 套件 / 1314 用例全过**（基线 90/1241；+5 套件 +73 用例 = configSnapshot / webdavPure / WebdavClient / SecureWebdavConfigStore / configSnapshotRepository） |
| `npx expo-doctor` | 16/18 过；2 项失败 = 预存基线（app config 非 CNG 同步检查、React Native Directory 元数据检查），无新增 |
| schema | 停留 v15 零迁移（D8） |
| 真机/模拟器验收 | 未执行（Phase 3） |

## 范围落点表

| 文件 | 落点 | 解决的问题 |
| --- | --- | --- |
| `src/domain/configSnapshot.ts`（新） | ConfigSnapshot 类型族 + `isConfigSnapshotWire` 整包守卫（version/kind/exportedAt/appSettings/categories/tags）+ `isConfigSnapshotCategoryEntry`/`isConfigSnapshotTagEntry` 条目级宽容谓词 + `parseConfigSnapshot`（JSON 错误与形状错误分开报）+ `CONFIG_SNAPSHOT_FILE_PATTERN`/`configSnapshotFileName`（本地时区）/`formatExportedAt`（本地 ISO ±HH:MM）/`normalizeSnapshotAppSettings` | 快照格式契约单一来源；appSettings 缺列保留本地、坏值走既有 parse* 归一回退默认 |
| `src/domain/webdav/config.ts`（新） | `WebdavConfig` + `WEBDAV_BACKUP_CONFIG_STORE_KEY='webdav_backup_config_v1'` + `isWebdavConfig`（baseUrl 必须 http(s)，username/password 原样不 trim——密码可能含首尾空格）+ `WebdavBackupConfigStore` 端口 | 连接配置守卫与存储端口；domain 不触 SecureStore |
| `src/domain/webdav/url.ts`（新） | `normalizeWebdavBaseUrl`/`webdavBasePathSegments`/`buildWebdavUrl`（逐段 encodeURIComponent；basePath 空返回 `${base}/`）/`isInsecureHttpUrl` | URL 组装纯函数，双斜杠与根目录路径边界 |
| `src/domain/webdav/WebdavError.ts`（新） | kind 五类 {network, http-status, auth, invalid-response, timeout} + `WEBDAV_ERROR_KIND_LABELS`（中文文案，UI 消费）+ `WebdavError{kind, status}` | 错误分类文案（ai KIND_LABELS 先例） |
| `src/domain/webdav/base64.ts`（新） | `encodeBase64Utf8` 纯 TS（码点迭代 UTF-8 1–4 字节） | Basic Auth 不依赖 Node Buffer / btoa 平台差异 |
| `src/data/webdav/WebdavClient.ts`（新） | PROPFIND(Depth:1, href 为主 + displayname 兜底 + getlastmodified)/GET/PUT/MKCOL(405 容忍)/DELETE；Basic Auth（匿名=双字段均空不发 Authorization）；15s AbortController 超时；`fetchImpl` 注入；`uploadSnapshot` 返回 {fileName, prunedCount, pruneFailedNames}（保留前 10 倒序 DELETE，404 忽略、失败披露不阻塞）；XML 解析模块级私有（命名空间宽容 response/href/displayname，XML 实体 &amp; 最后解码防双重） | D3 客户端全量；PROPFIND 兼容性以 href 为主化解 |
| `src/data/SecureWebdavConfigStore.ts`（新） | SecureAiConfigStore 同构（load null/损坏→null 不抛错；save/clear） | D4 连接配置独立键，不入 app_settings（自引用防护） |
| `src/data/ItemRepository.ts` | 端口尾成对 `createConfigSnapshot`/`applyConfigSnapshot`（切片 28 注释块 + JSDoc，先例 filterExistingItemIds） | D6 契约外显式扩展成对；冻结签名零 diff |
| `src/data/WatermelonItemRepository.ts` | createConfigSnapshot（Promise.all 组包）+ applyConfigSnapshot（读取先行 → prepareUpdate/prepareCreate 同步收集 → 单次 `db.batch` 原子提交；tags 两遍法；返回 {applied, skipped}） | D2 增量覆盖冻结语义 + 事务原子（逐 model.update 不构成事务的源码级结论落地） |
| `src/notifications/__tests__/ReminderScheduler.test.ts` | FakeRepository 补两方法 stub（throw 说明） | §7.13 夹具编译必需，非实现改动 |
| `src/domain/__tests__/configSnapshot.test.ts`（新） | 守卫/条目谓词/serialize-parse roundtrip/文件名/时区 roundtrip/normalize 全场景 | 域层契约固化 |
| `src/domain/webdav/__tests__/webdavPure.test.ts`（新） | URL 组装/守卫/base64（Buffer 交叉验证）/错误文案 | 纯函数固化 |
| `src/data/webdav/__tests__/WebdavClient.test.ts`（新） | fakeFetch + 真实 Response；testConnection 207/401/403/500/network/timeout、匿名无 Authorization、listSnapshots 过滤+倒序+displayname 兜底+空目录+invalid-response、uploadSnapshot MKCOL 405/500/裁剪顺序/pruneFailedNames、非法文件名零网络调用、download/delete 404 | D3 行为矩阵 |
| `src/data/__tests__/SecureWebdavConfigStore.test.ts`（新） | mock expo-secure-store 同构用例 | D4 |
| `src/data/__tests__/configSnapshotRepository.test.ts`（新） | LokiJS 内存库真 repo：组包/定制组包/roundtrip 恢复/归一命中+创建+同快照重复名/条目级 skipped 计数/部分缺列/坏值回退/非法快照零变化/batch 失败回滚（Loki 原始行断言）/单次 batch 操作集/缺行建行/端口绑定编译面 | D2 语义与原子性实证 |
| `src/app/settings/backup.tsx`（新，Phase 2） | 连接表单（SecureStore 回填 + 显示/隐藏密码 + http 明文警告）+ 测试连接 + 保存连接 + 立即备份（pruned/pruneFailed 披露）+ 快照列表（倒序、行内恢复 Alert 确认→applied/skipped 披露、删除确认）+ busy 全局互斥 + WebdavError kind 文案 + Token 化深浅色 | D7 UI 全流程 |
| `src/app/(tabs)/profile.tsx` | 提醒渠道区 navRow「备份与恢复」→ `/settings/backup` | D7 入口 |
| `src/app/_layout.tsx` | `Stack.Screen name="settings/backup" options={{ title: '备份与恢复' }}` | 页头标题 |
| `docs/contracts/repository.md` | 追加「配置备份快照接口（v0.34，切片 28 阶段 1 落地）」注记节 + **披露卡/提案标 v0.22 的标签偏差**（按惯例标 v0.34） | §6 非破坏性注记 + 冻结签名零 diff |
| `AGENTS.md` | v0.34：§7.42 成文 + §8 当前切片更新 | 立项登记随阶段 1 |
| `tasks/slice-28.md` / `docs/proposals/slice-28-config-backup-webdav.md` | 任务卡 + 提案（五问定案）随阶段 1 提交 | 可追溯 |

## 关键设计落点（后续阶段/切片消费面）

- **增量覆盖冻结语义（repository.md v0.34 注记节为准）**：appSettings 全列覆盖缺列保留本地；categories 按 id 命中覆盖（未命中保留不建、不计数）；tags 按 normalizeTagName 归一键命中覆盖/未命中创建/本地独有保留、同快照重复名后者覆盖前者；计数口径 applied = settings 1 + 实际写入条目数（重复名按条目累计）、skipped = 形状不符数。
- **事务原子实现范式**：读取先行 → prepareUpdate/prepareCreate 同步收集进 operations → 单次 `db.batch(...)`。⚠️ 源码级结论：WatermelonDB `model.update()` 每次单独 adapter.batch，db.write 内逐 op await **不构成事务**；同批 prepareCreate 后再 prepareUpdate 同一模型会触发 "Cannot update a record with pending changes" + nextTick 不变式异步崩溃——tags 两遍法（先归并 pendingTagOps 再统一 prepare）规避。
- **batch 失败回滚的可观测边界**：adapter.batch 失败只回滚持久层；同 Database 的 prepareUpdate 已同步改写 model._raw（内存缓存不回滚），且同 adapter 上新建第二个 Database 会触发 "Record ID ... was sent over the bridge, but it's not cached"。回滚断言唯一可信路径 = 读 Loki 原始行（测试 extractLokiHandle + getCollection('...').data）。
- **LokiJSAdapter.batch 为 callback 风格** `(operations, callback)`：注入失败必须 `mockImplementationOnce((_op, cb) => cb({error}))`；Promise.reject 实现会 unhandled rejection + toPromise 永不 settle → 测试超时。
- **UI 消费面**：`WEBDAV_ERROR_KIND_LABELS[err.kind]` 出文案；`isInsecureHttpUrl` 出明文警告；快照文件名正则 `^life-config-\d{8}-\d{6}\.json$` 双侧过滤；恢复披露「已应用 N 项，跳过 M 项（形状不符）」。
- **应用计数与 server 侧披露**：uploadSnapshot 返回 prunedCount/pruneFailedNames，UI 拼「已清理 N 份旧快照；M 份清理失败（保留在服务器）」。

## 真机验收清单（Phase 3 执行；MuMu 127.0.0.1:7555 + 宿主机临时 node WebDAV 10.0.2.2）

任务卡 §3 矩阵 10 条全过（保存连接重启保持 / 测试连接凭据对错区分 auth 与 network / 备份文件落地核对 / 列表倒序过滤 / 恢复覆盖回归 / 本地独有保留 / 未命中创建 / >10 份滚动删除 / 不可达 network 文案 / 深浅色两态），验收后关闭临时服务器；closeout 按 §7.10 义务补齐（代码地图/教训/backlog 划项/AGENTS §8 收尾）。

## 教训索引（Phase 3 closeout 将并入对应小节）

1. **WatermelonDB batch 原子性与 prepare 不变式**（上文关键设计落点 2/3 条）——影响一切多写原子场景，closeout 展开为通用教训。
2. **jest spy 注入 callback 风格适配器方法**（上文第 4 条）——Promise.reject 式 mock 对 callback API 无效。
3. **注记节版本标签偏差**：卡/提案标 v0.22 → 实际按 AGENTS 版本标 v0.34，已在 repository.md 披露；后续写卡时标签应与 AGENTS 版本对齐。

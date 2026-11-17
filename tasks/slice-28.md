# 切片 28：配置备份 WebDAV（config backup）

- 日期：2026-11-18（立项）
- 基点：main @ `4c8e6ea`（切片 30 合并 + backlog 立项登记后）
- 分支：`task/slice-28`（从 main @ `4c8e6ea` 切出；提案/卡与 AGENTS.md v0.34 随阶段 1 提交）
- 提案：`docs/proposals/slice-28-config-backup-webdav.md`（用户 2026-11-18 五问定案，§7.5 闸门解除）
- 复杂度：中偏大；schema **停留 v15 零迁移**、无新依赖、不碰冻结区。

## 0. 明确不做（防蔓延）

- 数据备份（items / reminders / channel_presets）——后续切片（编号立项时定）。
- 持续双向同步、冲突合流——从未立项；如立项另走设计讨论 + 变更提案。
- 自动 / 定时 / 回前台备份——仅手动（用户 Q3）。
- 备份包加密、多 WebDAV 服务器配置——单配置全量明文（用户 Q5/D5）。
- AI Provider 配置（SecureStore `ai_provider_config_v1`）不进快照。
- 冻结区实现文件为空：`src/notifications/`、`src/domain/recurrence/`、`src/domain/export.ts`（切片 12 导出链路不动——数据备份切片再扩展）。
- 不改 `AiParser.parse` 冻结签名；`ChatMessage` kind 不新增；不做恢复前本地兜底快照（提案 §5）。

## 1. 设计决策（详见提案 §3–§5，此处只列落点级）

- **D1 快照范围**：`appSettings`（AppSettings 全字段）+ `categories`（预置 5 条 id/name/color/emoji/priority）+ `tags`（name/color/emoji）。格式 `{version:1, kind:'config', exportedAt, appSettings, categories, tags}`；`isConfigSnapshotWire` 整包拒绝（version/kind/三大块），条目级宽容跳过 + 计数披露。
- **D2 增量覆盖（冻结）**：appSettings 全列覆盖（快照缺列保留本地）；categories 按 id 命中覆盖、未命中保留不建；tags 按 name（trim + 大小写不敏感归一）命中覆盖 color/emoji、未命中**创建**、本地独有保留。恢复单 writer 事务原子完成。
- **D3 WebDAV 客户端**：`src/data/webdav/WebdavClient.ts`——PROPFIND（Depth:1，解析 href 为主）/GET/PUT/MKCOL（405 容忍）/DELETE；Basic Auth；15s AbortController 超时；`WebdavError kind ∈ {network, http-status, auth, invalid-response, timeout}`；测试注入 fetchImpl（openAiCompatible 先例）。
- **D4 连接配置存储**：`expo-secure-store` 键 `webdav_backup_config_v1`（`{baseUrl, basePath, username, password}`；`isWebdavConfig` 在 `src/domain/webdav/`，`SecureWebdavConfigStore` 在 data 层——`SecureAiConfigStore` 同构）。不入 app_settings/快照（恢复自引用防护，提案 §4.3）。
- **D5 文件布局**：`<basePath>/life-config-YYYYMMDD-HHmmss.json`；上传后 PROPFIND 倒序保留前 10，其余 DELETE（失败仅披露）；列表/删除仅匹配 `^life-config-\d{8}-\d{6}\.json$`。
- **D6 Repository 扩展**（契约外显式扩展成对，`filterExistingItemIds` 先例）：`createConfigSnapshot(): Promise<ConfigSnapshot>`（只读组包）+ `applyConfigSnapshot(snapshot): Promise<ApplyResult{applied, skipped}>`（writer 事务）。repository.md 追加注记节（v0.22），冻结签名零 diff。
- **D7 UI**：新页 `src/app/settings/backup.tsx`（路由自动注册，Stack 头 Token 先例）：连接表单（baseUrl/basePath/username/password 掩码）+「测试连接」（PROPFIND basePath）+「立即备份」+ 快照列表（倒序，行内「恢复」→ Alert 确认→ 恢复→ 结果行「已应用 N 跳过 M」）+ http 前缀提示 + 保留 10 份说明文案；profile.tsx 设置区新增 navRow「备份与恢复」。Token 化（makeStyles(colors)）。
- **D8 边界**：schema v15 零迁移、`SCHEMA_VERSION` 不动；ai.md/ui.md/data-model 零改动；ai-prompt 页/闪电录入零改动。

## 2. 阶段划分

- **阶段 1 域 + 数据层**：`src/domain/configSnapshot.ts`（类型/`isConfigSnapshotWire`/serialize/parse/文件名与正则纯函数）+ `src/domain/webdav/`（`WebdavConfig`/`isWebdavConfig`/URL join 纯函数/`WebdavError`）+ `src/data/webdav/WebdavClient.ts` + `src/data/SecureWebdavConfigStore.ts` + `ItemRepository`/`WatermelonItemRepository` 两方法（D6）+ repository.md 注记节 + AGENTS v0.34（§7.42/§8）+ 提案/卡随阶段 1 提交。单测：configSnapshot serialize/parse/守卫、webdav 纯函数、WebdavClient（注入 fetchImpl：成功/401/超时/MKCOL 405/PROPFIND 解析/10 份滚动）、applyConfigSnapshot（FakeRepository：覆盖/创建/保留/事务回滚/skipped 计数）。
- **阶段 2 UI**：backup.tsx 全流程 + profile navRow + Alert 确认流 + Token 化 + 组件测试（表单守卫/掩码/结果披露行/深浅色两态）。
- **阶段 3 真机验收 + closeout**：MuMu + 宿主机临时 node WebDAV 服务器（10.0.2.2，切片 30 先例）；矩阵 §3 全过 + closeout（§7.10 义务）+ backlog 划项 + AGENTS §8 收尾。

## 3. 真机验收矩阵（阶段 3，MuMu）

| # | 场景 | 预期 |
| --- | --- | --- |
| 1 | 保存连接配置 → force-stop 重启 | 配置保持（SecureStore），表单回填 |
| 2 | 测试连接：正确凭据 / 错误密码 | 成功提示 / auth 错误文案（区分 401 与网络错误） |
| 3 | 立即备份（分类改色 + 新建 tag 后） | 成功提示；WebDAV 侧文件落地核对（life-config-*.json 内容=改后状态） |
| 4 | 快照列表 | 倒序排列、时间戳正确、无关文件不出现 |
| 5 | 恢复覆盖回归：改回颜色 → 恢复旧快照 | 分类颜色/标签视觉回归快照值 |
| 6 | 本地独有条目保留：恢复后新建 tag2 再恢复 | tag2 仍存在（增量覆盖不删除） |
| 7 | 未命中 tag 创建：清空某 tag 视觉→恢复 | tag 按快照重建（未命中创建路径） |
| 8 | 滚动删除：连续备份 >10 次 | 列表恒 ≤10，最旧被删，披露无残留 |
| 9 | 断网/不可达 BaseURL 备份 | network 错误文案，不静默 |
| 10 | 深浅色两态过一遍新页 | Token 化无硬编码色、对比度可读 |

## 4. 验收命令

- `npx tsc --noEmit`（0 错）
- `npx jest --runInBand`（基线 **90 套件 / 1241 用例**，只增不减）
- `npx expo-doctor`（2 项预存基线失败无新增）
- Android 真机/模拟器：MuMu（127.0.0.1:7555）+ 宿主机临时 WebDAV（10.0.2.2），验收后关闭临时服务器

## 5. 风险

- WebDAV 服务器 PROPFIND 兼容性（D:/displayname 差异）→ href 为主解析 + 文件名正则过滤 + 测试连接先行（提案 §7）。
- 恢复与用户在途编辑并发（恢复期间改设置）→ 恢复按钮带 busy 态禁用其他保存入口（settingsSavingKey 同款互斥）。
- 标签名归一双口径 → 键归一唯一入口 = Repository 既有 trim + 大小写不敏感逻辑，卡 §1 D2 冻结。

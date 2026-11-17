# 切片 28 变更提案：配置备份 WebDAV（config backup）

> 状态：设计已定案（用户 2026-11-18 五问决策），提案随切片 28 阶段 1 提交。
> 关联：backlog §2 切片 28 行、backlog §3 语义澄清记录（2026-11-16）、slice-20 排期 v1「数据备份 JSON 导出 + WebDAV」顺延条目。

## 1 背景与动机

- 用户 2026-11-16 提出「配置导入导出 JSON + WebDAV 同步」需求（backlog §3 补录）；2026-11-18 进一步定案：**备份分两类——配置备份与数据备份，先完成配置备份**。
- 现状盘点（backlog §3）：
  - 切片 12 已有**单向数据导出**（`src/domain/export.ts` `serializeExportData`，version=1：items + tags 名称数组 + reminders 摘要）——但 tags 只含名称数组、Reminder 剔调度字段，重导入不能还原 id 关联，且从未做过导入。
  - **配置侧从未有导出**：app_settings（10 字段）、分类视觉（预置 5 条 color/emoji/priority）、标签视觉（name/color/emoji）只能在本机界面逐项重设——换机/重装成本高。
  - WebDAV 历史记录（slice-20 排期 v1）语义为「备份 JSON 导出 + WebDAV，变更提案先行 §7.5」——本提案即该闸门的落点。
- 本片解决**配置**的备份与恢复；**数据**（items/reminders/channel_presets）备份与双向同步留后续切片（编号立项时定）。

## 2 范围

**做（本片）**：
1. 配置快照序列化/反序列化（纯域函数 + 类型守卫）。
2. WebDAV 客户端（自写 fetch：PROPFIND / GET / PUT / MKCOL / DELETE，Basic Auth，零新依赖）。
3. WebDAV 连接配置存储（expo-secure-store 独立键）。
4. 手动「立即备份」（全量配置 JSON 上传）+ 快照列表浏览（PROPFIND）+ 保留最近 10 份滚动删除。
5. 快照恢复 = **增量覆盖**本地配置（语义见 §5）。
6. 设置页新增「备份与恢复」推入页（/settings/backup）+ profile 入口 navRow。

**不做（非目标，防蔓延）**：
- 数据备份（items/reminders/channel_presets）——后续切片。
- 持续双向同步（变更合流/冲突处理）——从未立项，如立项另走设计讨论 + 提案。
- 自动/定时/回前台备份——仅手动（用户 2026-11-18 定案 Q3）。
- 备份包加密——全量明文（用户定案 Q5；与切片 12 本地导出先例一致）。
- 多 WebDAV 服务器配置——单配置。
- channel_presets 同步——属数据备份范畴（用户 2026-11-16 范围澄清：channel_presets 与 items/reminders 同为「日程相关数据」）。
- AI Provider 配置（expo-secure-store `ai_provider_config_v1`）同步——Key 属敏感凭据且按槽独立，不进配置快照。

## 3 设计决策（用户定案记录，2026-11-18）

| # | 决策 | 用户定案 |
| --- | --- | --- |
| D1 | 形态 | 备份分两类（配置/数据），**先配置备份**；本片仅配置快照上传 + 列表浏览 + 增量覆盖恢复 |
| D2 | 恢复语义 | **增量覆盖**：快照有的条目覆盖本地同键条目；快照没有的本地条目保留（不删） |
| D3 | 触发时机 | 仅手动（设置页按钮） |
| D4 | 快照策略 | 按日期多快照（文件名含时间戳），保留最近 10 份 |
| D5 | 敏感信息 | 全量明文上传（用户自建 WebDAV，安全由服务器侧保障） |
| D6 | 配置存储 | WebDAV 连接配置（URL/用户名/密码）存 expo-secure-store 独立键，**不入 app_settings、不入快照**（见 §4.1 自引用防护） |
| D7 | 协议实现 | 自写 fetch 客户端（PROPFIND/GET/PUT/MKCOL/DELETE），零新依赖 |
| D8 | scope | **schema 停留 v15 零迁移**；快照格式独立 version=1，与 schema 版本解耦 |

## 4 快照格式与 WebDAV 交互

### 4.1 快照 JSON（version=1，kind='config'）

```jsonc
{
  "version": 1,
  "kind": "config",
  "exportedAt": "2026-11-18T09:30:00.000+08:00",  // ISO 8601 含时区偏移
  "appSettings": { /* AppSettings 全字段（settings.ts 接口），serialize 时逐字段经既有 validate 校验 */ },
  "categories": [ { "id": "work", "name": "工作", "color": "#…", "emoji": "💼", "priority": 10 }, … ],
  "tags": [ { "name": "健康", "color": "#…", "emoji": "🏥" }, … ]
}
```

- `version` / `kind` 恒定值：`isConfigSnapshotWire` 守卫整包拒绝（version≠1 或 kind≠'config' 或缺三大块）。
- **条目级宽容**：categories/tags 单条形状不符 → 跳过该条并在恢复结果披露跳过计数（isRemoteDraftWire「advisory 不炸整体」精神，但主结构仍整包拒绝）。
- appSettings 块缺失 → 整包拒绝；恢复时逐字段走读层防御归一（parseChipsIncrements 等先例），坏值回退默认——与正常读路径同一纪律。

### 4.2 WebDAV 交互（自写客户端）

- **目录布局**：`<用户配置的 basePath>`（如 `/life-backup/`）下平铺快照文件 `life-config-YYYYMMDD-HHmmss.json`。
- **方法集**：
  - `MKCOL <basePath>`：目录不存在时创建（405 = 已存在，容忍）。
  - `PUT <basePath>/<file>`：上传快照（Content-Type: application/json）。
  - `PROPFIND <basePath>`（Depth: 1）：列快照文件（解析 `<D:response>` 的 href + getlastmodified/displayname），按文件名时间戳倒序。
  - `GET <basePath>/<file>`：下载快照。
  - `DELETE <basePath>/<file>`：保留 10 份滚动删除（上传成功后 PROPFIND → 按名倒序保留前 10，其余逐个 DELETE；DELETE 失败不阻塞备份成功，结果提示披露）。
- **认证**：Basic Auth（username/password over HTTPS 建议前缀校验——http 允许但 UI 提示）。
- **超时**：每请求 15s（AbortController，openAiCompatible 先例）。
- **错误分类**：`WebdavError kind ∈ {network, http-status, auth(401/403), invalid-response, timeout}`——UI 按 kind 出对应文案（ai KIND_LABELS 先例）。

### 4.3 连接配置存储（D6 自引用防护）

- 存 `expo-secure-store` 键 `webdav_backup_config_v1`：`{ baseUrl, basePath, username, password }`（`isWebdavConfig` 守卫，损坏返回 null 不抛错——`SecureAiConfigStore` 同构）。
- **为什么不入 app_settings**：app_settings 是被同步的数据本身——快照恢复会全列覆盖 app_settings，若 WebDAV 配置也在其中，「恢复旧快照」会把连接配置回滚成旧值（换服务器场景直接断连）；密码入 DB 亦违反凭据纪律。SecureStore 独立键彻底解耦。
- domain 层不做 IO：类型与守卫（`isWebdavConfig`）在 `src/domain/webdav/`，存取实现在 `src/data/SecureWebdavConfigStore.ts`（`SecureAiConfigStore` 先例：data 层唯一 touch expo-secure-store）。

## 5 恢复语义（D2 增量覆盖，冻结）

恢复 = 把快照条目**逐键覆盖**到本地，本地独有的条目一律保留：

| 块 | 键 | 覆盖规则 |
| --- | --- | --- |
| appSettings | 单行 12 列 | 全列覆盖（updateSettings 既有校验路径）；快照缺列（旧格式兼容）→ 该列保留本地值 |
| categories | id（预置 5 条 work/personal/study/health/other） | 快照条目命中本地同 id → 覆盖 color/emoji/priority；本地不存在该 id（未来自定义分类）→ 保留本地不建 |
| tags | name（trim + 大小写不敏感，Repository 既有归一） | 命中 → 覆盖 color/emoji；未命中 → **创建**该 tag（findOrCreate 语义上收）；本地独有 tag → 保留 |

- **原子性**：恢复在单个 writer 事务内完成（categories + tags + app_settings 同批），中途失败整体回滚。
- **实现落点**：`ItemRepository` 新增契约外显式扩展方法对：
  - `createConfigSnapshot(): Promise<ConfigSnapshot>`（读 getSettings/getCategories/listTags 组包——只读）；
  - `applyConfigSnapshot(snapshot: ConfigSnapshot): Promise<ApplyResult>`（写，事务内；`ApplyResult` 含 applied/skipped 计数供结果披露）。
  先例：`filterExistingItemIds`（切片 30，注释明记「契约外显式只读扩展」）、`deleteItem`、`getCalendars` color 扩展。
- **结果披露**：恢复完成后 UI 展示「已应用 N 项，跳过 M 项（形状不符）」，M>0 时提示明细口径。
- **不做恢复前本地快照兜底**（backlog §3 原方案项）：增量覆盖不删除本地数据、误恢复可再次恢复正确快照或手动改回，破坏面可控；如后续数据备份切片需要兜底再引入。

## 6 契约影响

- `repository.md`：追加非破坏性注记节（v0.22）：记录 `createConfigSnapshot` / `applyConfigSnapshot` 两个契约外显式扩展方法与增量覆盖语义；**不改动任何冻结签名**（4.5/4.7/4.16/4.18/4.24 全部零 diff）。
- `data-model.md` / `recurrence.md` / `notifications.md` / `ai.md` / `ui.md`：零改动（schema 不动、新页面非四视图、AI 面不涉）。
- `AGENTS.md` v0.34 新增 §7.42 条款随切片 28 阶段 1 提交。

## 7 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| WebDAV 服务器兼容性（PROPFIND 响应格式差异：`D:` 命名空间/`displayname` 缺失） | 解析以 href 为主、displayname 兜底；文件名正则 `^life-config-\d{8}-\d{6}\.json$` 过滤，无关文件不进列表；「测试连接」先行暴露兼容性问题 |
| 明文上传含 webhook 之外的敏感度（tags/分类无敏感字段；appSettings 无凭据） | 已审：配置快照不含 API Key（SecureStore）、不含 channel_presets（URL/token）、不含日程内容——敏感面仅限用户自选可见的视觉与开关 |
| 恢复覆盖 tags 时 name 冲突大小写变体（「健康」vs「健康 」） | 键归一复用 Repository 既有 trim + 大小写不敏感逻辑（tags.name 唯一性由 Repository 保证的既有纪律），不新增第二套归一 |
| 保留 10 份滚动删除误删 | DELETE 仅作用于匹配 `life-config-*.json` 正则的文件；删除失败仅披露不重试（下次备份再滚动） |
| MuMu 验收无真实 WebDAV | 沿切片 30 先例：宿主机临时 node WebDAV 服务器（guest 经 10.0.2.2 访问），验收后关闭 |

## 8 验收口径（详见任务卡 §3）

- `npx tsc --noEmit` 0 错；`npx jest --runInBand` 基线 **90 套件/1241 用例**只增不减；`npx expo-doctor` 2 项预存基线无新增。
- 真机矩阵（MuMu + 宿主机临时 WebDAV）：连接配置保存/重启保持、测试连接成功与 401、备份成功（文件落地核对）、快照列表排序、恢复覆盖回归（改色→备份→改回→恢复→快照值回归）、本地独有 tag 保留、10 份滚动删除、断网降级提示、深浅色。
- 冻结区零 diff（src/notifications/、src/domain/recurrence/）；AiParser.parse 签名不动；无新依赖；schema 停留 v15。

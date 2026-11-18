# 提案：切片 31 数据备份 WebDAV（切片 28 拆分余部）

日期：2026-11-18 ｜ 状态：待用户确认（本文档为切片 31 立项前置，随切片 31 阶段 1 提交）

## 1. 背景

- 切片 28（配置备份 WebDAV）已交付：WebDAV 连接与配置快照的备份/恢复全链路（`src/data/webdav/WebdavClient.ts`、`src/app/settings/backup.tsx`、`createConfigSnapshot`/`applyConfigSnapshot`）。立项时用户定案把备份拆两类：配置先行，数据（items/reminders/channel_presets）留后续——即本片。
- 数据是「任务不丢失」诉求的本体：目前数据侧只有切片 12 的单向「导出 JSON」（`src/domain/export.ts` version=1，tags 仅名称数组、Reminder 剔调度字段、无导入链路、重导入不能还原 id 关联），换机/清机即丢。
- 本片复用切片 28 基础设施：WebDAV 客户端（PROPFIND/GET/PUT/MKCOL/DELETE、Basic Auth、15s 超时、滚动保留 10 份）、`backup.tsx` 页面骨架、`applyConfigSnapshot` 的「单次 db.batch 原子」恢复事务模式。

## 2. 范围与不做

**做**：数据快照（items + tags + reminders + channel_presets + item_tags 关联）手动备份到 WebDAV、快照列表浏览、按快照恢复（增量覆盖语义）。

**不做**：
- 双向同步 / 自动或定时备份 / 回前台自动备份（维持「仅手动」定案，另立候选）；
- 包加密、多服务器配置（沿用切片 28 定案：全量明文）；
- 恢复前条目级 diff 预览（沿用切片 28 口径：Alert 文案级确认，误恢复可再恢复或手动改回）；
- 切片 12「导出 JSON」按钮与 version=1 格式保留不动（用户 2026-11-18 定案）；旧导出文件（无 kind 字段）不进恢复链路；
- `src/domain/export.ts`、`src/notifications/`、`src/domain/recurrence/` 冻结区实现文件零改动；
- AI Provider 配置（SecureStore）不进快照（与切片 28 口径一致）。

## 3. 用户定案（2026-11-18 六问）

| 问题 | 定案 |
| --- | --- |
| 立项候选 | 数据备份/恢复（切片 28 拆分余部） |
| 形态 | 仅手动备份 + 恢复（双向同步仍留候选不并入） |
| channel_presets | **进数据快照**（数据完整性优先；config_json 含 webhook URL 等随快照明文上云，用户知情接受） |
| 恢复语义 | 与配置快照同构：按 id 命中覆盖、未命中创建、本地独有保留；单事务原子 |
| 文件布局 | 独立 `life-data-YYYYMMDD-HHmmss.json`，与配置快照同目录互不干扰，各自保留最近 10 份 |
| 旧导出 | 保留不动，数据备份独立成体系（文件/守卫/恢复路径全新） |

## 4. 快照格式与恢复语义

### 4.1 格式（`{version:1, kind:'data', …}` 六块）

```ts
interface DataSnapshot {
  version: 1;
  kind: 'data';
  exportedAt: string;           // formatExportedAt 同构
  items: DataSnapshotItem[];    // id/type/title/content/status/startAt/endAt/allDay/
                                // sourceType/sourceUid/sourceReadOnly/categoryId/priority/
                                // createdAt/updatedAt（全字段，id 保真）
  tags: DataSnapshotTag[];      // id/name/color/emoji（id 保真；name 为业务键）
  reminders: DataSnapshotReminder[]; // id/itemId/frequency/localTimeHour/localTimeMinute/
                                // weekdaysJson/dayOfMonth/tzid/startAt/enabled/
                                // onceCivilJson/channelsJson/channelConfigsJson
                                // ——不含调度态（last_fired_occurrence_key/last_reconciled_at）
                                //   与 deprecated channel/channel_config 两列
  channelPresets: DataSnapshotChannelPreset[]; // id/name/type/configJson/isDefault
  itemTags: { itemId: string; tagId: string }[]; // join 表重建依据
}
```

- 整包守卫 `isDataSnapshotWire`：version/kind/六块任一不符整包拒绝；条目级形状不符计入 skipped（配置快照同纪律）。
- 与切片 12 `ExportedItem` 的差异：+categoryId、+priority、tags 完整化（独立 tags 表 + itemTags join，不再内嵌名称数组）、reminders 全字段（不再摘要）。

### 4.2 恢复语义（冻结；单 `db.write` + 单次 `db.batch`，沿用切片 28 两遍法与收集模式）

- **items**：按 id 命中覆盖（title/content/type/status/startAt/endAt/allDay/sourceType/sourceUid/sourceReadOnly/categoryId/priority 全字段写穿；createdAt 不动、updatedAt 由 prepareUpdate 自动刷新）；未命中创建（`_raw.id` 保真——先例 `WatermelonItemRepository.ts:1108` app_settings 行 `_raw.id='global'`；created_at/updated_at 按快照值经 `_raw` 写入保真）；本地独有条目保留。categoryId 悬挂防护：指向本地不存在分类（非预置 5 条）→ 该条 skipped。
- **tags**：按 name 归一键命中（trim + 大小写不敏感，与配置快照 `normalizeTagName` 同构；快照内重复名 first-wins）覆盖 color/emoji；未命中创建（创建行 `_raw.id` 用快照 id 保真，供 join 直连）；本地独有保留。恢复事务内建立 tagId 解析映射（命中→本地行 id；新建→快照 id）供 itemTags 使用。
- **reminders**：按 id 命中覆盖（enabled/frequency/localTimeHour/localTimeMinute/weekdaysJson/dayOfMonth/tzid/startAt/onceCivilJson/channelsJson/channelConfigsJson 写穿；item_id 不改；调度态两列不动——覆盖不写 null 防丢本地调度状态）；未命中创建（`_raw.id` 保真 + item_id；item_id 解析不到对应 item → 该条 skipped；新建行显式写 `channel='system-notification'`、`channel_config=null` 兜底（与 v8 迁移回填一致，避免 legacy bridge 空串路径））。
- **channel_presets**：按 id 命中覆盖（name/type/configJson/isDefault）未命中创建（id 保真）、本地独有保留；恢复事务内保证「同 type 至多一个 isDefault=true」（slice-18 §3.3 约束）：快照同 type 多 default 时按快照序保留最后一个，其余置 false。
- **item_tags**：对每个快照 item（命中或新建）其 join 集合 = 快照声明：删除该 item 现有全部 join + 按快照重建（join 表无其他消费方，重建幂等）；tagId 解析失败的 join 计 skipped。
- **计数口径**：applied = 实际写入的各块条目数；skipped = 形状不符/悬挂引用条目数；恢复结果结构沿用 `ConfigSnapshotApplyResult{applied, skipped}` 形状（新类型 `DataSnapshotApplyResult`）。
- **调度联动**：恢复事务成功后显式调用一次 `reminderScheduler.reconcile()`（失败不阻断、仅披露——`useFlashChat.ts:420` 保存先例；`src/app/_layout.tsx:50-79` 启动/回前台 reconcile 兜底）。不触碰 `src/notifications/` 实现。

### 4.3 组包（`createDataSnapshot`）

复用切片 12 导出组包读取（`profile.tsx:470-477`）：`listItemsWithTags()` ∪ `listArchivedItemsWithTags()`（全库含 archived/done——备份语义完整性）+ `listAllReminders()` + `listTags()` + `listChannelPresets()` + item_tags join 全量查询（Repository 内部直查，不经领域层）。tags 内嵌名称数组不使用（关联由 itemTags 块承载）。

## 5. WebDAV 交互

- 文件名 `life-data-YYYYMMDD-HHmmss.json`（`DATA_SNAPSHOT_FILE_PATTERN = /^life-data-\d{8}-\d{6}\.json$/`、`dataSnapshotFileName(date)`——`configSnapshot.ts:132-161` 同构，落 `src/domain/dataSnapshot.ts`）。
- `WebdavClient.listSnapshots` / `uploadSnapshot` 文件名过滤参数化（方法级可选参数，缺省维持 `CONFIG_SNAPSHOT_FILE_PATTERN` 向后兼容）；滚动保留 10 份按 pattern 独立计数——配置与数据快照互不挤占。
- 上传/下载/删除/Basic Auth/15s AbortController/WebdavError 五类错误、MKCOL 405 容忍、PROPFIND href 为主解析——全部复用切片 28 实现，零改动语义。

## 6. 契约影响

- `docs/contracts/repository.md`：追加非破坏性注记节（v0.35）：`createDataSnapshot`/`applyDataSnapshot` 契约外显式扩展成对（`filterExistingItemIds`、`createConfigSnapshot` 先例），冻结签名零 diff。
- 其余契约零改动；`notifications.md` 不触碰（只调用 `reconcile()` 既有公开签名）。

## 7. 风险

| 风险 | 缓解 |
| --- | --- |
| 全量数据快照体积大（items 多时） | 15s 超时兜底抛 WebdavError timeout 披露；JSON.stringify 无缩进（快照非人读优先体积） |
| 快照 id 与本地 id 碰撞 | uuid 空间碰撞概率可忽略；命中即覆盖语义本身消化碰撞 |
| 恢复中途失败 | 单次 `db.batch` = 适配器级原子，整体不落库（切片 28 已验证） |
| legacy bridge 旧行（channels_json=null） | 快照只存 v10 语义列；恢复创建行统一 v10 语义 + channel 兜底；旧行不迁移、不触碰 |
| isDefault 约束破坏 | 恢复事务内规范化（§4.2） |
| PROPFIND 兼容 / basePath | 复用切片 28 口径（href 为主、测试连接先行）；遗留披露「测试连接只验 2xx 不校验 basePath」顺延 |

## 8. 验收口径

- `npx tsc --noEmit` 0 错；`npx jest --runInBand` 基线 **95 套件/1314 用例** 只增不减；`npx expo-doctor` 2 项预存基线无新增。
- 真机矩阵见任务卡 §3；WebDAV 测试沿用宿主机临时 node 服务器（切片 28 先例：0.0.0.0:5280 + Basic Auth）。
- schema 停留 v15 零迁移；无新依赖；无 `any`。

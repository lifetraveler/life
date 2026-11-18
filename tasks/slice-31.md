# 切片 31：数据备份 WebDAV（items/tags/reminders/channel_presets 备份与恢复）

- 提案：docs/proposals/slice-31-data-backup-webdav.md（用户 2026-11-18 六问定案）
- 基点：main @ 5edeeec（切片 28 合并 + docs 回填 + backlog 立项登记后）
- 分支：task/slice-31（从 main @ 5edeeec 切出）；提案/任务卡与 AGENTS.md v0.35 随阶段 1 提交
- 验收基线：tsc 0 错；jest **95 套件/1314 用例**（slice-28-closeout）只增不减；expo-doctor 2 项预存失败无新增；schema 停留 v15 零迁移
- **状态（2026-11-18 收尾）**：✅ 完成——阶段 1 `659a9bb` / 阶段 2 `0ac3e10`；验收终态 tsc 0 错 / jest 98 套件·1365 用例 / expo-doctor 2 项预存 / 真机矩阵 9 项过 + 损坏负例；**4 项真机 pending**（#4 全量还原、#10 断网/401 文案、#11 导出回归、chips 改回 [10,60]）经用户批准移入 backlog「切片 31 真机验收补做」（猴王 adb 死锁事故，见 `tasks/slice-31-closeout.md` §四）。

## §0 明确不做（禁改清单）

- 不做双向同步、自动/定时/回前台备份、包加密、多服务器配置、恢复前条目级 diff 预览；
- 切片 12 单向「导出 JSON」按钮与 `src/domain/export.ts` 保留不动（version=1 无 kind 文件不进恢复链路）；
- 冻结区 `src/notifications/`、`src/domain/recurrence/` 实现文件为空（恢复后调度联动只调用 `reminderScheduler.reconcile()` 既有公开签名，不改实现）；
- 不改 `AiParser.parse` 冻结签名；ChatMessage kind 不新增；
- 不引入新依赖；不做 schema 迁移（schema v15 停留）；
- AI Provider 配置（SecureStore `ai_provider_config_v1`）不进快照；WebDAV 连接配置仍走 `webdav_backup_config_v1` 独立键不动；
- 工作区 `.tmp-s25/ .tmp-s26/ .tmp-s28/ life-0.23.0-v10*.apk` 为验收残留，永不提交。

## §1 设计决策（提案 §3/§4 定案落点）

- **D1 格式**：`{version:1, kind:'data', exportedAt, items, tags, reminders, channelPresets, itemTags}` 六块；条目级宽容 skipped、整包守卫拒绝；不含调度态两列与 deprecated channel 两列。
- **D2 id 保真**：新建行 `_raw.id` 写快照 id（先例 `WatermelonItemRepository.ts:1108` app_settings `_raw.id='global'`）；created_at/updated_at 新建行经 `_raw` 保真写入、覆盖行 createdAt 不动。
- **D3 恢复语义（冻结）**：items 按 id 命中覆盖/未命中创建/本地独有保留（categoryId 悬挂→skipped）；tags 按 name 归一命中（normalizeTagName 同构）/未命中创建（带快照 id）/事务内 tagId 映射；reminders 按 id 命中覆盖（调度态两列不动）/未命中创建（item_id 解析失败→skipped；channel='system-notification' 兜底）；channelPresets 按 id 命中覆盖/未命中创建/事务内同 type 单 default 规范化；itemTags 对快照 item 删除重建 join（tagId 解析失败→skipped）。
- **D4 事务**：单 `db.write` + prepareUpdate/prepareCreate 同步收集 + 单次 `db.batch`（切片 28 两遍法照抄；tags 块防 prepareUpdate-on-pending 崩溃）。
- **D5 调度联动**：恢复成功后 `reminderScheduler.reconcile()` 一次（失败不阻断仅披露；`useFlashChat.ts:420` 先例）；不触碰冻结区。
- **D6 WebDAV 参数化**：`listSnapshots`/`uploadSnapshot` 文件名过滤方法级可选参数（缺省 CONFIG pattern 向后兼容）；数据快照独立保留 10 份滚动；`DATA_SNAPSHOT_FILE_PATTERN`/`dataSnapshotFileName` 落 `src/domain/dataSnapshot.ts`。

## §2 阶段

### 阶段 1：域 + 数据层

- `src/domain/dataSnapshot.ts`（新）：类型 + `isDataSnapshotWire` + 条目守卫 + 序列化/反序列化 + `DATA_SNAPSHOT_FILE_PATTERN`/`isDataSnapshotFileName`/`dataSnapshotFileName`；
- `ItemRepository.ts` 端口：`createDataSnapshot(): Promise<DataSnapshot>` / `applyDataSnapshot(snapshot): Promise<DataSnapshotApplyResult>`；
- `WatermelonItemRepository.ts` 实现：组包（listItemsWithTags ∪ listArchivedItemsWithTags + listAllReminders + listTags + listChannelPresets + item_tags 直查）+ 恢复事务（§1 D2–D4）；
- `src/data/webdav/WebdavClient.ts`：listSnapshots/uploadSnapshot 文件名过滤参数化（D6）；
- `docs/contracts/repository.md`：追加非破坏性注记节（v0.35）；
- AGENTS.md v0.35（§7.43 + §8 刷新）随本阶段提交；提案/本卡随本阶段提交；
- 单测：守卫正负例、序列化往返、恢复语义矩阵（命中覆盖/未命中创建/本地独有保留/悬挂 skip/join 重建/isDefault 规范化/调度态不动/channel 兜底）、WebdavClient pattern 参数化、裁剪互不挤占。

### 阶段 2：UI

- `src/app/settings/backup.tsx`：新增「数据备份」区块（立即备份按钮 + 数据快照列表 + 恢复/删除；连接区块共用不动）；恢复前 Alert 覆盖警示；恢复完成展示 applied/skipped 披露 + reconcile 触发；Token 化深浅色；
- profile navRow 文案核对（「备份与恢复」语义已覆盖数据备份，如需微调一并）；
- 组件/交互单测（区块渲染、busy 态互斥——沿用 settingsSavingKey 同款）。

### 阶段 3：真机验收 + 收尾

- MuMu/真机矩阵（§3）+ 损坏快照负例；宿主机临时 node WebDAV 服务器先例（0.0.0.0:5280 + Basic Auth life/life-pass）；
- `tasks/slice-31-closeout.md` + backlog 划项 + AGENTS §8 刷新（§7.9 收尾序列）。
- ⚠️ 切片 28 遗留：验收设备 chips 曾改 [30,90,120,240]，本片开工先改回 [10,60]（slice-28-closeout 遗留披露）。

## §3 真机验收矩阵

1. 配置备份回归：配置快照备份/列表/恢复不受参数化改动影响；
2. 数据备份落地：服务器出现 `life-data-*.json`，六块内容完整（items/tags/reminders/channelPresets/itemTags）；
3. 数据快照列表与配置快照列表分组互不干扰，各自保留 10 份滚动；
4. 全量还原：备份 → 清空数据 → 恢复 → 条目/提醒/标签/预设/关联齐全（itemTags join 正确）；
5. 增量覆盖：本地同 id 条目本地改动 → 恢复后 = 快照值；
6. 本地独有条目保留；本地独有 tag/预设保留；
7. name 归一命中：快照 tag「Work」与本地「work」命中不重复建；
8. isDefault 规范化：快照同 type 双 default → 恢复后单 default；
9. 恢复后通知重排：reconcile 生效（新增提醒排上、快照中删除的提醒通知消失）；
10. 断网/401 文案区分（WebdavError 五类）+ 深浅色 Token；
11. 切片 12「导出 JSON」按钮回归不受影响。

## §4 验证命令

`npx tsc --noEmit`；`npx jest --runInBand`（基线 95/1314 只增不减）；`npx expo-doctor`（2 项预存）；真机按 §3。

## §5 风险与注记

- 大快照上传 15s 超时 → WebdavError timeout 披露（不静默）；序列化不缩进控体积；
- 恢复原子性依赖单次 db.batch（切片 28 已验证）；batch 失败披露后可重试；
- legacy bridge 旧行（channels_json=null）不被触碰，恢复创建行统一 v10 语义；
- PROPFIND 兼容/basePath 校验沿用切片 28 口径与遗留披露（测试连接只验 2xx）。

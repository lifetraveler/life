# 切片 35：双向同步 WebDAV（快照交换式）

- 基点：main @ `4286f6d`（切片 34 合并 + backlog 立项登记后）
- 分支：`task/slice-35`（从 main @ `4286f6d` 切出）
- 提案：`docs/proposals/slice-35-two-way-sync-webdav.md`（用户 2026-11-22 三问定案：行级 LWW+墓碑 / 集合级 union / 仅手动）
- 契约加载：repository.md（注记节 + 冻结签名核对）必读；data-model.md 不涉冻结面（新表注记说明）；ai.md/ui.md/notifications.md/recurrence.md/build-and-deps.md 不涉及。

## 0. 明确不做（冻结清单）

- 不做回前台/定时/自动同步、同步状态常驻显示（无轮询无监听）；不做手动冲突选择 UI。
- 不做 WatermelonDB 内置 synchronize 协议（服务端权威模型不符，提案 §3 评估否决）。
- 无时间戳表（tags/categories/channel_presets/item_tags/app_settings）不做命中行覆盖、不做 tags/categories 删除传播（union 语义设计选择，提案 §5 披露）。
- 不改 AiParser.parse 冻结签名；wire 12 必填键清单与 kind 纪律零改动（AI 域零涉及）。
- 冻结区 src/notifications/、src/domain/recurrence/、src/domain/export.ts 实现文件为空（测试夹具 stub 除外）。
- 切片 28 配置备份/31 数据备份功能与快照文件保留不动（kind 互不相认）；无新依赖；schema v15/v16 既有 step 不动。

## 1. 设计决策（D1–D6，详见提案 §4）

- **D1 快照交换式**：固定名 `life-sync-<deviceId>.json` 覆盖写（非滚动）；同步=上传→列对端（排除自己）→逐个下载合流→本地落库→上传合并结果；≥2 台设备顺序合流幂等（updated_at 全局比较）。
- **D2 行级 LWW+墓碑**：items/reminders 按 updated_at 晚者赢（prepareUpdate 自动维护零侵入）；新表 sync_tombstones（schema v17：kind/entity_id isIndexed/deleted_at）；deleteItem/deleteReminder/deleteChannelPreset 三处同事务记墓碑；墓碑随快照携带传播；同步成功后按对端 exportedAt 最小值裁剪。
- **D3 无时间戳表 union**：tags 按 name / categories、presets 按 id——命中保留本地、未命中创建（_raw.id 保真）；item_tags 并集重建（悬挂 skipped）；app_settings 整行按 exportedAt LWW（缺列保留，normalizeSnapshotAppSettings 同构）；已知限制：命中行不覆盖（提案 §5 明文）。
- **D4 同步快照 wire**：kind:'sync' + deviceId + tombstones；条目守卫复用 dataSnapshot.ts 条目级 isDataSnapshot*Entry；顶层 isSyncSnapshotWire 整包拒绝+条目级 skipped；SYNC_SNAPSHOT_FILE_PATTERN 36 位 uuid 小写；与 config/data 互不相认；落点 src/domain/syncSnapshot.ts。
- **D5 合流纯函数+落库**：src/domain/syncMerge.ts mergeSyncSnapshots(local, remoteSnapshots[], localTombstones)→SyncMergeResult（含 counts）；Repository createSyncSnapshot/applySyncMerge 契约外扩展成对（单 writer 事务+两遍法+_raw.id 保真+db.batch）；reminders 孤儿（基线 item 被墓碑删）→skipped；本地新增墓碑合入（防回流复活）；reconcile 显式一次失败不阻断；deviceId=域内 uuid v4 纯函数+SecureStore 键 sync_device_id_v1。
- **D6 UI**：backup.tsx 新增「同步」区块（固定说明+立即同步+计数披露）；连接复用 webdav_backup_config_v1；busy 态与备份/恢复互斥（settingsSavingKey 同款）。

## 2. 阶段划分

- **阶段 1（域+数据层+契约文档）**：src/domain/syncSnapshot.ts（wire+守卫+serialize/parse+SYNC_SNAPSHOT_FILE_PATTERN）+ src/domain/syncMerge.ts 合流纯函数 + src/domain/syncDevice.ts（uuid v4 纯函数）+ SecureStore deviceId 存取 + schema v17 sync_tombstones（SCHEMA_VERSION 16→17 + migrations createTable + SyncTombstoneModel）+ WatermelonItemRepository：三删除方法同事务墓碑记录 + createSyncSnapshot/applySyncMerge + repository.md 注记节 + AGENTS v0.39（§7.47+§8 随阶段 1 提交）+ 提案/卡随阶段 1 提交 + 单测矩阵（合流 LWW 双向/墓碑删传播/union 复活/孤儿 skip/多设备顺序幂等/墓碑裁剪/wire 守卫整包拒绝+条目宽容/uuid 形状）。
- **阶段 2（UI+验收）**：backup.tsx 同步区块（D6）+ busy 互斥 + 计数披露 + 真机矩阵 9 条（提案 §7）+ closeout（含 backlog 划项：本候选行关闭）+ AGENTS §8 刷新。

## 3. 真机验收矩阵（9 条）

1. 两端互同步新建条目收敛（A 建→B 同步可见；B 建→A 同步可见）。
2. 同条目双端改：updated_at 晚者赢，计数披露 conflictsResolved。
3. 一端删条目→另一端同步后消失（墓碑传播）；反向再同步不复活（本地墓碑合入）。
4. 标签/分类 union：新建传播、既有行保留本地（颜色改动不传播=已知限制实证）。
5. channel_presets 增删传播 + 事务内同 type 单 default 规范化。
6. app_settings exportedAt LWW（对端新→覆盖；本地新→保留）。
7. 孤儿 reminder（基线 item 被墓碑删）→ skipped 计数披露，不炸整体。
8. 断网/401 文案区分（WebdavError kind 先例）。
9. 同步后再执行配置/数据备份回归：kind:'data'/'config' 流程与文件不受影响。

## 4. 验收命令与基线

- `npx tsc --noEmit`：0 错。
- `npx jest --runInBand`：基线 **98 套件/1455 用例** 只增不减（合流单测矩阵全绿）。
- `npx expo-doctor`：2 项预存基线失败无新增。
- Android 真机（MuMu 127.0.0.1:7555 + 宿主机 node WebDAV 服务器 10.0.2.2，切片 28/31 先例）：矩阵 9 条全过 + closeout。

## 5. 风险（详见提案 §5）

- 合流顺序幂等性（单测锁定）；墓碑丢失复活（三方法同事务+快照恒携带）；墓碑增长（对端 exportedAt 裁剪+5000 上限披露）；固定名快照与备份滚动 DELETE 互不波及（FILE_PATTERN 隔离）；LWW 时钟回拨敏感（披露为已知限制）；大快照 15s 超时（披露可重试）。
- 落库 busy 态互斥与失败披露沿用切片 31 模式；MuMu 双实例 deviceId 隔离验收时注意 SecureStore 键随应用数据隔离（pm clear 重置）。

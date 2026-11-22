# 提案：切片 35 双向同步 WebDAV（快照交换式）

> 状态：设计三问已由用户 2026-11-22 定案（冲突策略 / 无时间戳表合流 / 触发时机），提案据定案成文。
> 任务卡：tasks/slice-35.md；分支 task/slice-35；契约影响见 §6。

## 1. 背景与目标

- 用户 2026-11-16 提出「配置导入导出 JSON + WebDAV 双向同步」，拆分推进：配置备份（切片 28，✅）→ 数据备份/恢复（切片 31，✅）→ **双向同步（本片，主线收官）**。
- 双向同步从未立项（backlog §3 澄清；slice-8/9 的「不实现双向同步」是 ICS/系统日历语境，与此无关）。目标：两台（或更多）设备经同一 WebDAV 目录交换快照，点按一次同步后，日程数据（items/reminders/channel_presets）与配置（app_settings/categories/tags）在设备间合流一致。
- AGENTS §1「本地优先、不接后端」边界不变：同步是用户手动触发的点对点快照交换，无服务器、无自动后台。

## 2. 用户定案（2026-11-22 三问）

| # | 问题 | 定案 |
| --- | --- | --- |
| Q1 | 行级冲突（items/reminders 有 updated_at） | **行级 LWW + 墓碑**：updated_at 晚者赢；删除经墓碑集合随快照传播 |
| Q2 | 无时间戳表（tags/categories/channel_presets/item_tags/app_settings） | **集合级 union 合流**：按 id/name 命中保留本地、未命中创建；app_settings 整行按快照 exportedAt LWW；零迁移 |
| Q3 | 触发时机 | **仅手动**：备份页「同步」区块点按执行一次 |

## 3. 不做清单（本片明确不做）

- 不做回前台/定时/自动同步；不做同步状态常驻显示（无轮询、无监听）。
- 不做手动冲突选择 UI（LWW 无感合流，计数披露替代）。
- 不做 WatermelonDB 内置 synchronize 协议（0.28 内置 sync 为「服务端权威」设计，与两台对等设备模型不符——评估后否决，自写合流）。
- 不做无时间戳表命中行覆盖（设备 B 改既有标签/分类/预设的视觉字段传不到设备 A 的命中行——union 语义首版限制，见 §5 已知限制）。
- 不做 tags/categories 的删除传播（union 语义下未命中即创建，标签/分类是共享词汇表，「复活」无害且常有用——设计选择，非缺陷）；items/reminders/channel_presets 走墓碑传播。
- 不改 AiParser.parse 冻结签名（AI 域零改动）；不触碰 src/notifications/ 与 src/domain/recurrence/ 与 src/domain/export.ts（三目录实现文件为空，测试夹具 stub 除外）。
- 不做包加密、多服务器、同步日志页；切片 28/31 的配置/数据备份功能保留不动（快照文件互不相认）。
- schema v15/v16 既有 step 不动；无新依赖（deviceId uuid v4 域内自写纯函数）。

## 4. 设计决策

### D1 快照交换式同步形态（冻结）

每设备上传**固定名**快照 `life-sync-<deviceId>.json`（覆盖写，非滚动保留——与备份的时间戳滚动文件语义不同）；同步一次 = ①上传本地快照 → ②PROPFIND 列出全部 life-sync-*.json 排除自己的 deviceId → ③逐个下载 → ④逐个合流（纯函数，顺序无关幂等）→ ⑤本地落库（单 writer 事务）→ ⑥上传合并后的本地快照（含新增墓碑）。支持 ≥2 台设备（逐个对方快照合流，多设备下最后合流者对 LWW 语义无影响——updated_at 全局比较）。

### D2 行级 LWW + 墓碑（冻结）

- items/reminders 行级冲突按 `updated_at` 晚者赢（WatermelonDB prepareUpdate 内部自动刷新 updated_at、列 readonly——写路径零侵入，WatermelonItemRepository.ts:798 注释先例）；新建行保真走 prepareCreateFromDirtyRaw（切片 31 :1385/:1407 先例）。
- **删除传播 = 墓碑集合**：新表 `sync_tombstones`（schema v17）：kind（'item'|'reminder'|'channel_preset'）/ entity_id（isIndexed）/ deleted_at。deleteItem（:1868）/ deleteReminder（:2467）/ deleteChannelPreset（:2834）三处**同事务**追加墓碑记录（侵入面收敛在三个既有删除方法）。合流规则：对方墓碑命中本地行 → 本地删；本地墓碑命中对方快照行 → 对方删（该行不创建不更新）；双方墓碑 → 幂等无害。
- 墓碑裁剪：同步成功收尾后删除 deleted_at 早于「全部对端快照 exportedAt 最小值」的墓碑（该删除已被所有对端知晓）；无对端快照时不清。

### D3 无时间戳表 union 合流（冻结）

- tags 按 name 归一命中：命中**保留本地**、未命中创建（带快照 id，_raw.id 保真）；categories 按 id 同规则（预置 5 条 seed 幂等，快照未命中创建安全）；channel_presets 按 id 命中保留本地/未命中创建 + 事务内同 type 单 default 规范化（切片 31 先例）；item_tags 对合流后 item 集合按 (item_id, tag_id) 对重建（双方并集，悬挂解析失败 → skipped 计数披露）。
- app_settings 整行：对方快照 exportedAt > 本地上次同步基准（内存态，本次会话内比对）→ 对方 appSettings 全列覆盖（缺列保留本地，切片 28 normalizeSnapshotAppSettings 同构）；否则保留本地。多设备按合流顺序自然收敛到最新。
- 已知限制（§7.43 同款明文）：无时间戳表命中行不覆盖——跨设备修改既有标签颜色/分类 Emoji/预设字段不会传播到已存在该行的设备，只对新建设备生效；如需精确传播另立提案加 updated_at 列（schema v18）。

### D4 同步快照 wire（冻结）

`{version:1, kind:'sync', deviceId, exportedAt, items, tags, reminders, channelPresets, itemTags, tombstones:[{kind, entityId, deletedAt}]}`——条目形状与 DataSnapshot 五块**同构复用**（isDataSnapshotItemEntry 等条目级守卫直接复用）；顶层新守卫 `isSyncSnapshotWire`（kind==='sync' + deviceId 非空串 + tombstones 数组元素校验 + 五块均为数组；整包拒绝，条目级宽容 skipped 计数沿切片 31）。文件名 `SYNC_SNAPSHOT_FILE_PATTERN = /^life-sync-[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.json$/`；与 kind:'config'（切片 28）/kind:'data'（切片 31）互不相认。落点：新建 src/domain/syncSnapshot.ts（复用 dataSnapshot.ts 条目守卫与序列化器）。

### D5 合流纯函数与落库（冻结）

- 新建 src/domain/syncMerge.ts：`mergeSyncSnapshots(local, remoteSnapshots, localTombstones)` → SyncMergeResult（toUpsertItems/toDeleteItemIds/toUpsertReminders/toDeleteReminderIds/toUpsertPresets/toDeletePresetIds/toCreateTags/toCreateCategories/rebuiltItemTags/tombstonesToAdd/counts{applied,skipped,conflictsResolved,tombstonesPropagation}）——纯 TS 无 RN 依赖，全部单测覆盖（LWW 双向/墓碑删传播/union 复活/孤儿 reminder skip/多设备顺序合流幂等）。
- Repository 新增 `createSyncSnapshot` / `applySyncMerge` 契约外显式扩展成对（filterExistingItemIds/createDataSnapshot 先例）：落库单 writer 事务（切片 31 两遍法 + _raw.id 保真 + db.batch 原子）；reminders 逐条 item 存在性校验（基线 item 被墓碑删 → skipped）；applySyncMerge 内合入本地新增墓碑（对方删我的 → 本地删 + 记墓碑防回流复活）；成功后 `reminderScheduler.reconcile()` 显式一次（失败不阻断仅披露，切片 31 先例）。
- deviceId：域内自写 uuid v4 纯函数（Math.random 拼接 36 字符小写，零依赖）；存 expo-secure-store 独立键 `sync_device_id_v1`（SecureWebdavConfigStore 同构，src/data/SecureSyncDeviceStore.ts 或并入既有 store 文件实现面由实现定）；首用时生成、永久复用。

### D6 UI（backup.tsx 扩展）

「数据备份」区块后新增「同步」区块：固定说明文案（快照交换式/LWW 语义/无时间戳表限制一句话）+「立即同步」按钮 + 结果披露（合流/冲突/墓碑传播/跳过计数逐项列出，Toast/Alert 文案级）。连接配置复用 webdav_backup_config_v1（未配置 → 提示先在备份页配置连接并测试通过）；同步进行中 busy 态与备份/恢复互斥（settingsSavingKey 同款模式）。

## 5. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 合流顺序影响结果 | 纯函数以 updated_at 全局比较为准，多设备顺序合流幂等（单测锁定） |
| 本地删后同步复活（墓碑丢失） | 删除三方法同事务记墓碑（不可分离）；墓碑随每次上传快照携带 |
| 墓碑集合无限增长 | 同步成功后按对端 exportedAt 最小值裁剪；上限护栏（>5000 条披露） |
| 固定名快照被备份滚动删除波及 | DELETE 仅匹配各自 FILE_PATTERN（28/31 参数化先例），life-sync-* 不在备份列表过滤范围 |
| updated_at 依赖设备时钟 | LWW 对时钟回拨敏感：披露为已知限制（单设备时钟异常时该设备改动可能输给对端旧值）；不做时钟校验 |
| 大快照 15s 超时 | 沿用 WebdavClient AbortController 15s；数据量级（个人日程）实测远低于阈值，超时即披露失败可重试 |
| AI Key/凭据面 | 同步快照不含 SecureStore 内容（AI Provider 配置/WebDAV 连接）；channel_presets 明文上云知情沿切片 31 定案 |

## 6. 契约影响

- **repository.md**：追加非破坏性注记节——createSyncSnapshot/applySyncMerge 契约外显式扩展成对（先例：createConfigSnapshot/applyConfigSnapshot/createDataSnapshot/applyDataSnapshot）+ 三个删除方法同事务墓碑记录的行为注记（不改任何冻结签名语义，deleteItem/deleteReminder/deleteChannelPreset 签名与外部行为不变，仅新增副作用）。
- schema v17：新表 sync_tombstones（migrations toVersion 17 createTable；无既有表变更）；data-model.md 不涉（新表非契约冻结面，注记节说明）。
- 其余契约文件零改动；ai.md 零改动（AI 域不涉及）。

## 7. 验收口径

- `npx tsc --noEmit` 0 错；`npx jest --runInBand` 基线 **98 套件/1455 用例** 只增不减（合流纯函数单测矩阵全绿）；`npx expo-doctor` 2 项预存基线无新增。
- 真机（MuMu + 宿主机 node WebDAV 服务器 10.0.2.2 先例）矩阵 9 条：①两模拟器实例（或同机换 deviceId）互同步新建条目收敛 ②同条目双端改 LWW 晚者赢 ③一端删→另一端同步后消失（墓碑传播）④标签/分类 union 合流（新建传播/既有保留）⑤channel_presets 增删传播 + 单 default 规范化 ⑥app_settings exportedAt LWW ⑦孤儿 reminder（基线 item 被删）skipped 披露 ⑧断网/401 文案区分 ⑨同步后再备份回归（kind:'data' 不受影响）。
- closeout 义务：代码地图、教训、遗留披露、backlog 划项（本候选行关闭）。

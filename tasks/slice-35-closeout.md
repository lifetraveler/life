# 切片 35 收尾移交 — 双向同步 WebDAV（快照交换式，行级 LWW+墓碑，集合级 union，仅手动）

- 日期：2026-11-22 立项 → 2026-11-22 收尾（当日完成，两阶段 + 页面单测补充连做）
- 分支：`task/slice-35`（基点 main @ `4286f6d`）；提交链 `e0e6fee`（阶段 1：域+数据层+schema v17+契约注记+单测矩阵）→ `2e1a85c`（阶段 2：backup.tsx 同步区块 + WebdavClient 无裁剪上传）→ `d3fee74`（页面级单测补充）→ 收尾提交（真机验收+closeout+backlog）
- 状态：**完成**（真机矩阵 9/9 通过 + AGENTS §5 migration 真机升级验收）

## 一、交付清单

- 提案 `docs/proposals/slice-35-two-way-sync-webdav.md`（用户 2026-11-22 三问定案：行级 LWW+墓碑 / 集合级 union / 仅手动）
- 任务卡 `tasks/slice-35.md` + AGENTS.md v0.39（新增 §7.47，随阶段 1 提交）
- 契约：`docs/contracts/repository.md` 追加「双向同步快照接口（v0.39，切片 35 阶段 1 落地）」注记节（createSyncSnapshot/applySyncMerge/pruneSyncTombstones 三方法 + 三删除方法墓碑副作用注记；冻结签名零 diff）；`data-model.md` 本片零改动（新表说明落 repository.md 注记节，用户批准口径）
- schema v17：`src/db/schema.ts`（SCHEMA_VERSION=17 + sync_tombstones 表：kind string / entity_id string isIndexed / deleted_at number）+ `src/db/migrations.ts`（toVersion 17 createTable step，仅末尾追加）+ `src/db/models/SyncTombstoneModel.ts` + `src/db/database.ts` 注册（8 model）
- 域层 3 文件：`src/domain/syncSnapshot.ts`（SyncSnapshot wire + isSyncSnapshotWire 整包守卫含 tombstones 元素级校验 + SYNC_SNAPSHOT_FILE_PATTERN + serialize/parse + SyncReminderEntry）+ `src/domain/syncMerge.ts`（mergeSyncSnapshots 纯函数合流：墓碑→categories→items→reminders→presets→tags→itemTags→appSettings 八段处理序，行级 LWW 全局比较顺序无关）+ `src/domain/syncDevice.ts`（uuid v4 域内自写 + isDeviceId 严格校验 + SyncDeviceStore 端口）
- 数据层：`src/data/SecureSyncDeviceStore.ts`（SecureStore 键 sync_device_id_v1）+ `src/data/WatermelonItemRepository.ts`（createSyncSnapshot 九路组包 / applySyncMerge 单事务两遍法先删后建 / pruneSyncTombstones 严格早于裁剪 / 三删除方法墓碑副作用）+ `src/data/ItemRepository.ts`（端口三方法签名）
- WebDAV：`src/data/webdav/WebdavClient.ts` +uploadSyncSnapshot（固定名覆盖写 MKCOL 405 容忍+PUT，不做滚动裁剪——KEEP_SNAPSHOT_COUNT=10 倒序裁剪按 uuid hex 排序无时间语义会误删对端快照）
- UI：`src/app/settings/backup.tsx` 同步区块（连接复用 webdav_backup_config_v1、busy 互斥 'sync'、七步编排、披露文案行、本设备标识 hint）
- 测试 7 文件（+104 用例）：`syncSnapshot.test.ts`(16) / `syncMerge.test.ts`(41) / `syncDevice.test.ts`(6) / `syncRepository.test.ts`(22) / `SecureSyncDeviceStore.test.ts`(6) / `migrationsV17.test.ts`(5) / `backup.test.tsx` 补 6（承切片 31 页面级先例）；`migrationsV9/V8/V11/V12/V13/V14` + `seedPreset.test.ts` 版本断言例行更新 16→17；`channelPresetRepository`/`filterExistingItemIds`/`importExport` 三处 harness 补注册 SyncTombstoneModel；`ReminderScheduler.test.ts` FakeRepository 补三 sync stub
- 构建配置：`android/app/src/release/AndroidManifest.xml` **新增**（`usesCleartextTraffic="true"`，见 §五.5 披露）
- closeout 本文件 + backlog.md 划项（随收尾提交）

## 二、环境与构建事实

- 验收环境：MuMu 双实例——设备 A=猴王 adb `127.0.0.1:16384`（存量 v16 数据，升级安装）、设备 B=猜猜 adb `127.0.0.1:16416`（MuMuManager control -v 1 起的第二实例，新装）。**emulator-5554 与 127.0.0.1:16384 是同一 VM 的两条 adb transport（同 android_id），不可作两台设备**。
- 安装包 `life-0.23.0-v10-s35.apk`（`cd android && ./gradlew assembleRelease`，108.6MB，不提交）；release 包首版 HTTP 全挂 → 新增 release manifest cleartext（§五.5）后重装。
- WebDAV 测试服务器：`node .tmp-s35/webdav-server.mjs`（root `.tmp-s35/webdav-root/`，auth life/life-pass，0.0.0.0:5280），两台均 `adb reverse tcp:5280 tcp:5280` + BaseURL `http://127.0.0.1:5280`（10.0.2.2 直连 NAT 失败）。请求日志 `.tmp-s35/server.log` 全程留证。矩阵⑦孤儿 fixture 经 curl PUT 注入 B 固定名快照（`.tmp-s35/snapB-orphan.json`）。
- schema **v16→v17**：16384 升级安装（install -r 保留存量数据）后启动正常 + 全部同步功能可用 = AGENTS §5 migration 真机验收（JS-only 变更无原生改动，无需重建 dev client）。
- 无新依赖；冻结区（`src/notifications/`、`src/domain/recurrence/`、`src/domain/export.ts`）实现文件零改动；AI 域零改动。

## 三、代码地图

| 文件 | 改动 | 要点 |
| --- | --- | --- |
| `src/domain/syncSnapshot.ts` | 新建 190 行 | SyncSnapshot wire `{version:1,kind:'sync',deviceId,exportedAt,appSettings,categories,items,tags,reminders,channelPresets,itemTags,tombstones}`；isSyncSnapshotWire 整包拒绝（八块数组形状 + appSettings 仅要求对象 + tombstones 元素级校验坏元素整包拒绝）；`SyncReminderEntry = DataSnapshotReminder + createdAt/updatedAt`（提案缺陷披露 #2，见 §五.2）；SYNC_SNAPSHOT_FILE_PATTERN（提案原文宽松 uuid）；syncSnapshotFileName/deviceIdFromSyncFileName 往返 |
| `src/domain/syncMerge.ts` | 新建 485 行 | mergeSyncSnapshots(local, remoteSnapshots, localTombstones, options) 纯函数；远端快照排序 (exportedAtMs 升序, deviceId 升序) 全程确定性；行级 LWW pickRowWinner（updatedAt 最大、平局远端 deviceId 字典序最大、严格大于才覆盖）；墓碑 map `${kind}:${entityId}` 本地已有保留更保守、toAdd 全量合入防回流复活；reminders 孤儿（itemId ∉ resolvedItemIds）→ skipped、基线被墓碑删→级联静默跳过（防 batch 内同行 update+destroy 冲突）；tags normalizeTagName dedupKey 命中静默保留+resolution 映射/未命中创建 id 保真；categories/presets id union；itemTags 纯 union 增补；appSettings 基线 LWW（settingsBaselineExportedAt 内存态会话基线，null=首会话全合格）+ normalizeSnapshotAppSettings 缺列保留本地 |
| `src/domain/syncDevice.ts` | 新建 | generateDeviceId() uuid v4 五段（第 3 段 4 开头、第 4 段 8/9/a/b 开头）；isDeviceId 严格 v4 正则（仅 SecureStore 回读校验，wire 层仅非空串按提案）；SYNC_DEVICE_ID_STORE_KEY='sync_device_id_v1'；SyncDeviceStore 端口 |
| `src/data/SecureSyncDeviceStore.ts` | 新建 30 行 | getOrCreate：读→isDeviceId 合法复用→否则生成+写回；底层异常冒泡 |
| `src/data/WatermelonItemRepository.ts` | +~510 行 | createSyncSnapshot(deviceId) 九路 Promise.all 组包（items=active∪archived、reminders 带 createdAt/updatedAt LWW 判据、墓碑全量）；applySyncMerge 单 db.write 两遍法：①删除先行（item 级联 reminders+joins，缺行静默）→②items 命中 prepareUpdate 11 字段/未命中 prepareCreateFromDirtyRaw 保真→③reminders 深层校验+防御性 itemId 复核，命中写穿 v10 语义列（item_id 不改、调度态两列不写）/未命中 prepareCreate 兜底 'system-notification'→④presets assertValidChannelPresetConfig+同 type 单 default 收敛→⑤tags dedupKey 防御→⑥categories id union→⑦itemTags 去重增补→⑧tombstonesToAdd 保真合入→⑨appSettings prepareUpdate 14 列写穿（照抄 updateSettings 映射）或行缺失 prepareCreate；pruneSyncTombstones(minRemoteExportedAtMs) 删 deleted_at 严格早于 |
| 同上 三删除方法 | +3 行/处 | deleteItem/deleteReminder/deleteChannelPreset destroy 后 await recordTombstoneInTransaction(kind, id)（同事务幂等 helper：查 kind+entity_id 无则 create deletedAt=Date.now()）；deleteItem 级联 reminders **不记墓碑**（item 墓碑表达整棵子树） |
| `src/data/webdav/WebdavClient.ts` | +31 行 | uploadSyncSnapshot(config, fileName, content)：文件名先过 isSyncSnapshotFileName（非法→invalid-response 零网络调用）；MKCOL 405 容忍+PUT；**不调 listSnapshots 不 DELETE**（固定名无滚动裁剪） |
| `src/app/settings/backup.tsx` | +~160 行 | 「双向同步」区块（数据备份与快照列表之间）：固定说明+本设备标识 hint（useFocusEffect getOrCreate）+立即同步按钮 busy='sync'；handleSync 七步：①createSyncSnapshot+uploadSyncSnapshot→②listSnapshots(isSyncSnapshotFileName) 排除自己→③逐个 download（网络/认证错误冒泡中止；parse 失败 skip 披露）→④mergeSyncSnapshots(基线=模块级 lastMergedUploadExportedAt)→⑤applySyncMerge→⑥重读组包+上传+记录基线→⑦对端>0 时 prune(min exportedAtMs)；披露：已与 N 台合流/合流写入 X（冲突解决 Y）/墓碑传播删除 Z/跳过 S/(可选)K 份解析失败/(可选)已裁剪 P 条；⑤成功⑥失败=本地已合流服务器旧快照，下次①自愈 |
| `src/db/schema.ts` + `migrations.ts` + `SyncTombstoneModel.ts` + `database.ts` | v17 | sync_tombstones 三列（kind/entity_id isIndexed/deleted_at，无时间戳列）；migration createTable 与 schema 逐字段一致；model 装饰器 @text/@text/@field |

## 四、真机矩阵（9/9，任务卡 §3 + AGENTS §5 迁移验收）

1. **① 双实例互同步收敛 ✅**：A 建条目+存量全量 → A 同步（12044B）→ B 同步披露「已与 1 台设备快照合流；合流写入 62 项（冲突解决 0）；墓碑传播删除 0 项；跳过 0 项」→ B 计划页显示 A 全部条目；反向 B 改条目 → A 同步显示 ✓。截图 m1-01~m1-05、m2-01~m2-04。
2. **② LWW 晚者赢 ✅**：同条目 A 改 A2→同步→B 改 B2 LATE（墙钟晚）→同步→A 同步→A 显示 "Buy Groceries B2 LATE" ✓ 双端收敛到晚者（m1-06、m2-05）。
3. **③ 删除墓碑传播 ✅**：A 删除记录→A 同步（跳过 2 项=B 快照中被删条目的 join 孤儿，语义正确）→B 同步披露「合流写入 12 项（冲突解决 11）；**墓碑传播删除 1 项**；跳过 0 项；**已裁剪 1 条过期墓碑**」→ B 条目消失 ✓（pruneSyncTombstones 真机生效；m3-01~m3-04）。
4. **④ 标签/分类 union ✅**：A 新建条目+新标签 SyncTagA→A 同步→B 同步→B 显示条目+SyncTagA chip ✓（m4-01~m4-03）。既有标签改色不覆盖无 UI 路径（应用无标签视觉编辑界面）→ 由 syncRepository 单测覆盖 + AGENTS §7.47 已知限制披露。
5. **⑤ channel_presets 增删+单 default ✅**：A 新建 webhook 预设+设默认→A 同步→B 同步→B 预设页 ★ Sync Preset 默认+PresetA 降级 ✓；B 删除预设→B 同步→A 同步披露「墓碑传播删除 1 项」→ A 计数 0 ✓（m5-01~m5-06）。
6. **⑥ app_settings LWW 两向 ✅**：B 切 展示待办项 ON→B 同步→A 同步→A=true ✓；A 切 显示分类图标 ON→A 同步→B 同步→B 两开关均 true ✓（m6-01~m6-05）。**观测（设计后果，非缺陷）**：本地改设置后不立即同步、对端先完成同步轮（快照 exportedAt 更新）→ 本地未推送修改被对端覆盖（B 两次实证）——设置无时间戳、LWW 锚定快照 exportedAt ⇒ 语义=「后完成同步的一方设置生效」。
7. **⑦ 孤儿 reminder skipped ✅**：curl 注入 fixture（B 快照追加 itemId='nonexistent-item-x' 的 reminder）→ A 同步披露「合流写入 0 项；**跳过 1 项**」→ 未落库 ✓（m7-01）。
8. **⑧ 断网/401 文案区分 ✅**：杀宿主 node 进程→A 同步「**同步失败：网络错误：WebDAV 网络错误：Network request failed**」；改错密码→A 同步「**同步失败：认证失败（HTTP 401）：创建目录：认证失败（HTTP 401，请检查用户名/密码）**」→ 两文案清晰区分 ✓（m8-01、m8-02）；恢复密码后同步正常。
9. **⑨ 同步后备份回归 ✅**：A 立即备份→life-config-20261122-200714.json「备份完成」；立即备份数据→life-data-20261122-200821.json「数据备份完成」；快照列表/数据快照列表分别列出 ✓；life-sync-*.json 两文件不受影响 ✓——config/data/sync 三文件族同 basePath 共存互不干扰（m9-01）。
10. **AGENTS §5 migration 真机升级验收 ✅**：16384 存量 v16 数据升级安装 v17 APK→启动正常、存量条目/提醒可见、同步功能全程可用（§二）。

## 五、踩坑与遗留披露

1. **提案缺陷披露 #1（D4 wire 键清单漏两块）**：D4 键清单漏列 appSettings+categories，但 D3 要求 categories union 与 appSettings exportedAt LWW——实现含这两块（appSettings 域形状 config 快照同构，守卫仅要求对象整包拒绝；categories 数组+条目级宽容收窄谓词 isSyncCategoryEntry 含 name trim 非空）。设计细节以提案 D3 为准，键清单视为笔误，已在 syncSnapshot.ts 头注释披露。
2. **提案缺陷披露 #2（SyncReminderEntry 形状偏差）**：D4「条目形状与 DataSnapshot 五块同构复用」与 Q1「items/reminders 行级 LWW」冲突——DataSnapshotReminder（切片 31 冻结形状）不含 updatedAt。修订：sync wire reminders 条目扩为 `SyncReminderEntry = DataSnapshotReminder + createdAt/updatedAt`（毫秒），守卫 isSyncReminderEntry 前置 isDataSnapshotReminderEntry+两键有限数校验（零 cast）；LWW 决胜用 wire updatedAt，落库仍 prepareUpdate 自动刷新（LWW 锚定最终写入语义不变）。repository.md 注记节已披露该偏差。
3. **appSettings 基线为内存态（D3 冻结语义的边界）**：lastMergedUploadExportedAt 为模块级变量（本会话内比对，App 重启归零）。实现推演弃用两备选：updated_at 基线不可用（app_settings 无时间戳列）；T0（本次首传 exportedAt）基线会死锁（合并重导出恒新于 T0 → 交替同步永不传播）。矩阵⑥观测：设置语义=「后完成同步的一方生效」——本地改设置后若对端先完成同步轮（其对端快照 exportedAt 更新），本地未推送修改被覆盖；属设计后果（无设置时间戳可锚），用户改设置后尽快同步即可。
4. **LWW 锚定最终写入的涟漪**：每轮 applySyncMerge prepareUpdate 重写全部命中行 updated_at（合流写入时刻）→ 对端下一轮按 LWW 重新接受这些行 → 披露「冲突解决 N」计数放大（真机见 11/12）；无数据丢失，repository.md 注记已披露多设备部分拓扑下有已知误差。
5. **release AndroidManifest 新增（构建配置变更，须披露）**：首版 release 包 HTTP 全挂（"Network request failed"）根因=Android cleartext 政策（debug 模板自带 usesCleartextTraffic，release 无）→ 新增 `android/app/src/release/AndroidManifest.xml` `<application android:usesCleartextTraffic="true"/>`。影响：release 包允许明文 http 流量；本切片动机=局域网自托管 WebDAV（http）测试场景；**正式分发前应移除或改 networkSecurityConfig 白名单**（记 backlog 契约化已知限制）。
6. **同步中断自愈**：⑤applySyncMerge 成功但⑥上传失败时，本地已合流（服务器上还是旧快照）→ 下次同步①重新上传本地快照自愈，无死锁面。
7. **MuMu 双实例陷阱**：emulator-5554 与 127.0.0.1:16384 同 VM（同 android_id）；双设备必须 MuMuManager 起第二实例。adb reverse tcp:5280 每台各设一次；10.0.2.2 直连宿主 NAT 失败。
8. **basePath placeholder 陷阱**：uiautomator dump 的 text= 含 TextInput placeholder——'/life-backup' 显示实为 placeholder，两台最初 basePath 为空致快照 PUT 落服务器根；配置后 MKCOL/PUT 全走 basePath。判断输入框实值需截图或清空后重输。
9. **真机操作细节（复用）**：input text 空格用 %s；uiautomator bounds 偶发倒挂（[68,190][208,137]）→截图+相邻锚点估位；开关状态断言用 dump 中 Switch checked= 属性；同步披露行在按钮下方需再滚动一段；401 注入=改密码→保存→同步→恢复（SecureStore 值无 root 不可直读，走 UI）。
10. **矩阵⑦孤儿场景构造**：UI 无法给已删条目建提醒（表单要求现存条目）——孤儿防御经服务器 fixture 注入实证（合法形状 reminder 指向不存在 itemId），等价于「对端快照含孤儿提醒」的真实网络态；深层校验失败路径已有 syncRepository 单测覆盖。

## 六、验证命令与结果汇总

- `npx tsc --noEmit`：**0 错**
- `npx jest --runInBand`：**104 套件 / 1559 用例**全绿（基线 98/1455 只增不减，+6 套件 +104 用例）
- `npx expo-doctor`：2 项预存基线失败无新增（app config 非 CNG、RN Directory 元数据）
- 真机矩阵 9/9（§四）+ AGENTS §5 migration 升级验收；backlog 划项随收尾提交

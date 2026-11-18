# 切片 31 收尾移交 — 数据备份 WebDAV

日期：2026-11-18。分支 `task/slice-31`（基点 main @ `5edeeec`）。
提交链：`659a9bb`（阶段 1 数据备份域+数据层）→ `0ac3e10`（阶段 2 数据备份设置页）→ `94714b4`（docs(backlog) F1/F2 登记，事故期间顺手提交）→ 本收尾提交（closeout + backlog 划项 + AGENTS §8 + 任务卡状态）。
提案：`docs/proposals/slice-31-data-backup-webdav.md`（六问定案）。任务卡：`tasks/slice-31.md`。

## §0 交付清单

| 提交 | 内容 | 规模 |
| --- | --- | --- |
| `659a9bb` | 阶段 1：dataSnapshot.ts 域层六块 + Repository 成对扩展 + WebdavClient 参数化 + repository.md 注记节 + 三件单测 + 夹具 stub | 12 files +2480/-19 |
| `0ac3e10` | 阶段 2：backup.tsx 数据备份区块/数据快照列表恢复删除/reconcile 联动 + backup.test.tsx 10 用例 + profile 注释 | 3 files +683/-5 |
| `94714b4` | docs(backlog)：真机反馈 F1/F2 登记（非本切片范围，事故期间顺手提交） | tasks/feedback-log.md 等 |
| 本提交 | closeout + backlog 划项 + AGENTS §8 + 任务卡状态注记 | — |

## §一 环境事实

- 分支 `task/slice-31` 基点 main @ `5edeeec`（backlog 立项条目曾写 0493a29，以 merge-base 实测为准，本 closeout 顺手更正）。
- 验收环境：MuMu 模拟器**猴王实例**（adb 127.0.0.1:16384，model SM-S9260，用户 2026-11-18 指定）；另存猜猜实例（16416，SM-S9110，**勿用于本测试**——装有同名 app 但为旧缓存 bundle）。
- Metro：`npx expo start --dev-client --port 8081`；WebDAV 测试服务器：宿主机 `node .tmp-s28/webdav-server.mjs`（0.0.0.0:5280，Basic Auth life/life-pass，存储根 `.tmp-s28/webdav-root/`），模拟器内经 `http://10.0.2.2:5280` 访问。
- 证据目录 `.tmp-s31/`（截图 m1/m3/m7/m8/m9 系列 + ui-*.xml；**永不提交**，与 `.tmp-s25/.tmp-s26/.tmp-s28/*.apk` 同列）。服务器测试快照（config 10 份 + data 11 份）留存在 `.tmp-s28/webdav-root/life-backup/`，同样不提交。

## §二 数据库/构建事实

- **schema 停留 v15，零迁移**（数据快照是文件格式，不动 DB schema）。
- `npx tsc --noEmit`：0 错。
- `npx jest --runInBand`：**98 套件 / 1365 用例全过**（切片 30 基线 90/1241 → 切片 28 后 95/1314 → 本片 98/1365，+3 套件 +124 用例，只增不减）。
- `npx expo-doctor`：2 项预存失败（CNG sync + RN Directory metadata），无新增。
- 冻结区零改动：`src/notifications/` 实现文件、`src/domain/export.ts`、AiParser.parse 签名、ChatMessage kind 均未触碰（ReminderScheduler.test.ts 仅测试夹具 stub，§7.13 编译必需）。

## §三 代码地图

**域层（新）**
- `src/domain/dataSnapshot.ts`：DataSnapshot 六块类型（items/tags/reminders/channelPresets/itemTags）；isDataSnapshotWire 整包守卫 + 五条目形状谓词；serializeDataSnapshot（**无缩进**，体积优先）；parseDataSnapshot（中文报错）；`DATA_SNAPSHOT_FILE_PATTERN = /^life-data-\d{8}-\d{6}\.json$/` + isDataSnapshotFileName + dataSnapshotFileName；toDataSnapshotItem/Tag/Reminder/ChannelPreset 组包映射（reminders 仅 v10 语义列，调度态/deprecated 列不进快照）；dataSnapshotExportedAt。

**数据层**
- `src/data/ItemRepository.ts`：端口成对扩展 `createDataSnapshot(): Promise<DataSnapshot>` / `applyDataSnapshot(snapshot): Promise<DataSnapshotApplyResult>`（契约外显式扩展成对，先例 createConfigSnapshot；repository.md 注记节同步）。
- `src/data/WatermelonItemRepository.ts`：
  - createDataSnapshot：Promise.all 六路组包（listItemsWithTags ∪ listArchivedItemsWithTags 全库 + reminders + tags + presets + item_tags 直查）。
  - applyDataSnapshot：单 db.write + operations 同步收集 + 单次 db.batch（两遍法）；items 按 id 命中覆盖（createdAt 不动/updatedAt 自动）/未命中 `prepareCreateFromDirtyRaw`（**id + created_at/updated_at 经 dirtyRaw 保真**）；categoryId 悬挂→skipped；tags 按 normalizeTagName 归一命中（first-wins）/未命中创建（_raw.id=快照 id）/事务内 tagId 映射；reminders 命中覆盖（调度态两列不写）/未命中创建（item_id 解析失败→skipped；deprecated channel='system-notification' + channel_config=null 兜底）；channelPresets 命中覆盖（type 不匹配→skipped）/未命中创建/lastDefaultByType 单 default 规范化；itemTags 对快照 item 删全部 join 重建（prepareDestroyPermanently 收集）；深层校验 isValidDataSnapshotReminderEntry（parseWeekdaysJson/parseOnceCivilJson/渠道 JSON/tzid 白名单全 try-catch，防砖不写坏行）。
- `src/data/webdav/WebdavClient.ts`：`SnapshotFileNameFilter` 类型导出；listSnapshots/uploadSnapshot/downloadSnapshot/deleteSnapshot 末位可选参 `fileNameFilter`（**缺省 isConfigSnapshotFileName 向后兼容**）；uploadSnapshot 裁剪按谓词独立圈定（数据/配置快照互不挤占）。

**UI**
- `src/app/settings/backup.tsx`：「数据备份」区块（立即备份数据）+「数据快照列表」区块（恢复/删除）；BusyAction 扩 dataBackup/dataRestore/dataDelete；loadSnapshots 单次 PROPFIND OR 谓词拆两列；恢复前 Alert 警示 → download→parse→apply→reconcile（失败披露「提醒重排失败（将在下次启动时自动对账）」不阻断）；applied/skipped 披露「已应用 X 项，跳过 X 项（形状不符或引用缺失）」；全 Token 化。
- `src/app/(tabs)/profile.tsx`：备份与恢复 navRow 注释注记（切片 31 共用入口，文案不改）。

**测试**
- `src/domain/__tests__/dataSnapshot.test.ts`（20 用例）、`src/data/__tests__/dataSnapshotRepository.test.ts`（15 用例，LokiJS harness 含 ChannelPresetModel）、`src/data/webdav/__tests__/WebdavClient.test.ts`（+6 参数化用例）、`src/app/settings/__tests__/backup.test.tsx`（新 10 用例）、ReminderScheduler.test.ts 夹具 stub。

## §四 真机矩阵执行记录（猴王 16384）

**已过 9 项（有完整证据，截图存 `.tmp-s31/`）**：

| # | 项 | 结果与证据 |
| --- | --- | --- |
| 1 | 配置备份回归 | life-config-20261118-222744.json 上传 + 12→10 份滚动（m1-config-backup.png） |
| 2 | 数据备份六块落地 | life-data-20261118-222834.json：items=2（id/createdAt 保真）、tags=3、reminders=0、channelPresets=0、itemTags=2、exportedAt 本地时区、kind=data 无缩进（curl 检视） |
| 3 | 双列独立滚动 | 数据备份 ×12 → data 恒 10 份、config 恒 10 份不挤占 |
| 负例 | 损坏快照 | 'this is not json {{{' → 恢复 → 无 alert、红字「恢复失败：快照文件不是合法 JSON」、页面可用（m3-corrupt-errorhint2.png） |
| 5 | 增量覆盖 | #8 恢复流程同验证（命中行按快照值覆盖） |
| 6 | 本地独有保留 | PresetB/local-only-item 恢复后仍在 |
| 7 | name 归一命中 | 快照 BACKUP-TAG（改名变体 PUT 230000）→ 恢复 → 标签仍 3 行、backup-tag 被 🔧 覆盖 = 归一命中（m7-after-restore.png；独立大写行无法经 UI 产生——标签写路径归一，改从快照侧造变体） |
| 8 | isDefault 规范化 | PresetA 默认 → 备份 S1 → PresetB 设默认（漂移）→ 恢复 S1「已应用 8 项」（items2+tags3+preset1+joins2 精确）→ ★PresetA 回归 + PresetB 保留降非默认（m8-after-restore.png） |
| 9 | 恢复后 reconcile | 建 daily 09:00 提醒 → debug-reminders 30 条 → 备份 S2（reminders=1）→ 删提醒 → 0 条 → 恢复 S2「已应用 12 项」→ **30 条回来**（m9 三截图；Metro 日志 14:51:24 scheduled 30 → 14:56:18 cancelled 30 → 14:59:20 scheduled 30 三段证据） |

**未执行 4 项（用户 2026-11-18 批准跳过，移入 backlog 待猴王恢复后补做）**：
- #4 全量还原（卸载重装 → 恢复）——恢复原子性/全新库路径已由单测 15 例覆盖（dataSnapshotRepository.test.ts「全新库恢复 applied=5 id 时间戳保真」等）。
- #10 断网/401 文案区分 + 深浅色 Token——文案映射 formatWebdavError 有单测（WebdavClient 五类错误），页面 Token 化已过阶段 2 代码审查；真机断网未验。
- #11 切片 12「导出 JSON」回归——未真机点按（export.ts 零改动，风险低）。
- chips [30,90,120,240]→[10,60]（设备设置页操作，切片 28 遗留）。

**事故记录**：#10 断网步骤采用 `adb shell svc wifi disable` → 猴王唯一网卡 down 且状态持久化于 VM 磁盘快照 → adbd 无网络监听 → adb 16384 死锁 offline；MuMuManager restart/shutdown-launch/reboot（不支持）/双 adb 客户端均未恢复。**教训：模拟器断网测试禁用 svc wifi/data disable**（应关闭宿主机 WebDAV 服务器进程或用防火墙断模拟器出站）。猴王内测试数据完好（VM 磁盘内），恢复途径=MuMu 窗口手动开 wifi 或重置实例。

## §五 踩坑教训

1. **WatermelonDB 保真建行**：`record._raw.created_at = …` 直写 tsc 报错（_RawRecord 类型只有 id/_status/_changed）——新建行时间戳保真走 `prepareCreateFromDirtyRaw({id, _status:'created', _changed:'', …, created_at, updated_at})`（sync 官方路径，sanitizedRaw 按列消毒）；仅需 id 保真（tags/reminders/presets）仍可 prepareCreate + `_raw.id` builder 直写（applyConfigSnapshot:1108 先例）。
2. **同模型二次 prepareUpdate 必抛**「Cannot update a record with pending changes」——两遍法去重纪律：先全量收集 pending ops，再单次 batch；channelPreset 本地 default 收敛须跳过已在 pending 的行。
3. **标签写路径归一**：UI 无法产生与既有 tag 仅大小写不同的独立行（normalizeTagName 归一命中）——归一测试变体要从快照侧构造。
4. **模拟器双实例双通道混淆**：MuMu 每实例有 TCP 口（16384/16416）+ emu 口（5554/5556）双通道；kill-server 后可能只余 emu 口在线且**机型 getprop 不同**——先 `MuMuManager info -v` 对 port↔实例名，再 getprop ro.product.model 核对（猴王=SM-S9260）。
5. **svc wifi disable = 模拟器网卡 down = adb 死锁**（见 §四事故记录）。
6. **uiautomator dump 假象**：模拟器重启后 UiAutomation 连接可坏（Bad file descriptor 是 dump 进程自身 FATAL），dump 会回放旧缓存文件——恢复法 rm /sdcard/ui.xml 重 dump 或重启 adb；稳定手法=单次调用内 `uiautomator dump /sdcard/ui.xml; cat /sdcard/ui.xml`；偶发坏 bounds（top>bottom）需重 dump。
7. **jest batch mock**：LokiJS batch 是 callback 风格，注入失败用 `mockImplementationOnce((_operations, callback) => callback({ error: new Error('disk failure') }))`（**无类型注解**——显式类型与 ResultCallback 不兼容）；Promise.reject 风格会 unhandled+超时。
8. **react-native 不可 jest.mock**（backup.test.tsx）——绕过 preset 会触发 TurboModuleRegistry DevMenu invariant；只覆写 `Alert.alert`。
9. **Windows node /tmp 不存在**（解析为 F:\tmp）——临时文件用仓库 `.tmp-s28/` 相对路径。
10. **profile「备份与恢复」行滚动位置不固定**——dump 后 grep bounds 再 tap，勿用缓存坐标。

## §六 遗留披露

1. **4 项真机 pending**（#4 全量还原/#10 断网文案/#11 导出回归/chips 改回）——已在 backlog 登记为「切片 31 真机验收补做」条目，猴王恢复后一次补齐（预计 30 分钟）；其中 chips 属切片 28 遗留设备态。
2. 猴王实例 adb 死锁未修复（数据完好）；修复或重置由用户后续处理；重置路径顺带完成 #4（重装 → WebDAV 快照恢复）与 chips 回默认。
3. 服务器测试快照 21 份（config 10 + data 11）留存 `.tmp-s28/webdav-root/` 不提交；猴王设备测试产物（items/tags/presets/提醒）随实例存续。
4. WebDAV 基础设施遗留（承切片 28）：测试连接 PROPFIND 207 假阳性面、MKCOL 单级、同秒上传覆盖——本片未改动该层语义。
5. 数据快照含 channel_presets config_json 明文上云（用户知情定案）；AI Provider 配置（SecureStore）不进快照。

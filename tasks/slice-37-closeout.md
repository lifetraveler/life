# 切片 37 closeout — Spark 灵感火花（capture + 附件上云 + 灵感↔计划关联）

- 日期：2026-11-24
- 分支：`task/slice-37`（基点 main @ `edc55fb`）
- 提案：`docs/proposals/slice-37-spark-inspiration.md`（用户 2026-11-23 五问定案）
- 任务卡：`tasks/slice-37.md`（D1–D8 / 矩阵 §3 十二条）
- 状态：**切片 37 全部完成**（阶段 1 提交 `a68cc86`；阶段 2 提交 `c6dc0d1`；阶段 3 真机矩阵 12/12 全过 + expo-audio durationMs 缺陷批修 + 收尾，随本提交）

## 〇、交付清单

- 阶段 1（`a68cc86`，38 文件）：schema v19 三新表（sparks/spark_attachments/spark_items）+ migrations toVersion 19（三条 createTable 零 unsafeExecuteSql）+ 三 Model + database.ts 注册 + `src/domain/spark.ts`（类型/常量/hash 命名/normalizeSparkNullableText）+ SparkRepository 端口（含 SparkAttachmentIo 五方法）+ WatermelonSparkRepository 实现 + sparkAttachmentIo 默认 IO + WebdavClient 附件三方法（60s 超时）+ webdav url/base64 扩展 + dataSnapshot 三可选块（守卫/组包/sparkAttachmentFiles 披露）+ WatermelonItemRepository 快照扩展（第 4 参 IO 注入）+ repository.md v0.43 注记节 + 9 新测试套件 + 历史 schema 套件例行刷新 + AGENTS v0.43/提案/任务卡。
- 阶段 2（`c6dc0d1`，18 文件 +2280/−87）：依赖三包（expo-audio ~1.1.1 / expo-image-picker ~17.0.11 / expo-asset ~12.0.14，`npx expo install` 对齐）+ app.json plugins 三块 + `_layout.tsx` Tab 改造（items→sparks/bulb/灵感）+ items.tsx 占位页删除 + `(tabs)/sparks.tsx` 主屏 + `spark/[id].tsx` 详情页 + `item/new.tsx` 预填+保存链 link + `sparkCapture.ts` 编排 + 3 新测试套件（sparkCapture/sparks/newSparkPrefill）。
- 阶段 3（本提交）：真机矩阵 12/12 + **expo-audio 1.1.1 currentTime 缺陷批修**（sparks.tsx wall-clock 累计）+ 重建 APK 复验 + closeout + backlog 划项 + AGENTS §7.49 增补/§8 刷新 + 版本 bump 0.37.0/versionCode 37。

## 一、环境事实

- 构建环境：Windows 本机 gradlew assembleRelease（54s，增量 830 up-to-date）；APK 产物 `life-0.37.0-v37`（版本 0.37.0 / versionCode 37——§5 随片对齐恢复后第二片）。
- 版本 bump 三处：app.json `version: 0.37.0` + android/app/build.gradle `versionCode 37` / `versionName "0.37.0"`（app.json 无 android.versionCode 字段，versionCode 只在 build.gradle）。
- 模拟器：MuMu「猴王」emulator-5554（切片 36 同机；权限经 adb pm grant 预授权 RECORD_AUDIO/CAMERA/READ_MEDIA_IMAGES/READ_MEDIA_VIDEO/外部存储）。
- WebDAV 服务器：`node .tmp-s35/webdav-server.mjs`（127.0.0.1:5280，root `.tmp-s35/webdav-root/`，auth life/life-pass）+ `adb reverse tcp:5280 tcp:5280`（**adb root/重启 adbd 会清 reverse 映射**，需重设）。
- 升级安装：v18 库存量 → `adb install -r` 0.37.0 APK → v19 迁移真机验收；矩阵 10 另做卸载重装全新库恢复链路。

## 二、数据库/构建事实

- schema v18→v19：三条 createTable（sparks title/content 双 isOptional、spark_attachments 含 remote_path/sha256、spark_items 双 isIndexed），零 unsafeExecuteSql；v2–v18 step 零改动；LokiJS 行为级单测覆盖建库读写。
- 升级安装验收：logcat 实证「[🍉] [SQLite] Migrating from version 18 to 19... Migration successful」，存量数据（计划页条目）完整。
- 依赖面：`npx expo install` 三包对齐 SDK 54（npm 直装 ^58 系会拖入 expo-asset@58/expo-constants@58 重复 + 缺 peer，expo-doctor 5 失败——教训见 §五）；app.json plugins 追加 expo-audio/expo-image-picker/expo-asset 三块（受保护五块+android-widget 零改动）。
- expo-doctor：2 项预存失败无新增（CNG non-sync 提示 + RN Directory 元数据）。
- 测试基线：**119 套件/1707 用例全绿**（基线 110/1619 只增不减，+9 套件 +88 用例）；`npx tsc --noEmit` 0 错。

## 三、代码地图（新增/修改）

新增（域/数据）：
- `src/domain/spark.ts` — SparkAttachmentKind/'audio'|'image'、Spark/SparkAttachment/SparkItemLink/SparkLinkedItemSummary、SPARK_ATTACHMENT_MAX_COUNT=20/SPARK_ATTACHMENT_MAX_BYTES=25MB/SPARK_ITEM_LINK_MAX=50、buildAttachmentRemoteName（sha256 前 16-原名）、normalizeSparkNullableText。
- `src/data/SparkRepository.ts` — 端口：CRUD/listSparks 倒序/附件五方法（addAttachment kind 守卫+上限 20、markAttachmentUploaded、deleteAttachment 行+本地+远端失败仅披露）/linkSparkToItem（item 存在性校验+上限 50+幂等）/unlinkSparkFromItem/listItemsForSpark 摘要水合；SparkAttachmentIo{copyIntoSparksDir/fileExists/deleteFile/downloadToSparksDir/deleteRemoteFile/uploadSparkFile}。
- `src/data/WatermelonSparkRepository.ts` — 实现（两遍法事务；deleteSpark/deleteAttachment 事务外 IO 失败 console.warn 披露；kind 读路径防御抛错；listItemsForSpark 悬挂 join 静默跳过）。
- `src/data/sparkAttachmentIo.ts` — 默认 IO：expo-file-system/legacy + WebdavClient（60s）+ SecureWebdavConfigStore；uploadSparkFile 读文件→SHA-256（expo-crypto）→hash 命名→PUT；copyIntoSparksDir 落 sparks/<uuid>.<ext>；缺 WebDAV 配置抛错→「未备份」披露。
- `src/ui/sparkCapture.ts` — captureAttachment 统一链（copy→上限守卫→addAttachment→uploadSparkFile→markAttachmentUploaded；上传失败 uploaded:false 不回滚行）+ reuploadAttachment + 展示纯函数（sparkDisplayTitle/sparkDisplayPreview/formatRelativeTime/formatRecordingDuration/attachmentBackupLabel 等）。
- `src/db/models/SparkModel.ts` / `SparkAttachmentModel.ts` / `SparkItemModel.ts`（join 不用 @relation）。

修改（域/数据）：
- `src/db/schema.ts`（SCHEMA_VERSION=19+三表详注）/ `src/db/migrations.ts`（toVersion 19）/ `src/db/database.ts`（三 Model 注册）。
- `src/domain/dataSnapshot.ts` — DataSnapshot 追加可选 sparks?/sparkAttachments?/sparkItems?（version/kind 不变双向兼容）+ 三守卫 + 三组包 + DataSnapshotApplyResult.sparkAttachmentFiles?: {restored,failed}。
- `src/data/WatermelonItemRepository.ts` — createDataSnapshot 九并行读+三块组包；applyDataSnapshot 三块（sparks id 命中覆盖/未命中 dirtyRaw 保真 first-wins；attachments 超 25MB/悬挂 spark_id skipped；sparkItems **pair 语义 upsert**——LokiJS batch 顺序缺陷规避，见 §五）+ restoreSparkAttachmentFiles（事务外逐个 fileExists→downloadToSparksDir→回写 uri；io 未注入恒 0/0）；构造器第 4 参 sparkAttachmentIo；toDomainItem 改 export。
- `src/data/ItemRepository.ts` — 端口 createDataSnapshot/applyDataSnapshot 注释补 v0.43 三块语义。
- `src/data/webdav/WebdavClient.ts` — 附件三方法（uploadAttachment MKCOL 405 容忍+PUT octet-stream/downloadAttachment GET→arrayBuffer/deleteAttachmentRemote 404→false）+ request() options 扩 body Uint8Array/timeoutMs；`src/domain/webdav/url.ts` 追加 WEBDAV_ATTACHMENTS_DIR/isWebdavAttachmentRemoteName/buildWebdavAttachmentDirUrl/buildWebdavAttachmentUrl（分段拼装）；`src/domain/webdav/base64.ts` 追加 encodeBytesToBase64/decodeBase64ToBytes。
- `src/data/index.ts` — sparkRepository 单例 + sparkAttachmentIo 单例（itemRepository 第 4 参共用）。

新增（UI）：
- `src/app/(tabs)/sparks.tsx` — 速记条（文字/录音/拍照/相册）+ 录音态计时行（wall-clock 250ms 轮询）+ 灵感流 FlatList（摘要/附件徽标/首图缩略/关联数/相对时间）+ 空态卡 + useFocusEffect 刷新 + insets.top。
- `src/app/spark/[id].tsx` — 标题内容失焦保存 + 附件列表（录音回放/图片 Modal 全屏/已备份徽标/删除三清/重传）+ 添加附件按钮组 + 关联计划列表（跳条目/行内解除）+ 「转计划」。

修改（UI）：
- `src/app/(tabs)/_layout.tsx` — TAB_ICONS/Tabs.Screen items→sparks（bulb/灵感）；`src/app/(tabs)/items.tsx` 删除（45 行占位）。
- `src/app/item/new.tsx` — useLocalSearchParams fromSpark/title/content 预填 + 保存链 linkSparkToItem（失败披露不回滚）。
- `app.json`（0.37.0+plugins 三块）/ `android/app/build.gradle`（v37/0.37.0）/ `package.json`+lockfile（三依赖）。

测试（新增 9 套件）：`src/db/__tests__/migrationsV19.test.ts`（结构+LokiJS 行为级）/ `src/domain/webdav/__tests__/webdavAttachmentUrlBase64.test.ts` / `src/data/webdav/__tests__/WebdavClient.attachments.test.ts` / `src/data/__tests__/WatermelonSparkRepository.test.ts`（15 用例）/ `src/domain/__tests__/spark.test.ts` / `src/data/__tests__/dataSnapshotSparkBlocks.test.ts`（11 用例）/ `src/ui/__tests__/sparkCapture.test.ts`（13 用例）/ `src/app/(tabs)/__tests__/sparks.test.tsx` / `src/app/item/__tests__/newSparkPrefill.test.tsx`；8 个历史 schema 套件例行刷新（v18→v19 断言滚动，切片 36 惯例）。

## 四、真机验收矩阵（MuMu 猴王 emulator-5554；2026-11-23/24 执行，12/12 全过）

- 1. **文字速存 ✓**：速记条输入 'Buy milk tomorrow' → 发送 → 卡片首行出现（标题截取 content 首行）+「刚刚」。
- 2. **录音全链 ✓**：录音→停止→卡片徽标「录音×1」→详情页回放（ExoPlayerImpl init + AudioTrack 帧）→ 服务器 `life-attachments/<sha256 前16>-<uuid>.m4a`（hash 命名+即时 PUT）→「已备份」。**durationMs 批修复验**：录音计时显示正常 m:ss（中途 2:37）+ 落库时长=真实 wall-clock 跨度（4:40），库缺陷数值（epoch ms）不复现。
- 3. **拍照 ✓**：详情页「拍照」→ MuMu 相机 → 附件（n）「图片·已备份」即时上云；缩略图点开 Modal 全屏（MuMu 虚拟相机灰帧内容=拍摄内容本身，非渲染缺陷）。
- 4. **相册 ✓**：详情页「相册」→ Android 照片选择器 → 图片附件即时上云（MediaStore 最近项选中即测试残留截图，链路无关）。
- 5. **编辑失焦保存 ✓**：详情页标题改 'My audio idea' 失焦 → 保存 → 返回列表卡片标题已刷新（useFocusEffect）。
- 6. **附件删除三清 ✓**：删除 jpeg 附件 → 确认弹窗 → 记录+本地文件（/data/data/.../files/sparks/）+远端文件三方同步消失（DELETE 204）。
- 7. **转计划全链 ✓**：转计划 → item/new 预填标题 → 保存 → 自动返回灵感详情「关联计划（1）」→ 点关联行跳条目详情页。
- 8. **解除关联 ✓**：关联行尾「解除」→ 「关联计划（0）」+空态文案。
- 9. **备份含三块 ✓**：备份页「立即备份数据」→ 快照 = version 1 + kind data + 九键（六块 + sparks/sparkAttachments/sparkItems；sparkItems 解除关联后为权威空数组；附件行 remotePath/sha256/fileSize 齐全）。
- 10. **卸载重装恢复含附件下载 ✓**：adb uninstall → 装 0.37.0 → 全新库 → 重配 WebDAV → 恢复快照「已应用 77 项」→ **附件双文件自动下载**（downloadToSparksDir 新 uuid 命名落 files/sparks/）→ 灵感列表/详情/已备份徽标/回放/图片预览全链正常（createdAt 相对时间保真）。
- 11. **旧格式快照回归 ✓**：恢复切片 35 时代六块快照（无 Spark 键）→「已应用 61 项」→ Spark 域完整保留（缺块跳过语义实证）。
- 12. **深浅色+权限拒绝 ✓**：`cmd uimode night yes` 灵感页深色完美（同时实证 Tab 改名「灵感」+bulb 选中态）；pm revoke CAMERA → 拍照 → 系统权限弹窗拒绝 → 应用内 Alert「相机权限未授予/去设置」引导；随后授权与浅色复原。

## 五、踩坑教训

- **T1 expo-audio 1.1.1 Android `Property("currentTime")` 返回 `recorder.startTime`（epoch ms）而非 elapsed 秒**（AudioModule.kt:490；expo/expo#39646 + 修复 PR #40239 2025-10 合入，未进 SDK 54 补丁线，npm 1.1.x 稳定止于 1.1.1）→ UI 计时与落库 durationMs 双异常。批修：sparks.tsx 弃读 recorder.currentTime，`recordStartRef`（Date.now 起点）wall-clock 累计计时与 durationMs；重建复验（§四.2）。SDK 55（L13）升级后可回归并摘除。
- **T2 附件 URL 必须分段拼装**：`buildWebdavUrl(config, fileName)` 对整体 encodeURIComponent，传 'dir/name' 会变 %2F → 附件目录/文件名独立 buildWebdavAttachmentDirUrl/buildWebdavAttachmentUrl。
- **T3 npm 直装跨大版本依赖**（^58 系 vs SDK 54）拖入重复原生包 + 缺 peer → expo-doctor 5 失败；`npx expo install` 对齐并自动补 plugins。
- **T4 WatermelonDB LokiJS batch 两遍法顺序**：先批量插所有 create 再 update/destroy（DatabaseDriver.js），同批 destroy+create 同 id 撞 Duplicate key（SQLite 保序可用，适配器相关）→ sparkItems 快照「权威替换」改 pair 语义 upsert（声明对幂等保留/未声明删除/新对保 id 创建/病理 id 撞计 skipped）。
- **T5 uiautomator dump 的 text 与 TextInput 占位符同形**：'/life-backup' 显示实为占位符（basePath 漏配致列表请求打根目录+幻影快照行）；且首字段填入后后续字段下移 52px，旧坐标 tap 全落空。判真值法：同名字符串填入前后无差异即占位嫌疑，重取 dump/输入带后缀串区分。
- **T6 adb root（重启 adbd）清 reverse 映射**：上传 network 失败根因；root 后重设 `adb reverse tcp:5280 tcp:5280`。
- **T7 RN Alert 按钮 tap 偶发失灵**（MuMu）：keyevent 4 兜底可关。
- **T8 页面测试**：Ionicons 拖 expo-asset 原生链（'expo/internal/bundle-origin'）→ 必须 jest.mock('@expo/vector-icons')；勿 jest.mock react-native（绕过 preset 触发 TurboModuleRegistry invariant）；fixture 时间戳挂真实 Date.now()（相对时间函数）；'录音×n' 为多文本子节点，断言用 texts.join('')。
- **T9 createTable step 运行时形状** `{type:'create_table', schema:{name, columns:字典}}`——列是字典非数组（addColumns 的 columns 才是数组），migrations 测试断言按此写。
- **T10 CRLF 文件 python 批改**：open(..., newline='') 保序 + anchor 用 '\r\n' 检测；\n anchor 静默失配。
- **T11 MuMu 自动化路径**：相机快门/二次确认、照片选择器单选自动确认、权限弹窗流程均可用 adb input 驱动；虚拟相机输出灰帧=拍摄内容本身。

## 六、遗留披露

- **Spark 不进 sync 快照**（§7.49 冻结边界）：多设备灵感同步留候选（附件文件随设备本地目录，跨设备需同步协议另议）。
- **AI 转写/AI 拆解留二期候选**（提案 D8；录音仅存+回放）。
- **即时上传失败=本地可用远端缺失**：「未备份」徽标+详情页重传；删除远端失败仅披露（孤儿文件可接受）。
- **恢复附件文件依赖 WebDAV 在线**：离线恢复仅元数据行落库（行保留快照 uri），sparkAttachmentFiles 披露 failed 计数可后补下载。
- **「旧版本 App 读新快照」未真机覆盖**（矩阵 11 验的是新 App 读旧快照；反向由 isDataSnapshotWire 必需键六块结构兼容+单测缺块跳过覆盖）。
- **expo-audio 1.1.1 缺陷面**：currentTime 已批修规避；#39646 录音空文件问题未在本机复现（HIGH_QUALITY 正常产出），SDK 55 升级（L13）时回归。
- **测试服务器根残留**：.tmp-s35/webdav-root/ 根级两个 11-22 时代 config 文件（basePath 空时代产物）——不影响正确 basePath 的列表；测试服务器属 .tmp 基建不入库。
- **jest 偶发 LokiJS 'db locked'**：WatermelonSparkRepository 全量跑偶发 FAIL、单跑即绿（切片 31 起已知，非本片引入）。

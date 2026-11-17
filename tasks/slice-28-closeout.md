# 切片 28 收尾移交（closeout）

> 切片 28：配置备份 WebDAV。分支 `task/slice-28`（基点 main @ `4c8e6ea`）。
> 三阶段跨会话完成（§7.33 惯例 2：阶段 1–2 一次连续完成后暂停 → 反馈文件
> `tasks/slice-28-phase1-2-feedback.md`；阶段 3 真机验收接续完成 → 由本 closeout 收口）。
> 五问定案（2026-11-18）：备份拆两类先配置 / 恢复=增量覆盖 / 仅手动触发 / 保留最近 10 份 / 全量明文上传。
> 提案 `docs/proposals/slice-28-config-backup-webdav.md`；AGENTS.md §7.42（v0.34）。

## §0 交付清单

| 阶段 | 提交 | 内容 | 规模 |
| --- | --- | --- | --- |
| 阶段 1 | `2125ba3` | 域+数据层：configSnapshot（组包/守卫/parse/文件名/exportedAt/normalize）+ domain/webdav（config/url/WebdavError/base64 纯域）+ WebdavClient（PROPFIND/GET/PUT/MKCOL/DELETE + Basic Auth + 15s 超时 + XML 解析 + 裁剪）+ SecureWebdavConfigStore（独立键）+ Repository 端口与实现 createConfigSnapshot/applyConfigSnapshot（契约外显式扩展成对）+ repository.md 注记节（v0.34）+ AGENTS.md v0.34（§7.42/§8）+ 提案/卡随阶段提交 + 5 个测试文件 | 19 文件 +2618/-4 |
| 阶段 2 | `90774f1` | UI：src/app/settings/backup.tsx（连接表单+归一校验+http 明文提示+测试连接+立即备份+快照列表倒序+恢复 Alert 确认+删除确认+Busy 互斥+Token 化深浅色）+ profile navRow「备份与恢复」+ _layout.tsx Stack.Screen 注册 | 3 文件 +612 |
| 反馈 | `1d9006b` | `tasks/slice-28-phase1-2-feedback.md`（§7.33 惯例 2：Phase 1–2/共 3） | 1 文件 +68 |
| 阶段 3 | 本提交 | 真机矩阵 10 项 + 负例（见 §四）+ closeout + backlog 划项 + AGENTS §8 | — |

## §一 环境事实

- 模拟器：MuMu（`127.0.0.1:7555`）；adb 全路径 `/c/software/platform-tools/adb.exe`；Metro `npx expo start --dev-client --port 8081` 后台常驻。
- **dev client 加载新代码的方式**：装机时模拟器上是 0.1.0 老开发壳（2026-11-07 安装）→ `adb install -r life-0.23.0-v10-s30.apk` 升到 0.23.0 壳；壳内 bundle 仍为 APK 内嵌切片 30 旧包 → **launcher URL 框手填 `http://10.0.2.2:8081` + Connect**（MuMu NAT `10.0.2.2`=宿主回环，metro 需绑 0.0.0.0，免 adb reverse）。`exp+life://10.0.2.2:8081` 亦可解析但 launcher Connect 走 http 更稳。
- **DevLauncher 竞态崩溃**（`java.lang.IllegalArgumentException: App react context shouldn't be created before.`，expo.modules.devlauncher DevLauncherAppLoader.kt:49）：monkey 启动 + tap 双触发竞态所致。守则：启动只用单路径——`am force-stop com.vibecoding.life` → `am start -n com.vibecoding.life/.MainActivity` → sleep 8 → tap dev server 条目 → sleep 25。**禁止 monkey 与 tap 并用**。另遇 `Cannot find native module 'ExpoSecureStore'/'BatteryOptimization'` 为 dev launcher 缓存态脏（`pm clear` 后消失，APK 内 dex 类齐全）。
- 抢前台元凶：游戏 com.got.china（AutoJS 停用后仍自启）→ 每条 adb 链首加 `am force-stop com.got.china`。
- WebDAV 临时服务器（永不提交）：`.tmp-s28/webdav-server.mjs`，`0.0.0.0:5280`，Basic Auth `life/life-pass`（无 auth→401），PROPFIND 207/MKCOL 201·405/PUT 201/GET 200·404/DELETE 204·404，存储根 `.tmp-s28/webdav-root/`，日志带时间戳（真机验收判真依据）。宿主机自访用 `127.0.0.1:5280`，模拟器内走 `10.0.2.2:5280`。
- 测试播种：12 份 stub 快照 `life-config-20250101-07{00..50}0000.json`（各 29B `{"version":1,"kind":"config"}`，兼作损坏快照负例）+ `ignored.txt`（无关文件过滤验证）。
- 设备收尾态：夜间模式已还原；连接配置=测试值（`http://10.0.2.2:5280` / `//life-backup` / life / life-pass）；DB 测试产物留存（backup-tag 青⏰、restore-tag 无色、server-only-tag 橙🔧、chips=[30,90,120,240]、条目 slice28-device-test / slice28-second-item）——见 §六 8。

## §二 数据库 / 构建事实

- **schema 停留 v15，零迁移**（快照不含凭据面：连接配置存 SecureStore 独立键 `webdav_backup_config_v1`，不入 app_settings、不入快照——自引用防护，提案 §4.3）。
- `npx tsc --noEmit`：0 错（每阶段提交前均过；第一次跑暴露 ReminderScheduler.test.ts FakeRepository 缺两方法 TS2420/TS2739 共 5 处，补 stub 后清零——§7.13 夹具编译必需）。
- `npx jest --runInBand`：**95 套件 / 1314 用例全过**（收尾全量复跑；基线 90/1241 → +5 套件/+73 用例，只增不减）。
- `npx expo-doctor`：2 项预存失败（app config 非 CNG、RN Directory 元数据）无新增。
- 零新依赖（fetch 客户端自写 + 纯 TS base64）；冻结签名零 diff（AiParser.parse/通知/recurrence/export.ts 未触碰）；ai.md/ui.md/data-model 契约零改动。
- repository.md 注记节「## 配置备份快照接口（v0.34，切片 28 阶段 1 落地）」追加在文件尾；**披露**：卡与提案注记节标题均标 v0.22（历史笔误），按 repository.md 既有惯例（随 AGENTS 版本标注）实际标 v0.34。

## §三 代码地图

| 文件 | 改动 | 对应验收 |
| --- | --- | --- |
| `src/domain/configSnapshot.ts` | ConfigSnapshot 类型族 + isConfigSnapshotWire（version/kind/exportedAt/appSettings/categories/tags 整包守卫）+ isConfigSnapshotCategoryEntry/TagEntry（条目级谓词）+ serialize/parse（ConfigSnapshotParseError 双文案）+ CONFIG_SNAPSHOT_FILE_PATTERN + configSnapshotFileName/formatExportedAt（本地 ISO+时区偏移）+ normalizeSnapshotAppSettings（缺列保留本地/坏值回退默认） | 单测 configSnapshot.test.ts |
| `src/domain/webdav/config.ts` | WebdavConfig + WEBDAV_BACKUP_CONFIG_STORE_KEY + isWebdavConfig（baseUrl 归一校验/basePath·凭据宽容、password 不 trim）+ WebdavBackupConfigStore 端口 | webdavPure.test.ts |
| `src/domain/webdav/url.ts` | normalizeWebdavBaseUrl/webdavBasePathSegments/buildWebdavUrl（逐段 encodeURIComponent、空段过滤=双斜杠无害、fileName 缺省=目录尾斜杠）+ isInsecureHttpUrl | webdavPure.test.ts |
| `src/domain/webdav/WebdavError.ts` | WebdavErrorKind 五类 {network, http-status, auth, invalid-response, timeout} + WEBDAV_ERROR_KIND_LABELS（UI 消费，ai KIND_LABELS 先例） | webdavPure.test.ts |
| `src/domain/webdav/base64.ts` | encodeBase64Utf8（纯 TS 码点迭代，RN 无 atob/buffer 依赖面） | webdavPure.test.ts（Buffer 交叉验证） |
| `src/data/webdav/WebdavClient.ts` | fetchImpl/timeoutMs 注入；testConnection/listSnapshots（href 为主+displayname 兜底+XML 实体+正则过滤+按名倒序）/uploadSnapshot（文件名校验→MKCOL 405 容忍→PUT→listSnapshots→slice(10) 逐 DELETE，失败仅披露）/downloadSnapshot/deleteSnapshot（404→false）；AbortController 15s→timeout；无凭据不发 Authorization | WebdavClient.test.ts（真实 Response+20ms 超时注入） |
| `src/data/SecureWebdavConfigStore.ts` | SecureAiConfigStore 同构（损坏→null 不抛错） | SecureWebdavConfigStore.test.ts |
| `src/data/ItemRepository.ts` | 端口尾成对新增 createConfigSnapshot/applyConfigSnapshot（切片 28 注释块，先例 filterExistingItemIds） | — |
| `src/data/WatermelonItemRepository.ts` | createConfigSnapshot（Promise.all 只读组包）+ applyConfigSnapshot（守卫→db.write 内读→条目谓词→prepareUpdate/prepareCreate 同步收集→**单次 db.batch 提交**；tags 两遍法防 preparedCreate 复写崩溃） | configSnapshotRepository.test.ts（LokiJS 内存库 13 用例） |
| `src/app/settings/backup.tsx` | 全页面（阶段 2 交付，见 §0） | 真机矩阵 |
| `src/app/(tabs)/profile.tsx` / `src/app/_layout.tsx` | navRow + 路由注册 | 真机导航 |
| `src/notifications/__tests__/ReminderScheduler.test.ts` | FakeRepository 加两方法 stub（§7.13） | 编译必需 |
| 测试 ×5 | configSnapshot/webdavPure/WebdavClient/SecureWebdavConfigStore/configSnapshotRepository | +5 套件 |
| `docs/contracts/repository.md` | 注记节 v0.34（两方法语义/计数口径/单批原子/自引用防护/标签偏差披露） | — |
| `docs/proposals/slice-28-…` / `tasks/slice-28.md` / AGENTS.md | 提案 + 卡 + §7.42/§8 | — |

## §四 真机验收矩阵（卡 §3，10 项全通过 + 负例）

| # | 项 | 结果 | 证据 |
| --- | --- | --- | --- |
| 1 | 保存连接 + force-stop 重启配置保持表单回填 | ✅ 跨进程死亡后表单四字段全量回填（SecureStore） | 78/79 |
| 2 | 测试连接：正确凭据 / 错误密码 | ✅ 207→「连接成功」；401→「认证失败（HTTP 401）」+ 列表区同错误双路提示 | 38/72 |
| 3 | 立即备份文件落地 + 内容 | ✅ PUT 1285B；快照含 12 settings 字段、工作 #9575CD/💼、backup-tag #4DB6AC/⏰、exportedAt `+08:00`；MKCOL 405 容忍 | 55/56 + 服务器文件 |
| 4 | 快照列表倒序 + 时间戳 + 无关文件过滤 | ✅ 最新在前；ignored.txt 不出现 | 54 |
| 5 | 恢复覆盖回归 | ✅ 反向漂移（工作改青、tag 清色）→ 恢复 →「已应用 7 项」（1 settings+5 categories+1 tag）→ 紫/青回归 | 57-62 |
| 6 | 本地独有条目保留 | ✅ 再建 restore-tag 后恢复 →「已应用 7 项」→ restore-tag 存活 | 63-68 |
| 7 | 未命中 tag 创建 + settings 部分覆盖 | ✅ 手工快照（categories=[]、chips=[30,90,120,240]、server-only-tag）→「已应用 2 项」→ 橙🔧 创建、chips 落地 | 69-71 |
| 8 | 滚动删除保留 10 份 | ✅ 12 播种+1 新=13 → DELETE 070000/071000/072000（204×3）→ 恒 10 份 | 服务器日志+目录 |
| 9 | 不可达 BaseURL | ✅ `:5999` 拒连 →「网络错误：…无法连接到服务器」 | 73 |
| 10 | 深浅色两态 | ✅ 深色（34/37/54）+ 浅色（80）Token 化可读 | — |
| 负例 | 损坏快照整包拒绝 | ✅ `{"version":1,"kind":"config"}` →「恢复失败：快照格式不符合要求（version/kind/appSettings/categories/tags）」hint，本地零变化 | 75-77 |

## §五 踩坑教训

1. **WatermelonDB `model.update()` 不是事务原语**（Model/index.js:79-84：每个 update/create 即时单发一次 db.batch）——db.write 内逐 op await 不构成原子。事务原子=先 await 全部读取 → 同步 `prepareUpdate/prepareCreate` 收集 → 单次 `db.batch(...)`；prepare 后必须同步送 batch（nextTick invariant :122-124）。
2. **对 prepareCreate 后的模型调 prepareUpdate 会同步 throw**（`invariant(!this._preparedState)`）→ 批次不发送 → 先前已 prepare 的记录 nextTick 异常崩溃进程。tags 同快照重复名场景改**两遍法**：第一遍 pendingTagOps 按 dedupKey 归并（后者覆盖，applied 累计），第二遍统一 prepare。
3. **LokiJSAdapter.batch 是 callback 风格** `batch(operations, callback)`——jest spy 用 `Promise.reject` 会让 compat 层永不 settle（测试超时+unhandled rejection）；注入用 `mockImplementationOnce((_ops, cb) => cb({ error: new Error('...') }))`。
4. **batch 失败后同 Database 实例读≠持久层状态**：prepare 的 draft 已同步进 model._raw（内存缓存），仅未落 Loki——回滚断言须读 Loki 原始行（`getCollection('app_settings').data`）；同 adapter 再建 Database 会触发 RecordCache 断言（不可用）。
5. **DevLauncher 竞态崩溃**（§一）：单路径启动守则 + pm clear 清缓存态；崩后回退前台的是游戏进程（dumpsys topResumedActivity 核对）。
6. **placeholder 陷阱**：basePath 输入框 placeholder 恰为 `/life-backup`，截屏核对误判「已填」实为占位符 → adb `input text` 单斜杠被吞加重迷惑。判真用 `uiautomator dump` 的 text 属性。
7. **PROPFIND 207 假阳性**：本机 stub 服务器对任意存在路径（含根 `/`）都返回 207——「测试连接成功」不能证明 basePath 正确；带时间戳的服务器请求日志（看实际路径）是判真依据。
8. adb `input text` 不支持中文（用 ASCII 名称）；双斜杠输入会被 webdavBasePathSegments 空段过滤归一（无害）。

## §六 遗留披露

1. **测试连接只验 2xx，不校验 basePath 命中**（207 假阳性面）——快照列表读取失败 hint 是第二道防线；源于 stub 服务器宽容性，真实 WebDAV 服务器（如 nginx dav）对不存在路径返回 404，假阳性面更小。
2. **MKCOL 仅单级 basePath**：嵌套路径（如 `/a/b/`）父目录缺失时部分服务器回 409 → 归类 http-status 错误；UI 已按错误文案披露，未做逐级建目录（提案 §7 定案：UI 提示一级目录）。
3. **全量明文 http 传输**（用户五问定案，与切片 12 导出先例一致）：UI 实时提示「建议改用 https」。
4. **同秒两次备份互相覆盖**（文件名秒级粒度，configSnapshotFileName 定案可接受）。
5. **裁剪失败仅披露不重试**（pruneFailedNames →「M 份旧快照清理失败（保留在服务器）」）。
6. **恢复无条目级 preview**：确认 Alert 文案级（增量覆盖规则说明），不逐条预览（提案 §5 定案；不做恢复前兜底快照——误恢复可再恢复或手动改回）。
7. **数据备份（items/reminders/channel_presets）与双向同步拆为后续候选**：WebdavClient/快照列表/保留 10 份基础设施可直接复用（backlog 待定候选行 48）。
8. **设备测试产物留存**（MuMu 7555）：backup-tag/restore-tag/server-only-tag、chips=[30,90,120,240]（矩阵 #7 落地值）、两条测试条目、WebDAV 服务器目录与 11 份快照。下切片真机验收如受 chips 影响，先在设置页改回 [10,60]。
9. AI Provider 配置（SecureStore `ai_provider_config_v1`）不进快照（§7.42 边界）；channel_presets 不进快照（凭据面）。

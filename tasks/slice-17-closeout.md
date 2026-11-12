# tasks/slice-17-closeout.md — 切片 17 收尾移交（§7.10）

切片 17：渠道配置中心 + Webhook 载荷适配 + once 录入增强 + 导入预览（AGENTS.md v0.17 §7.27/§7.28）。
分支 `task/slice-17`；提交链：d270a52 立项 → 8b88a3a 阶段1（schema v9 渠道预设表 + Webhook 载荷模板 + generateIcsPreview + 5 个测试文件 51 用例）→ ee6a1fc 阶段1反馈 → e47babd 阶段2（UI 适配与交互重构，18 文件 +2304/-133）→ 859ccd4 真机验收修复（webhook 预设整串复制的表单校验兼容配置 JSON）→ 本提交（closeout）。

## 环境事实
- Windows 原生 bash（无 MSYS、无 cygpath）；包管理 npm；测试 jest preset=jest-expo。
- MuMu 模拟器换用「猴王」实例：MuMuManager.exe 在 `E:\Program Files\Netease\MuMu\nx_main\`，猴王=index0=`127.0.0.1:16384`（Android 15/SM-S9260，已装 dev client com.vibecoding.life）；另一实例「猜猜」=16416。**本切片无原生改动**（`@react-native-community/datetimepicker@^8.4.4` 与 `expo-calendar~15.0.8` 均已在依赖），无需 rebuild dev client。
- metro 8081 常驻（本项目 `expo start --dev-client`，PID 复用；**后台重启会因端口占用退出——直接复用已运行实例**）+ `adb -s 127.0.0.1:16384 reverse tcp:8081 tcp:8081`；dev launcher 点 Recently opened「life」进入；Fast Refresh 生效（但会重置页内展开的编辑表单）。
- **DB 硬验证新路径**：模拟器系统自带 `/system/bin/sqlite3`，`adb shell run-as com.vibecoding.life sqlite3 life.db "<sql>"` 直接查询（life.db 在 app 根目录，WAL 模式；只读查询可正常读 wal 内容），免拉三件套。
- push 走代理 + HTTP/1.1：`git -c http.proxy=http://172.16.100.254:7893 -c http.version=HTTP/1.1 push`。
- `npx expo-doctor`：16/18，2 失败为预存基线（android/ 目录存在 + CNG 同步提示、watermelondb/simdjson 元数据），非本切片引入。

## 数据库/构建事实
- schema v8→v9（`8b88a3a`）：新增 `channel_presets` 表（id/name/type('webhook'|'apprise')/config_json TEXT/created_at）；migration step 追加，未动旧 step；migrationsV9.test.ts 断言通过。
- 验证基线：`npx tsc --noEmit` 零错误；`npx jest --runInBand` 65 套件 / **811 用例**全过（阶段1 51 → 阶段2 +11 onceAtChips 与夹具补齐 → 验收修复 +4 isWebhookConfigJson）；`npx expo-doctor` 同基线。
- 无 `as any`、无新依赖引入。

## 代码地图
- **阶段1**：src/domain/channelPreset.ts（ChannelPreset/CreateChannelPresetInput/UpdateChannelPresetInput，type 创建后不可变）；db/schema v9 + migrations step + models/ChannelPresetModel.ts；src/notifications/channels/webhookConfig.ts（WebhookChannelConfig 判别联合 mode 'json'|'form'|'text' + payloadTemplate 递归 JsonValue 守卫 + parseWebhookChannelConfig）；src/data/ItemRepository.ts + WatermelonItemRepository.ts（listChannelPresets/createChannelPreset/updateChannelPreset/deleteChannelPreset + generateIcsPreview 纯读预览）；测试：migrationsV9/channelPresetRepository/webhookConfig/icsPreview/reminderForm。
- **阶段2**：src/ui/onceAtChips.ts（onceAtPlusMinutes/onceAtPlusTenMinutes/onceAtPlusOneHour/onceAtTomorrowMorningNine——civil 值经 getZonedParts(now+delta, tzid) 直出，跨天自动进位）+ 11 用例；src/ui/OnceAtField.tsx（复刻 DateTimeField Android 两步 step-machine 'idle'|'date'|'time'，civil 直出→02-30 构造上不可能；chips 行 + tz 提示 + error 自渲染）；src/ui/reminderForm.ts（ReminderFormValues 加 `channelPresetId:string|null` 纯 UI 态；channelPresetSummary/matchesChannelPreset；**isWebhookConfigJson**——对象形态先验 + 复用 parseWebhookChannelConfig 校验，validate webhook 分支 URL **或** 配置 JSON 均放行）；src/ui/ChannelPresetPicker.tsx（useFocusEffect 拉预设按 type 过滤、选中>matched>自定义 展示、管理行跳设置页）；src/ui/ChannelPresetEditor.tsx（TEMPLATE_PRESETS 三模板：Zulip form `{"type":"stream","to":"general","topic":"生活提醒","content":"{{title}} - {{body}}"}`、企业微信 json `{"msgtype":"text","text":{"content":"{{title}} {{body}}"}}`、纯文本 text `"{{title}} - {{body}}"`；isJsonValue 递归守卫避免 as；编辑态类型锁定）；src/app/settings/channels.tsx（列表+新建/编辑卡+Alert 删除）；src/app/(tabs)/profile.tsx（「提醒渠道」节 + handleImport 改走 generateIcsPreview→push '/import-preview'）；src/ui/importPreviewStore.ts（模块单例 ImportPreviewData，先例 transferResultStore）；src/app/import-preview.tsx（isDuplicate 置灰默认不选；确认按 source 分派 importItemsInBatches/importSystemCalendarEntries→setLastImportResult→replace '/import-result'+reconcile）；src/data/ItemRepository.ts + WatermelonItemRepository.ts（**契约外扩展** generateSystemCalendarPreview 纯读 + importSystemCalendarEntries 分批落库固定 sourceType='system-calendar'/sourceReadOnly=true，IMPORT_BATCH_SIZE=100 事务内同键重查）；src/app/system-calendar-import.tsx（preview 流：select→previewing→push 预览页）；FakeRepository 补两 stub；docs/contracts/repository.md v0.17 节补记两方法契约。
- **closeout**：本文件。

## 验收实证
### 阶段1 单测（8b88a3a）
51 用例：模板渲染（Zulip form/企业微信 json/纯文本）、守卫抛错语义、预设 CRUD、generateIcsPreview 去重标记、migrations v9。

### 真机验收（MuMu 猴王 127.0.0.1:16384，2026-11-12/13，adb 自动化）
- **验收3 ✅**：设置页建预设 TestChannel（Webhook）→ 点「用『Zulip』模板」chip（模式自动切 Form + 模板回填）→ 保存 → 列表 `TestChannel [Webhook] https://hooks.example.com/zulip`。
- **验收4 ✅**（859ccd4 修复后）：详情页编辑提醒→预设下拉选 TestChannel→channelConfigText 填入完整配置 JSON、**校验通过**→保存成功（上次对账更新）→重进编辑回显：预设下拉**自动匹配**显示 TestChannel（matchesChannelPreset：channel_config 整串 === preset.configJson）、channel_config 落库为整串 JSON。
- **验收5 ✅**：02-30 直接禁止——日期为 Material DatePicker，2026 年 2 月日历止于 28 日（平年），civil 值取 picker 本地数值构造上不可能 02-30；Chips 三连实测：+10分钟→23:34（语义=从当前时刻推算）、+1小时→正确跨天 11-13 00:24、明早9点→11-13 09:00；保存后详情行 `单次 11-13 09:00（Asia/Shanghai）`、对账时间戳更新。
- **验收6 ✅**：先导 s17-ics-a.ics（2 条基线，预览页 2 条全选确认→新增 2）建立「已存在」；再导 s17-ics-b.ics（5 条=同 2 UID+3 新）→预览页「**共 5 条 · 已选 3 条 · 重复 2 条（置灰不可选）**」，重复项 checkbox 空、标题灰、橙色「本地库已存在（同来源同 UID），将跳过」，新事件默认勾选，按钮数字联动正确。
- **验收7 ✅**：取消勾选「新事件丙」→已选 2→确认导入→结果页「新增 2 条 · 失败 0」→`run-as sqlite3 life.db` 硬证据：ics 来源**恰 4 条**（dup-1/dup-2/new-1/new-2），new-3 **不在库**，重复无重插，floating 按设备时区 Asia/Shanghai 解释正确（1794621600000=11-14 10:00 CST）。「跳过（重复）：0 条」语义自洽——重复项在预览阶段已被排除出确认集合，非导入时跳过。

### 命令验证
`npx tsc --noEmit` 零错误；`npx jest --runInBand` 65/811 全过；`npx expo-doctor` 16/18（2 预存基线）。

## 后续切片候选（用户提出 2026-11-13，已确认开 slice-18；任务卡由用户单独总结）
1. **Chips 增量值可改**：长按「+10分钟/+1小时」弹出修改增量值且记住（如 +15/+2h）；偏好持久化建议落 app_settings 加列（切片 14 v7 加列先例，走 schema v10），不用 AsyncStorage（missed 教训）。
2. **渠道预设默认填充**：选 webhook/apprise 渠道时默认填充预设（第一个，或预设里的「默认」标记→channel_presets 加 is_default 列候选，同属 schema v10）。
3. **多渠道同开**：一个提醒同时选多种渠道（§7.26.3 条件式多渠道兑现）——`Reminder.channel` 为 v0.16 冻结签名（单值）、channel_config 单列仅一渠道配置，需 schema v10 + src/notifications/ 渠道抽象扩展 + UI 多选，**属冻结区变更，须先出变更提案经用户确认**（对齐 §7.17 纪律）。

## 踩坑教训
1. **预设 configJson ≠ 纯 URL**：ChannelPresetEditor 生成的是含 url+mode+payloadTemplate 的完整配置 JSON（§7.27 模板诉求），「选预设=整串复制」撞上 validate 的纯 URL 校验——立项假设与模板诉求冲突，验收期发现，以 isWebhookConfigJson 兼容两种形态收束（859ccd4）。
2. **sed 对 CRLF 文件失效**（`^import {$` 不匹配 `import {\r`）——文本编辑一律用 edit 工具（第二次实证）。
3. **Android 控件触达点用 uiautomator dump 拿 bounds**：截图坐标目测偏上 ~12px 时 Pressable 不响应（详情页日期框实测）；dump 出 `content-desc="日期 …"` 节点 bounds 取中心必中。
4. metro 已运行时后台重启会报端口占用退出——直接复用现有实例（reconcile/log 里确认 PID）。
5. SAF 文件选择器记住上次目录（Download 根 ↔ s8run2 子目录），面包屑可回上一级；`adb push` 用 `C:/` 正斜杠 Windows 路径（本环境无 cygpath）。
6. TextInput 长文本（配置 JSON）光标在末尾时显示中段属正常水平滚动，勿误判为截断。

## 遗留披露
1. **src/app/(tabs)/SystemImportResultView.tsx 无调用方保留**：对应冻结接口 `importSystemCalendarEvents`（切片 9）未动、方法保留，组件随 preview 流退役留作回滚参照。
2. **Chips 语义为「从当前时刻推算」**（`getZonedParts(now+delta, tzid)`），非「表单当前值+delta」；任务卡「+10 分钟」按此实现并被单测锁定，与用户候选需求 1（长按改增量值）兼容。
3. **slice-16 遗留披露 2（02-30 表单兜底）随本切片关闭**：once 已无手输入口，02-30 由 picker 构造性禁止。
4. 预设无 is_default/排序概念（created_at 降序唯一序），候选需求 2 落地时再扩。
5. 网络渠道 at-least-once 边界（slice-16 遗留，进程级 attempts 抑制）延续未触碰。
6. 时区伪影（slice-9 遗留 getDeviceTzid 返回 UTC 的环境特例）未触碰。

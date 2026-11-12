# tasks/slice-16-closeout.md — 切片 16 收尾移交（§7.10）

切片 16：提醒能力升级（一次性 + 多渠道），AGENTS.md v0.16 §7.26。
分支 `task/slice-16`；提交链：5260c3a 立项 → d9ac728 阶段1（schema v8）→ b168541 阶段1 closeout（后被反馈文件替换）→ f3d1b1d 阶段1反馈 → 0ea0c8d 阶段2（渠道抽象）→ b162a0d 阶段2反馈 → b138a7c 阶段3（UI 适配与闪电添加落库）→ 本提交（阶段4 closeout）。
分阶段文档：tasks/slice-16-phase1-feedback.md、tasks/slice-16-phase2-feedback.md、docs/proposals/slice-16-reminder-channels.md（已确认提案）。

## 环境事实
- Windows 原生 bash（无 MSYS）；包管理 npm；测试 jest preset=jest-expo。
- MuMu 模拟器 `emulator-5554`（屏幕 900x1600，dev build com.vibecoding.life，lastUpdateTime 2026-11-11 18:33）；**slice-16 无原生改动**，装过的 dev build 直接换 JS 即可，无需 gradle 重装。
- metro 8081 常驻 + `adb reverse tcp:8081 tcp:8081`；bundle 构建 ~21s。
- dev client 拉起（踩坑）：`am start -d "life://"` 打不开项目场景；必须 UI 点击 dev client home → "Go home" → DEVELOPMENT SERVERS 下 "life"；卡在会话加载页时点 "Reload"。
- push 走代理 + HTTP/1.1：`git -c http.proxy=http://172.16.100.254:7893 -c http.version=HTTP/1.1 push`。
- `npx expo-doctor`：16/18，2 失败为预存基线（non-CNG app config sync 提示 + WatermelonDB/simdjson RN Directory 元数据，slice-14 closeout 已记录），非本切片引入。阶段1 期间曾遇 expo-doctor@1.21.7 上游坏包（当时钉 1.21.6 规避），现已直跑通过。
- `python -c` 多行字符串在 Windows 执行环境会损坏（阶段1、阶段4 两次实证）→ 一律写临时 .py 文件执行后删除。

## 数据库/构建事实
- schema v7→v8（`d9ac728`）：reminders 新增 `once_civil_json`（TEXT，固定键序 `{year,month,day,hour,minute}`）、`channel`（TEXT，存量回填 `system-notification`）、`channel_config`（TEXT NULL）；migration 真机 7/7 断言通过（user_version=8、19 列）。
- **DB 文件在 app 根目录 `./life.db`**（`databases/` 目录只有 google transport 的文件）；WAL 模式，拉库需 `life.db`/`-wal`/`-shm` 三件套。
- 验证基线：`npx tsc --noEmit` 零错误；`npx jest --runInBand` 59 套件 / 745 用例全过（阶段2 末 729 → 阶段3 +16：savePlan 8、reminderForm 20、timeFormat 增补）；`npx expo-doctor` 同基线。

## 代码地图
- **阶段1**：db/schema v8 + migration step；src/domain/reminder.ts（`ReminderFrequency` 加 `once`、`ReminderChannel` 四值、`OnceCivilTime`、`CreateReminderInput`/`UpdateReminderInput` 含 onceAt patch 合并语义）；src/data/reminderRuleMapping.ts（`normalizeReminderChannelFields`/`resolveOnceAt`/`assertOnceCivilTime`/`serializeOnceCivilJson`）。
- **阶段2**（冻结区经 §7.26 授权解禁）：src/notifications/ 渠道抽象——`ReminderChannel`/`NetworkReminderChannel` 接口、`createReminderChannel` 工厂、channels/ 11 文件（SystemNotification/Alarm 继承 OS 通知族；BaseNetworkChannel/WebhookChannel/AppriseChannel/appriseConfig 为网络族）；once occurrenceKey 双族：OS 族沿用 key 规则、网络族 `once:<reminderId>:<epochMs>`；网络渠道 setTimeout 内存定时器（>2^31-1 续链）、10s 超时、2xx 即成功、attempts 进程级抑制重复触发、missed 每轮补发一次（不占 500 预算）；调试出口 `ReminderScheduler.getNetworkArmedKeys()`。
- **阶段3**：src/ui/reminderForm.ts（表单模型扩 onceAt/渠道字段、校验、`buildCreateReminderInput`/`buildUpdateReminderInput`、`REMINDER_CHANNEL_LABELS`、`isValidHttpUrl`）；src/ui/ReminderChannelFields.tsx（新建，纯展示）；src/ui/ReminderFormEditor.tsx（"单次"频率 + 渠道区 + 网络边界灰字）；src/ui/timeFormat.ts（once 行渲染 `单次 MM-DD HH:MM（tzid）` + `formatReminderChannelLabel`）；src/app/item/[id].tsx（编辑接线 + 行 meta 渠道标签）；src/domain/ai/savePlan.ts（`buildOnceReminderPlan`：无 startAt→"需设定时间才能提前提醒"；白名单外→"设备时区 X 暂不支持"；`fireInstant<=now`→"提醒时刻已过去，未创建一次性提醒"；onceAt 经 `getZonedParts` 民用分解 + `resolveOnceAt` 校验）；src/app/debug-reminders.tsx（行打 onceAt/渠道标签 + "网络渠道挂起 Timer" 节）。
- **阶段4**：本 closeout。

## 验收实证
### 阶段1/2 真机（详见 phase1/phase2-feedback）
schema 迁移 7/7 断言、渠道抽象 729 用例、at-least-once 边界用户接受，均已确认。

### 阶段4 联调（模拟器 emulator-5554，2026-11-12，adb 全自动化）
1. 详情页"新建提醒"弹窗完整呈现阶段3 UI：频率含"单次"、渠道四选项（系统通知/闹钟/Webhook/Apprise）、时区白名单、网络渠道灰字"网络推送仅在 App 进程存活时保证发送"。
2. once 创建流（验收5 前半，全 ASCII 可自动化）：触发时刻实时校验（空值显示"触发时刻需为 0–23 时 0–59 分"，填过消失）→ 填 2026-11-12 15:38 → Webhook chip → URL 输入 → 创建成功。
3. 详情页渲染：`单次 11-12 15:38（Asia/Shanghai）` + meta `已启用 · 渠道 Webhook · 生效起点 … · 上次对账 …`；本页保存对账"新调度 0"（webhook 渠道不注册 OS 通知，符合设计）。
4. 调试页（life://debug-reminders 深链）：新节"网络渠道挂起 Timer（webhook/apprise，getNetworkArmedKeys）"显示 共 1 个，armed key `once:8W4gwBWo0gtTwIab:1794469080000`（=15:38+08 epoch ms）；提醒行 `单次 2026-11-12 15:38 / 渠道 Webhook`。
5. **到点触发实证**：宿主监听器（emulator 经 10.0.2.2:18080 访问）在 15:37:59.7（设备钟，设备钟约快 5s）收到唯一 `POST /hook5`，body `{"type":"life-reminder","occurrenceKey":"once:8W4gwBWo0gtTwIab:1794469080000","reminderId":"8W4gwBWo0gtTwIab","itemId":"FW3CAZkQJGSeIjt3","title":"开周会","body":"你有一个日程提醒","fireAt":1794469080000,"sentAt":1794469080067}`；UA okhttp/4.12.0、application/json；观察期内无重复触发（attempts 抑制生效）。
6. DB 落库实证：`frequency='once'`、`once_civil_json='{"year":2026,"month":11,"day":12,"hour":15,"minute":38}'`（固定键序）、`channel='webhook'`、`channel_config='<URL 原文>'`、`local_time_hour/minute=0/0` 占位、`enabled=1`。

### 命令验证
`npx tsc --noEmit` 零错误；`npx jest --runInBand` 59/745 全过；`npx expo-doctor` 16/18（2 预存基线）。

## 踩坑教训
1. dev client 拉起必须 UI 点击，deep link 对启动器无效；会话卡加载点 Reload。
2. life.db 在 app 根目录而非 databases/；WAL 三件套拉库。
3. `python -c` 多行损坏 → 临时 .py 文件（第二次踩到，已固化）。
4. `adb input text` 仅 ASCII：验收6/7 的中文输入无法自动化，必须真机人工。
5. uiautomator dump 只含可视节点，长页面（调试页）需多次 swipe 分段定位；modal 内滚动同样适用。
6. 设备钟与宿主钟差 ~5s，跨机对时证据按设备钟解读。

## 遗留披露
1. **验收5 措辞与实现差异（按已确认提案收敛）**：任务卡验收5"到点后本地通知和 Webhook 网络请求同时触发"——提案与 §7.26.3 为条件式"若开启多渠道，本地系统通知和网络推送可同时触发"；本切片 UI 为**单渠道选择器**（不暴露多渠道同开），选 Webhook 的提醒到点**仅发网络请求**，不注册 OS 通知（模拟器实证：新调度 0、armed key 属网络族）。多渠道同开需模型层扩 channel 多值/多配置，留待后续切片。
2. **once date 月内日历有效性**：表单只拦格式（YYYY-MM-DD）与范围（月 1-12、日 1-31、时 0-23、分 0-59），"02-30"这类日期不拦表单，由调度侧 `assertOnceCivilTime` 兜底；后果=创建路径可落库但调度侧报错（编辑路径 catch 后弹错），留待表单打磨。
3. **Apprise 表单只覆盖 `{baseUrl,key}` 简写**，stateless `urls` 不暴露（channel_config 契约本身支持）。
4. **网络渠道 at-least-once 边界**（阶段2 已确认接受）：attempts 抑制为进程级，force-stop 后重启该 occurrence 可能重复 POST。
5. **真机验收待用户确认（merge 前）**：验收5 完整流（真机 webhook.site/自建监听）+ 验收6（闪电添加"明早9点开会，提前10分钟提醒"→详情页"一次性提醒（08:50）"）+ 验收7（无时间→"需设定时间才能提前提醒"不落库）。模拟器已覆盖验收5 全链路证据；6/7 逻辑面由单测覆盖（savePlan 8 用例 + reminderForm 20 用例）。
6. 时区伪影（slice-9 遗留 getDeviceTzid 返回 UTC 的环境特例）不在本切片范围，未触碰。

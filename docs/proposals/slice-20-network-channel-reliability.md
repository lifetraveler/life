# 切片 20 变更提案：网络渠道后台送达可靠性（电池优化白名单 + 前台服务）

> 编号暂定 slice-20，排任务时可调。**确认记录为空前，不得修改 src/notifications/ 实现文件与 android 原生配置**（§7.17 惯例）。

## 背景与问题
- 网络渠道（webhook/apprise）投递由进程内 JS 定时器驱动（src/notifications/ networkTimers 复合键 `${channelId}|${occurrenceKey}`，切片 18 落地），仅进程存活时保证送达（UI 已注明「网络推送仅在 App 进程存活时保证发送」）。
- 进程被冻结（Android Doze/App Standby、厂商省电策略）后定时器不触发，到点投递丢失；切片 19 真机验收后用户明确：系统通知/闹钟渠道走 OS 调度不受影响，网络渠道需解决存活问题，并选定按成本排序的方案 1（电池优化白名单）+ 方案 2（前台服务）。
- 边界（本提案不改）：用户主动 force-stop / 系统强杀后的网络投递缺口，仍由现有 missed 补发（computeMissed，App 下次启动时按渠道独立 attemptStatus 补发）兜底；补发语义不变。

## 变更 A：电池优化白名单（方案 1，成本最低）

### 方案
- 设置区新增「送达可靠性」入口：说明文案 + 「加入电池优化白名单」按钮（复用 default-channels 页或 profile 渠道节挂入口，UI 细节排任务时定）。
- 点击后发系统弹窗：`ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`（package URI 指向本应用）；manifest 追加 `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`（normal 级权限，app.json android.permissions 声明，Prebuild 后 android/ 同步）。
- 厂商定制 ROM 剥离该 intent 时降级为跳转系统设置页（`ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS`），用户手动加入。
- 白名单状态检测：PowerManager.isIgnoringBatteryOptimizations 无 Expo 官方 JS API，实现路径二选一（开工前定，见决策点 1）：a) 自写轻量 Expo Module（Kotlin 十行级，读一个 boolean）；b) 引入社区库。

### 影响范围
- src/app/settings/（入口页/文案）；app.json android.permissions 追加一条；可能新增一个极小原生模块（dev client 需 rebuild）。
- 不改 schema（白名单是系统设置，App 侧只读状态用于展示提示）；不改 src/notifications/ 调度语义（白名单只是让现有 AlarmManager/定时器少被系统干预）。

### 回滚
- 单 commit 回退入口页与权限声明；无 schema 变更；用户侧已加入白名单不产生应用数据残留。

### 已知边界/风险
- Play 商店对该 intent 用途审查严格（仅允许核心功能豁免场景）；本项目当前本地优先、无商店分发计划（MVP dev client/sideload），披露即可。
- 各厂商 ROM 省电策略不一（MIUI/EMUI 自启动管理独立于电池优化），白名单≠全覆盖——设置页文案必须如实（「降低被冻结概率，不保证 100% 送达」）。
- 模拟器（MuMu）不冻结进程，效果验证必须真机。

## 变更 B：前台服务（方案 2，常驻通知换稳定存活）

### 方案
- Android 前台服务：App 持有常驻通知（「生活提醒运行中」）使进程不被冻结，JS 定时器持续驱动网络投递。
- 实现依赖决策（开工前二选一，见决策点 2，§7.3 需说明理由与替代方案）：
  a) notifee（社区成熟，支持前台服务启动/常驻通知；与 expo-notifications 并行使用的通知渠道冲突需阶段 1 实测）；
  b) 自写 Expo Module（Kotlin Service + startForeground，可控性最高，成本高于 a）。
- 触发时机：存在启用的网络渠道提醒时启动（首次创建 webhook/apprise 提醒即启动；全部网络提醒删除后停止）——无网络渠道的用户不被常驻通知打扰。
- Android 14+（API 34）需声明 foregroundServiceType（dataSync 或 specialUse）及对应权限，经 config plugin/Prebuild 同步。

### 影响范围
- src/notifications/（**冻结区**——本提案即 §7.17 式变更载体，确认后解禁实现文件；ReminderScheduler 或新增 ForegroundServiceBridge 模块）；
- app.json plugins 追加配置；若选 notifee → package.json native 区变更（新依赖，需 rebuild dev client）；
- 是否新增 app_settings 开关（「网络渠道增强送达」→ schema v12 addColumns）见决策点 3。

### 回滚
- 变更 B 独立 commit（§7.17 两处分提交惯例，先 A 后 B）；服务停止逻辑保证关闭后回到现状（网络渠道退回「仅进程存活时送达」）。

### 已知边界/风险
- 常驻通知是可见性成本（状态栏永久图标）；Android 13+ 通知权限被拒时前台服务仍运行但无通知展示（系统行为，需文案披露）。
- 前台服务仍可能被厂商激进冻结——白名单 + 前台服务叠加效果最佳，两变更是互补而非二选一。
- notifee 与 expo-notifications 并存时的 channelId/渠道冲突未实测，是变更 B 阶段 1 的首要验证点。

## 验收标准（可执行/可观察）
- 变更 A：真机点击入口 → 系统白名单弹窗出现 → 加入后 `adb shell dumpsys deviceidle whitelist | grep com.vibecoding.life` 包含本应用；灭屏锁屏 30 分钟后到点 webhook 投递成功（接收端可观察）。
- 变更 B：`adb shell dumpsys activity services com.vibecoding.life` 可见前台服务；常驻通知展示；灭屏 2 小时后到点 webhook 投递成功；停止服务后回退现状。
- 对照组：未启用时同条件投递失败（如实记录失败率，不造假数据）。

## 决策点（待用户确认）
1. 变更 A 白名单状态检测：自写轻量 Expo Module（推荐）vs 社区库？
2. 变更 B 依赖：notifee（快，需实测共存）vs 自写 Expo Module（可控，成本高）？
3. 变更 B 是否需要应用层开关（若需要 → schema v12 addColumns app_settings 新列；若不需要 → 有网络渠道提醒即自动启用）？
4. 切片编号：暂定 slice-20，排任务时可调。

## 确认记录

（2026-11-13，阶段 1 复核会话确认；本文其余章节为提案原文，以下为确认结论。）

- **决策点 1（白名单状态检测）**：自写轻量本地 Expo Module。理由：`Linking.sendIntent` 不支持设置 intent data URI（授权弹窗 intent 必须携带 `package:` 数据），`expo-intent-launcher` 能发弹窗但状态检测仍缺 API，均需自写检测；本地模块路径已有 `modules/widget-snapshot-store` 注册先例。落地：`modules/battery-optimization`（Kotlin：`PowerManager.isIgnoringBatteryOptimizations` + 官方 `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` data URI 弹窗 + `ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS` 降级页），JS 封装 `src/system/batteryOptimization.ts`。
- **决策点 2 / 3（变更 B 依赖与应用层开关）**：变更 B（前台服务）整体移出本切片。依据 AGENTS §7.31 收口：「不引入 WorkManager 或前台服务（Foreground Service）」，本切片仅落地变更 A；变更 B 的依赖选型与开关决策随其延后到后续切片再议。本切片不触碰 src/notifications/ 实现文件。
- **决策点 4（切片编号）**：定稿 slice-20。
- **复核修正（权限声明位置）**：不采纳提案原文「app.json android.permissions 声明」——android/ 已 checked in（bare 工作流），android.permissions 是完整权限集声明，未来 prebuild 时会整体替换默认权限集（§5 风险）；改为仅在 AndroidManifest.xml 手工追加 `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` + 切片注释（沿用切片 9/10 manifest 手工同步惯例）。
- **复核修正（封装落位）**：原生调用封装落 `src/system/`（不进 src/notifications/ 冻结区；冻结区解禁仅待后续变更 B 切片按 §7.17 流程另行提案）。
- **变更 A 降级链定稿**：弹窗 intent 发出失败（ROM 剥离）→ 跳 `ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS` 系统设置页 → 仍失败返回 unavailable；helper 结果类型 `'dialog' | 'settings-fallback' | 'unavailable'`，UI 层（阶段 2）按结果区分文案。

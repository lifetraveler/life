# 切片 20：网络渠道后台可靠性（电池优化白名单）

## 目标
1. 申请并引导用户加入 Android 电池优化白名单，防止 App 在后台被杀导致 Webhook 定时器失效。
2. 验证加入白名单后，App 后台长驻定时器的触发情况。
3. 完善相关原生配置与 UI 引导。

## 强制实施阶段

### 阶段 1：变更提案确认与原生配置
- **提案复核**：检查 `docs/proposals/slice-20-network-channel-reliability.md` 的内容，向用户输出最终的执行方案（特别是权限声明与包名）。
- 在 `android/app/src/main/AndroidManifest.xml` 中声明 `<uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />`。
- 编写纯 TS 的原生调用封装（如使用 Expo 的 `Linking` 发送 Intent，或者手写轻量 Native Module）。如果使用 Intent，需确认当前 Expo SDK 下 `Linking.sendIntent` 或 `IntentLauncher` 的兼容性。

### 阶段 2：UI 引导与设置页接入
- 在 `src/app/settings/` 下新建“后台运行保障”页面。
- 调用相关 API 检查当前 App 是否已在电池优化白名单中。
- 若不在，展示说明文本和“去开启”按钮。点击按钮唤起系统弹窗（`ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`）。
- 若已在，展示已开启的状态。
- 在“我的” Tab 增加入口。

### 阶段 3：真机联调与后台验证
- 构建并安装新的 dev client。
- 设置一条 5 分钟后触发的 Webhook 提醒。
- 将 App 切到后台（不要杀掉，只是切后台），锁屏。
- 5 分钟后验证 Webhook 是否成功发送。
- 测试取消白名单后，切后台被系统冻结时的情况（作为对比）。

## 验收标准
1. tsc 和 jest 全过。
2. 真机检查：能够成功唤起系统的“忽略电池优化”授权弹窗。
3. 真机检查：授权后，设置页面正确显示“已开启”状态。
4. 核心业务验证：App 切后台/锁屏 5 分钟后，Webhook 正常发送（证明进程存活且定时器未被冻结）。
5. 代码检查：无 `as any`，未引入 WorkManager 等重型后台任务依赖。

## 验收记录（v0.20 实测修订，用户确认按 A 口径）

实测平台：MuMu 模拟器（Android 15，127.0.0.1:16384），用户改用模拟器联调（真机未插）。

| 验收项 | 结果 |
| --- | --- |
| 1 tsc/jest | ✅ tsc 通过；jest 71 套件 / 918 用例全过（1782e04） |
| 2 授权弹窗 | ✅（MuMu 档）设置页「去开启」唤起系统弹窗，允许后 `dumpsys deviceidle whitelist` 含本应用 |
| 3 状态显示 | ✅（MuMu 档）「未开启/已开启」为原生 `isIgnoringBatteryOptimizations` 真实返回；授权后 1s 轮询自动刷新；摘除指引展示 |
| 4 后台 5 分钟送达 | ⚠️ **口径修订（见下）**：进程存活保障 ✅、回前台秒级补发 ✅；后台即时送达 ❌（平台机制，非本切片可修） |
| 5 代码检查 | ✅ 无 `as any`；未引入 WorkManager/前台服务 |

**验收 4 实测与修订**（两轮对照，详见 closeout）：
- 第 1 轮（白名单✓，冻结器默认开）：后台 75 秒后进程被 Android 缓存应用冻结器（cgroup freezer）冻结，早于触发时刻 → JS 定时器未执行；前台化解冻后 3 秒内补发到达。
- 第 2 轮（白名单✓，`cached_apps_freezer=disabled`）：进程未冻结，RN JS 定时器仍不开火（RN Android 退后台无 Choreographer 帧 → 定时器队列停摆）；同刻系统通知渠道经 OS 调度准时送达。
- **修订后口径**：本切片交付的「白名单」价值 = 进程不被杀 + 内存挂起 Timer 完好 + 回前台立即补发（迟到 timer 立即开火 + reconcile 补发）。「后台即时送达」需要进程存活**且未冻结**且 **RN 处于前台**三条件同时成立，属于变更B（后续切片）须重新设计的命题——前台服务仅保进程，救不了 RN JS 定时器，后续提案需评估原生 AlarmManager 驱动投递或 Headless 唤醒。
- **遗留缺陷披露（非本切片范围）**：回前台时「迟到 timer 补发」与「启动 reconcile」并发导致同 occurrenceKey 重复投递（两轮均复现，间隔 ~70ms）。根因：投递完成后才 `recordAttempt`（BaseNetworkChannel.ts:60-74），`ReminderScheduler.ts:591` 仅抑制 `'ok'`。修复方向 = 派发前记 in-flight 标记；`src/notifications/` 为冻结区，留切片 11/21。

## 分支与提交
- 从最新 main 新建 `task/slice-20`。
- 由于修改了 AndroidManifest 并可能需要引入原生 Intent 模块，必须重新构建 dev client。
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

## 分支与提交
- 从最新 main 新建 `task/slice-20`。
- 由于修改了 AndroidManifest 并可能需要引入原生 Intent 模块，必须重新构建 dev client。
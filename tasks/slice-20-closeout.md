# tasks/slice-20-closeout.md — 切片 20 收尾移交（§7.10）

切片 20：网络渠道后台可靠性——电池优化白名单（AGENTS.md v0.20 §7.31，仅变更 A；变更 B 前台服务留后续）。
分支 `task/slice-20`；提交链：2fa1a79 立项（AGENTS v0.20 + 任务卡）→ f568e25 阶段 1（manifest 权限 + 本地模块 battery-optimization + src/system helper + 提案确认记录）→ 1782e04 阶段 2（后台运行保障设置页 + 我的 Tab 入口）→ 本提交（closeout + 任务卡验收记录 + AGENTS §8）。

## 环境事实
- Windows 原生 bash（无 MSYS）；npm；jest preset=jest-expo；本切片无 schema 变更、无新 npm 依赖（新增的是本地 Expo Module `modules/battery-optimization`，不走 package.json）。
- 阶段 3 联调平台：MuMu 模拟器（Android 15，127.0.0.1:16384，com.vibecoding.life）——用户指示改用模拟器，真机档未执行（未插）。
- JAVA_HOME 陷阱：shell 默认 `C:\code\runtime\java\jdk\jdk-17.0.8.1-full` 已失效，gradle 构建必须显式 `JAVA_HOME=D:\enviroment\java\jdk\oracle-jdk-17.0.10`。
- push 走代理 + HTTP/1.1：`git -c http.proxy=http://172.16.100.254:7893 -c http.version=HTTP/1.1 push`。
- `npx expo-doctor`：2 失败为预存基线（android/ CNG 同步提示、RN Directory 元数据），非本切片引入。
- aapt 位于 `D:\Android\Sdk\build-tools\36.0.0`（APK manifest/内容核查用）。

## 数据库/构建事实
- **无 schema 变更**；无 `as any`；新增文件零 `any`。
- AndroidManifest.xml 手工同步（不写 app.json android.permissions，避免未来 prebuild 整体替换默认权限集）：`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`（normal 权限）+ 切片注释块。
- 新本地 Expo Module 构建顺序（首次新增模块后）：`rm -rf node_modules/expo/android/build` → `gradlew :expo:generatePackagesList` → `gradlew :app:assembleDebug`；否则 ExpoModulesPackageList 不含新模块。
- 验证基线：`npx tsc --noEmit` 每次提交前 0 错误；`npx jest --runInBand` 阶段 1 后 **71 套件/917 用例**，阶段 2 后 **71 套件/918 用例**全过；assembleDebug SUCCESS 52s；aapt 确认合并 APK manifest 含白名单权限且日历权限无损。
- **Release APK（用户要求交付，commit 外产物）**：`gradlew :app:assembleRelease`（JAVA_HOME 同上）SUCCESS 2m24s → `android/app/build/outputs/apk/release/app-release.apk`（103MB universal 4-ABI，versionName 0.1.0，minSdk 24 / targetSdk 36）。签名=模板默认 debug keystore（build.gradle release 块 `signingConfig signingConfigs.debug`）；minify 默认关（gradle.properties 无 enableMinifyInReleaseBuilds）；`assets/index.android.bundle`（Hermes）已嵌入，libwatermelondb-jsi.so 在位；aapt 确认 `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` 权限在 APK 内。MuMu 烟测：release 包无 metro 独立启动，MainActivity 前台，WatermelonDB 数据正常渲染；烟测后已装回 dev client（app-debug.apk）恢复开发环境。
- MuMu 测试基建：webhook 接收端 node 脚本（0.0.0.0:18999 恒回 200，日志 C:\Users\Public\webhook-receiver-s20.log）；`adb reverse tcp:18999` + `tcp:8081`；uiautomator dump→input tap 驱动 UI。

## 代码地图
- **原生**：android/app/src/main/AndroidManifest.xml（+权限）；modules/battery-optimization/（package.json、expo-module.config.json、android/build.gradle、index.ts、android/src/main/java/com/vibecoding/life/batteryoptimization/BatteryOptimizationModule.kt）——Kotlin：`isIgnoring`（PowerManager.isIgnoringBatteryOptimizations）、`requestIgnore`（ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS + `package:` data URI + FLAG_ACTIVITY_NEW_TASK）、`openSettings`（ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS）；startActivity catch ActivityNotFoundException→false。
- **系统封装**：src/system/batteryOptimization.ts——`isIgnoringBatteryOptimizations()`、`requestIgnoreBatteryOptimizations(): Promise<'dialog'|'settings-fallback'|'unavailable'>`（requestIgnore true→dialog；false→openSettings true→settings-fallback；否则 unavailable）、`openBatteryOptimizationSettings()`。
- **UI**：src/app/settings/background-reliability.tsx（白名单状态卡 + 如实风险文案 + 「去开启」弹窗申请 + 系统设置页降级 + 摘除指引；刷新三路 = useFocusEffect + AppState active + 弹窗后 1s×30s 短轮询——dialog 型 activity 仅 onPause/onResume，JS 无事件可观察，不引入原生 ActivityResult 复杂度）；src/app/(tabs)/profile.tsx（navRow「后台运行保障」入口）。
- **测试**：src/system/__tests__/batteryOptimization.test.ts（5 用例，mock 原生模块三分支 + 设置页降级）。
- **文档**：docs/proposals/slice-20-network-channel-reliability.md（确认记录：4 决策点 + 2 复核修正 + 降级链）；tasks/slice-20.md（验收记录：A 口径修订）。

## 踩坑教训
1. `jest.fn<() => boolean>()` 单泛型在 @types/jest 29 报 TS2743 → 双泛型 `jest.fn<boolean, []>()`。
2. jest.mock 工厂在 import 求值期执行，引用外层 const 得 undefined → 工厂内联 jest.fn，测试内用 `jest.requireMock<{default:…}>(path).default` 取 handle。
3. 非交互 bash 下新原生模块要先 `rm -rf node_modules/expo/android/build && gradlew :expo:generatePackagesList` 再 assembleDebug（见构建事实）。
4. Windows 原生 bash `cmd //c` 进交互模式 → `cmd /c`。
5. 8081 被僵尸 metro（残留进程 2.3GB 不响应）占用 → taskkill /F 后重启；`expo start --no-interactive` 非合法 flag 会秒退；MuMu dev client 启动先弹 dev 菜单抽屉 → `input keyevent 4` 关闭。
6. 电池优化白名单 ≠ 免冻（机制发现详见遗留披露）：Android 11+ 缓存应用冻结器是独立机制。

## 验收实证
- 验收 1：tsc 0 错误；jest 71/918 全过（1782e04）。
- 验收 2（MuMu 档）：设置页「去开启」唤起系统弹窗「要允许应用一直在后台运行吗？」，允许后 `dumpsys deviceidle whitelist` 含 com.vibecoding.life。
- 验收 3（MuMu 档）：状态卡「未开启/已开启」为原生真实返回；授权后 1s 轮询自动翻绿；摘除指引展示。
- 验收 4：⚠️ 口径修订（用户确认按 A）——两轮 MuMu 实测证明「后台即时送达」不可达（平台机制，详见遗留披露）；修订后口径 = 白名单授予/检测/UI/弹窗 + 进程存活保障 + 回前台秒级补发，均通过。修订全文见 tasks/slice-20.md「验收记录」。
- 验收 5：无 `as any`；未引入 WorkManager/前台服务。

## 遗留披露
1. **三条机制级发现（变更 B 提案的核心输入）**：
   - 电池优化白名单不豁免 Android 11+ 缓存应用冻结器（cgroup freezer），两套机制独立；MuMu（Android 15）后台约 75 秒冻结进程。
   - 冻结器只是第一层墙：关冻结器后进程未冻结，RN Android JS 定时器仍不开火——JS 定时器跑在 Choreographer 帧回调上，退后台无帧即停摆（host-pause 语义，RN 框架行为）。「后台即时送达」需进程存活 + 未冻结 + RN 前台三条件同时成立。
   - 白名单真实价值：进程不被杀 → 内存挂起 Timer 完好 → 回前台秒级补发（迟到 timer 立即开火 + reconcile 补发）。系统通知渠道经 OS AlarmManager 后台准时（与 §7.26 设计一致）。
   - **推论：变更 B 前台服务仅保进程，救不了 RN JS 定时器**——后续提案需重估为原生 AlarmManager 驱动投递（原生侧 HTTP）或 Headless 唤醒。
2. **🐛 重复投递缺陷（冻结区，不修留切片 11/21）**：回前台时「迟到 timer 补发」与「启动 reconcile」并发 → 同 occurrenceKey 双 POST（两轮复现，间隔 ~70ms）。根因：投递完成后才 recordAttempt（src/notifications/channels/BaseNetworkChannel.ts:60-74），ReminderScheduler.ts:591 仅抑制 attemptStatus==='ok'，竞态窗口内双发。修复方向 = 派发前记 in-flight 标记。
3. 验收 2/3 真机档未执行（用户改用 MuMu）；release APK 交付后可由用户真机日常使用覆盖确认。
4. expo-doctor 2 项预存警告延续基线，未处理。

## 后续切片候选
1. **网络渠道后台送达可靠性变更 B（提案重估）**：前台服务 → 原生 AlarmManager 驱动投递或 Headless 唤醒；须携带本 closeout 遗留披露 1/2。
2. 重复投递去重（in-flight 标记，src/notifications/ 冻结区，随切片 11/21）。
3. release 签名与 ABI 拆分（目前 debug keystore + universal 103MB，个人使用无碍，正式分发前需自有 keystore）。

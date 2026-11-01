# 切片 1 交接文档（写于 2026-11-01 04:00，上下文将满，由上一会话移交）

> 给下一个会话：先读 `AGENTS.md`、`tasks/slice-01.md`（任务卡），再读本文件。规则照旧：一次只做一个切片；不碰受保护契约；验收命令必须真实执行。

## 1. 项目状态一句话
代码 100% 落盘；机器可跑的验收 3/4 通过（npm install / tsc / expo-doctor）；剩最后两步：装 Android SDK → 构建装进 MuMu 模拟器跑手动验收 a–d。

## 2. 已落盘文件（18 个，全部验证过）
- **配置**：`package.json`（deps: @morrowdigital/watermelondb-expo-plugin 2.4.0-beta.0、@nozbe/watermelondb 0.28.0、expo ~54.0.0 实装 54.0.38、expo-build-properties ~1.0.10、react 19.1.0、**react-dom 19.1.0（为修 ERESOLVE 后加，用户确认过）**、react-native 0.81.5、safe-area-context ~5.6.0、screens ~4.16.0、expo-router ~6.0.0；scripts 含 typecheck）；`app.json`（scheme life；newArchEnabled true；android package com.vibecoding.life；plugins: expo-router / ["@morrowdigital/watermelondb-expo-plugin",{disableJsi:false}] / ["expo-build-properties",{android:{packagingOptions:{pickFirst:["**/libc++_shared.so"]}}}]）；`babel.config.js`（legacy decorators）；`tsconfig.json`（strict + experimentalDecorators）；`eas.json`（development profile，apk）；`.gitignore`
- **源码**：`src/domain/item.ts`（纯类型）；`src/db/schema.ts`（SCHEMA_VERSION=1，items 表）；`src/db/models/ItemModel.ts`（@text/@date 装饰器）；`src/db/migrations.ts`（空占位）；`src/db/polyfills.ts`（performance.now 修复）；`src/db/database.ts`（SQLiteAdapter jsi:true）；`src/data/ItemRepository.ts`（**契约签名 createItem/listItems + 透明扩展 observeItems(onNext): ()=>void——最终报告必须披露此扩展**）；`src/data/WatermelonItemRepository.ts`（title 空则 throw；status 固定 'active'；observeItems 按 created_at desc 推送）；`src/data/index.ts`；`src/app/_layout.tsx`；`src/app/index.tsx`（输入 + note/task/event 选择 + FlatList，useEffect 订阅 observeItems）
- **工具脚本**（报告后可清理）：`verify.ps1`、`check-android-env.ps1`、`check-android-env2.ps1` 及各自 .log

## 3. 验证结果（已真实执行）
| 项 | 结果 |
|---|---|
| npm install | ✅ added 703 packages |
| npx expo install --fix | ✅ Dependencies are up to date |
| npx tsc --noEmit | ✅ 零错误（tsc.log） |
| npx expo-doctor | ✅ 17/18；唯一失败项=RN Directory 信息级 warning 两条（WatermelonDB 未标注 New Arch 测试、@nozbe/simdjson 无元数据），**不屏蔽**，最终报告逐条说明 |
| 源码 any / as unknown as 扫描 | ✅ 零命中（正式结论留给收尾审查 subagent） |
| node_modules 实测版本 | ✅ expo-build-properties 1.0.10 / safe-area-context 5.6.2 / screens 4.16.0 |

ERESOLVE 事故记录：expo --fix 升 3 包时 npm 给 expo-router 的 peerOptional react-dom 抓了最新 19.3.1（peer react@^19.3.1）与 react@19.1.0 冲突 → 解决：显式加 react-dom@19.1.0（SDK 54 官方配对，Expo 模板原样）。

## 4. 本机环境事实（关键！）
- **DSH 宿主 shell**：普通沙箱模式每次进程启动即崩 0xC0000002（6 次复现、跨 DSH 重启）→ **已验证：ops_bash 带 `sandbox_permissions: "danger-full-access"` 时正常**，且路由到 bash（Git Bash 语法，不是 PowerShell！）。**所有命令执行都走这条路，每次必须带 justification**（用户已预授权并要求自主处理）。用户装的 dsh-bash-native 插件未改变现状（ops_discover_tools 搜不到，普通模式仍崩）。
- ops 文件搜索（glob/grep）**永远排除 node_modules** → 查 node_modules 一律用 bash。
- **JDK**：jabba 管理。bash 里 java 不在 PATH（profile 不加载），用绝对路径：`export JAVA_HOME=/d/enviroment/java/jdk/oracle-jdk-17.0.10; export PATH="$JAVA_HOME/bin:$PATH"`。java -version 已验证 = Oracle JDK 17.0.10 ✓。JAVA_TOOL_OPTIONS=-Dfile.encoding=UTF-8 全局已设（无害）。
- **模拟器：MuMu 12**（不是 AVD，用户误选过），Android 12 x86_64，adb 端口 16384，`adb connect 127.0.0.1:16384` 已成功（device 状态）。若掉线重连即可。
- 本机**无 Android Studio、无 SDK**（ANDROID_HOME 空）；磁盘 C: 69G 空 / D: 60G 空。
- 用户全局 npmrc 有 4 个未知配置项 → npm warn，无害。
- 任务卡要求"真机"验收 → **用户选择用模拟器替代**，最终报告必须注明此偏差（SQLite 杀进程持久化语义与真机相同，用户已认可）。

## 5. WatermelonDB 0.28 原生分发（重要新发现，未完全证实）
- npm 包里**没有 android/ 目录**（只有 Watermelondb.podspec + native/ + react-native.config.js）→ Android 原生层大概率是**预编译 AAR 走 Maven**，由 @morrowdigital 插件在 prebuild 时注入 maven 依赖 + pickFirst（这正好解释 build-properties 里 pickFirst libc++_shared.so 的由来）。
- **推论：很可能不需要 NDK/CMake**（读取 withWatermelon.js 的调用被中断，未证实）。下一会话第一步：`cat node_modules/@morrowdigital/watermelondb-expo-plugin/build/withWatermelon.js` 和 `cat node_modules/@nozbe/watermelondb/react-native.config.js` 确认，再定 sdkmanager 清单。
- 若 gradle 仍要 NDK：RN 0.81 默认 27.1.12297006；licenses 接受后 gradle 会自动下载缺失组件。

## 6. 下一步（按序执行）
1. （读）上面两个文件 → 定 SDK 安装清单
2. （装）SDK 到 `D:\Android\Sdk`：下载 `https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip` → 解压到 `D:\Android\Sdk\cmdline-tools\latest` → `sdkmanager --licenses`（管道 y×30）→ 安装 "platform-tools" "platforms;android-36" "build-tools;36.0.0"（+视第 1 步结论加 ndk/cmake）→ `setx ANDROID_HOME D:\Android\Sdk`。**建议写成 .sh 用 run_in_background + job_output 监控**（全程 10-30 分钟），tee 到 sdk-install.log
3. （连）`adb connect 127.0.0.1:16384`；`adb shell getprop ro.build.version.release` 确认设备
4. （建）export JAVA_HOME/ANDROID_HOME/PATH 后 `npx expo run:android`——首跑=prebuild 生成 android/（受保护配置第一次实战）+ gradle 构建 10-30 分钟；后台作业 + tee gradle-build.log，盯 "BUILD SUCCESSFUL"。**gradle 失败时按 AGENTS.md §5：输出错误日志 + 最小变更提案，不得自行重写受保护配置**
5. （验收）app 装进 MuMu 后手动步骤 a–d：a) 建 note"切片1验收" b) 杀进程重开（`adb shell am force-stop com.vibecoding.life` 后重开）c) 列表仍在且 type 正确 d) 再建 task 共两条。用户点击操作，我记录每步观察
6. （收尾）独立审查 subagent 复查契约（无 any/as any、UI 不直接 import database/model、受保护配置完整）→ 最终报告按任务卡"完成后输出"格式：文件列表 / 命令结果 / 模拟器每步观察 / 风险项 / 未触碰受保护契约声明 / observeItems 扩展披露

## 7. 已挂起小项
- withWatermelon.js 读取被中断（只读，可安全重试）
- Metro 长驻：expo run:android 阻塞属正常（dev server），验收完 Ctrl+C
- sdk-install.log / gradle-build.log 等日志留在工程根目录供分析

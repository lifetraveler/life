# 切片 1 收尾移交（Close-out Handoff）

> 生成于切片 1 正式关闭时。切片 2 新会话按 AGENTS.md §7.1 读 AGENTS.md（v0.2，含 §4.4–4.6 Tag 契约）+ tasks/slice-02.md，本文件只补充环境事实与教训，不改变任何契约。
> 验收结论：切片 1 全部验收标准通过，报告已交付。证据截图在 `acceptance/`（step0 打开 / stepa 保存 / stepc 重启仍在 / stepd 两条记录）。

## 环境事实（实测，勿重查）

- JDK：Oracle 17.0.10，`D:\enviroment\java\jdk\oracle-jdk-17.0.10`（构建前 export JAVA_HOME）。
- Android SDK：`D:\Android\Sdk`（ANDROID_HOME 已 setx 持久化）；组件 platform-tools 37.0.1 / android-36 / build-tools 36.0.0+35(gradle 自动补装) / NDK 27.1.12297006 / CMake 3.22.1。 licenses 已全接受。
- 模拟器：MuMu 12，装在 `E:\Program Files\Netease\MuMu`；adb 用 `E:\Program Files\Netease\MuMu\nx_device\15.0\shell\adb.exe`（D:\Android\Sdk\platform-tools\adb.exe 也可连）；设备 `127.0.0.1:16384`，实测 Android 15（handoff 里"Android 12"过时）。
- app：`com.vibecoding.life`，versionName 0.1.0，dev client 拉起 URL `exp+life://expo-development-client/?url=http%3A%2F%2F172.16.100.112%3A8081`。
- 构建：`npx expo run:android`（SDK 31 起无需再 export ANDROID_HOME，但保险起见 export JAVA_HOME + ANDROID_HOME），首次 BUILD SUCCESSFUL 10m52s；之后增量构建快得多。构建脚本已随清理删除，直接跑命令即可。

## 数据库事实（切片 2 验收要用）

- JSI 适配器把库放在 app 数据**根目录**：`/data/data/com.vibecoding.life/life.db`（+ `-shm`/`-wal`，WAL 模式）——**不在 databases/ 子目录**。
- 现存数据：两条记录（note「切片1验收」、task「切片1任务」），切片 2 覆盖安装后它们必须仍在（验收标准 3）。
- 查库方法：`adb -s 127.0.0.1:16384 shell run-as com.vibecoding.life cat life.db life.db-wal` 后 grep（无设备端 sqlite3）。

## 踩坑教训

1. **MSYS 路径转换**：git-bash 里给 adb shell 传 `/data/data/...` 绝对路径会被改写成 Windows 路径导致 run-as 失败 → adb shell 内一律用**相对路径**（run-as 后 cwd 即 app 数据目录）。
2. MuMu 时区=UTC，列表时间显示比本地晚 8 小时，非代码问题；报告注明即可。
3. expo-doctor 在 android/ 目录存在后会出现"app config fields may not be synced in non-CNG project"信息级提示（16/18），属 prebuild 工作流预期状态，非回归。
4. WatermelonDB 0.28 Android：主库纯 Java 自动链接；JSI 部分靠 @morrowdigital 插件注入 `:watermelondb-jsi`（CMake）；`ndkVersion` 由 ExpoRootProjectPlugin.kt versionCatalog 供给（27.1.12297006）。受保护配置勿动。

## 切片 1 遗留披露（原样带入最终报告）

- `observeItems(onNext): () => void` 为 §4.2 契约外扩展（ItemRepository.ts:14 / WatermelonItemRepository.ts:55，源码注释已声明理由）。
- babel.config.js 未含可选 `@nozbe/watermelondb/babel` 性能插件（WARN，非必需）。
- ItemModel.ts 定值断言 `!:` 为 WatermelonDB 装饰器标准写法，非 any 违规。
- 根目录遗留脚本/日志已于关闭时清理（删 5 脚本 + 11 日志）；`acceptance/` 保留作验收证据。

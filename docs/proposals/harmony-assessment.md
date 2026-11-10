# HarmonyOS NEXT 可行性评估报告（切片 13）

- 切片：task/slice-13（AGENTS.md v0.13 §7.20）
- 日期：2026-11-07
- 性质：纯桌面调研（联网取证 + 本仓库依赖清单比对），未做真机验证、未编译 RNOH 工程、未运行任何鸿蒙侧代码。
- 证据截止：2026-11-07（npm 元数据、华为开发者官网 API 文档、OpenHarmony-RN 社区文档镜像均为当日观测值）。

## 1. 结论速览（TL;DR）

**总评：当前技术栈（Expo SDK 54 / RN 0.81.5）不存在可直接落地的鸿蒙迁移路径。鸿蒙 RN 生态处于「能跑通 Demo、不能承载生产应用」的早期阶段（α）。**

三条候选路线的判定：

| 路线 | 判定 | 一句话理由 |
| --- | --- | --- |
| A. 等待社区工具链兼容 SDK 54 | **不可行** | 两条工具链基线均为 SDK 55 且明确不支持 54；RNOH 根本没有 RN 0.81 的版本线，无人会回头补 54 |
| B. 升级到 SDK 55 再转鸿蒙 | **唯一渐进可行路径**，成本数周～数月 | 生态全部证据（工具链、RNOH、WatermelonDB 适配）都落在 RN 0.82/0.83/0.84 线上 |
| C. ArkTS 重写原生壳、仅共享领域逻辑 | 成本最高，**仅当鸿蒙成为一级市场时考虑** | 全部 UI/通知/卡片/日历重写，只有 `src/domain/` 纯 TS 可复用 |

**建议：现阶段不投入鸿蒙适配。** 设定三个重新评估触发条件（见 §7），条件满足前本报告无后续工程切片。

## 2. 评估方法

1. 比对本仓库实际依赖（package.json / app.json 实测，见附录 B）。
2. 联网取证鸿蒙 RN 生态：两条 Expo→Harmony 工具链（npm 包元数据 + README 能力矩阵）、RNOH 官方版本线、WatermelonDB / op-sqlite 的鸿蒙适配包（OpenHarmony-RN 社区文档）、华为官方 ArkTS API 文档。
3. 将每个依赖映射到「鸿蒙生态现状 → 迁移路径 → 工作量评级」。
4. 按 §7.20 要求给出三路线对比与决策建议。

所有证据 URL 汇总于附录 A。

## 3. 依赖矩阵 × 鸿蒙生态对应

工作量评级：低 = 原样可用或纯 JS；中 = 有适配但有缺口/需少量桥接；高 = 需原生（ArkTS）重写；— = 无适配、需替代方案。

### 3.1 框架层

| 依赖 | 当前版本 | 用途 | 鸿蒙生态现状 | 迁移路径 | 评级 |
| --- | --- | --- | --- | --- | --- |
| expo | ~54.0.0 | 框架基线 | 两条工具链均只支持 SDK 55+，明确不支持 54 | 先升级 SDK 55（路线 B 前提） | 高 |
| react-native | 0.81.5 | 运行时 | RNOH 版本线 0.72.x / 0.77.x / 0.82.x / 0.84.x，**无 0.81** | 随 SDK 55 → RN 0.83.6 | 高 |
| expo-router | ~6.0.0 | 导航 | @oh-expo/expo-harmony 列为 **verified**；toolkit 同级 | 直接可用（工具链内） | 低 |
| expo-linking / expo-constants | 8.0.0 / 18.0.0 | deep link、常量 | 两工具链均 verified | 直接可用 | 低 |
| expo-dev-client | ~6.0.0 | 自定义 dev client | 鸿蒙侧走 RNOH DevEco 工具链，无 expo dev-client 概念 | 改用 DevEco Studio 构建 harmony 工程 | 中 |
| expo-build-properties | ~1.0.10 | gradle/打包属性（libc++_shared pickFirst） | Android 专用；鸿蒙侧 CMake/HAR 体系不同 | 鸿蒙壳工程内对应配置重做 | 中 |

### 3.2 数据层（核心风险区，详见 §5.1）

| 依赖 | 当前版本 | 用途 | 鸿蒙生态现状 | 迁移路径 | 评级 |
| --- | --- | --- | --- | --- | --- |
| @nozbe/watermelondb | 0.28.0 | SQLite ORM（JSI 已启用） | 社区适配包 **@react-native-ohos/watermelondb 0.28.2** 存在（基于上游 0.28.1-0），但仅验收 RN 0.72/0.77 + RNOH 0.72.90/0.77.18；jsi:true/false 双模式有官方示例；经 HAR 包 + CMakeLists 接入（非 npm autolink） | 版本线错位：需先落到 RN 0.72/0.77 线（与 SDK 55 的 RN 0.83 冲突）或等适配跟进；7 个内部接口在鸿蒙部分不支持（issue#2 未关闭） | 中-高 |
| @morrowdigital/watermelondb-expo-plugin | 2.4.0-beta.0 | expo plugin 注入 WatermelonDB 构建配置 | 鸿蒙侧无此 plugin 体系 | 手动在 harmony 壳工程接 HAR（社区文档有完整步骤） | 中 |
| （备选）op-sqlite | —（未使用） | 若 WatermelonDB 适配滞后的底层替代 | @react-native-ohos/op-sqlite 8.0.3（RN 0.72）/ 14.0.1（RN 0.77），API 全表 yes（含 sqlcipher 加密） | 换底层引擎=绕开 WatermelonDB 抽象，工程量大，**不作为主路径** | 高（如启用） |

### 3.3 平台能力层

| 依赖 | 当前版本 | 用途 | 鸿蒙生态现状 | 迁移路径 | 评级 |
| --- | --- | --- | --- | --- | --- |
| expo-notifications | ~0.32.17 | 本地定时提醒 | 两工具链均仅 **experimental** | ArkTS 原生：@ohos.reminderAgentManager（后台代理提醒，ReminderRequestCalendar 按日历时间发布；需 ohos.permission.PUBLISH_AGENT_REMINDER）。本项目 ReminderScheduler 抽象（UI 不直接 import expo-notifications）使重写收敛在 src/notifications/ 实现层 | 中 |
| expo-calendar | ~15.0.8 | 系统日历只读导入 | 无适配（两工具链矩阵均未列出） | ArkTS 原生：Calendar Kit @ohos.calendarManager。只读语义（§7.15）可平移；权限模型与 Android 不同，需原生桥接 | 中 |
| expo-file-system | ~19.0.24 | 导出文件落盘 | @oh-expo 列为 **preview**；toolkit 同级 | preview 级可用性需 PoC 验证；导出链路较薄，必要时换 OHOS 文件 API | 中 |
| expo-sharing | ~14.0.8 | 导出分享 | 无适配 | OHOS 侧分享/另存走系统能力（chooser/文件管理器），原生桥接 | 中 |
| expo-crypto | ~15.0.9 | sourceUid SHA-256 | 无适配记录 | 可降级为纯 JS 实现（如 js-sha256 类）或 OHOS cryptoFramework 桥接；数据量小，影响低 | 低-中 |
| expo-document-picker | ~14.0.8 | ICS 导入选文件 | 无适配 | OHOS 文件选择器（ArkTS startAbility 文件Picker）桥接 | 中 |
| expo-localization | ~17.0.9 | 语言 | @oh-expo 未列出 verified/preview | OHOS 走 i18n 系统（@ohos.i18n）或纯 JS 方案；项目已有 @formatjs 8.x，可弱化依赖 | 中 |

### 3.4 桌面小组件（核心风险区，详见 §5.2）

| 依赖 | 当前版本 | 用途 | 鸿蒙生态现状 | 迁移路径 | 评级 |
| --- | --- | --- | --- | --- | --- |
| react-native-android-widget | ^0.26.0 | TodayWidget（4x2 快照列表 + 快速记录入口） | **无鸿蒙移植**。RNOH usage-docs 无任何 widget 类库索引；两条工具链矩阵均未收录 | Form Kit 服务卡片（@ohos.app.form.FormExtensionAbility）ArkTS 重写；「App 写快照 → 卡片读快照」桥接设计可平移（SharedPreferences → @ohos.data.preferences） | 高 |

### 3.5 UI / 第三方 RN 组件

| 依赖 | 当前版本 | 鸿蒙生态现状 | 评级 |
| --- | --- | --- | --- |
| react-native-screens | ~4.16.0 | toolkit 列 **experimental**；RNOH usage-docs 有文档索引 | 中 |
| react-native-safe-area-context | ~5.6.0 | 同上（experimental + 有文档） | 中 |
| @react-native-community/datetimepicker | ^8.4.4 | RNOH usage-docs 侧栏有该库文档索引 | 中 |
| （无直依赖，但 RNOH 文档覆盖）reanimated / svg / gesture-handler / webview | — | @oh-expo：reanimated、svg verified，gesture-handler preview，webview experimental | 低-中 |

### 3.6 纯 JS 依赖（无原生面，可原样复用）

| 依赖 | 版本 | 说明 |
| --- | --- | --- |
| @date-fns/tz | ^1.5.0 | 纯 JS 时区；DST gap/fold 契约（§4.11–4.15）在鸿蒙原样成立 |
| ical.js | ^2.2.1 | 纯 JS ICS 解析 |
| @formatjs/* | 8.x | 纯 JS 国际化 |
| react / react 19.1.0 | — | JS 层随工具链版本走（鸿蒙侧工具链用 react-harmony 别名） |
| jest-expo | ~54.0.18 | 测试链不涉及鸿蒙运行时，升级时随 SDK 走 |

**矩阵小结：** 全部依赖中，只有导航/常量/linking/reanimated/svg 这一圈（约 5 个包）在鸿蒙侧达到 verified；数据层适配存在但版本线错位；平台能力层一半靠 ArkTS 原生重写；widget 是完全重写。**「verified 覆盖率」约等于一个最小 router demo 的依赖面，距本应用的实际依赖面差一个量级。**

## 4. 社区工具链成熟度

### 4.1 两条 Expo→Harmony 工具链对比（2026-11-07 观测）

| 维度 | @oh-expo/expo-harmony | expo-harmony-toolkit |
| --- | --- | --- |
| npm 版本 | v0.1.1 | v1.11.4 |
| 发布时间 | 约 2 个月前 | 约 3 个月前 |
| 周下载量 | 7 | 48 |
| 仓库 | atomgit.com/OH-Expo/expo-harmony | github.com/BlackishGreen33/Expo-Harmony-Toolkit |
| 基线 | **Expo SDK 55**（expo ~55.0.26）+ RNOH 0.84.1 + RN 0.83.6（iOS/Android 侧） | **Expo SDK 55**（唯一 verified 矩阵 expo55-rnoh082）+ RNOH 0.82.x/0.82.29 + RN 0.82.1 |
| 明确不支持 | SDK 54 | SDK 54 |
| 工作流 | CNG：app.json 为唯一真相源，prebuild 生成 harmony/ 壳；命令 doctor/env/create/init/prebuild/sync/install/scan/bundle/modules | CLI doctor→init→bundle→build-hap；adapter 依赖以 Git URL + exact commit 接入 |
| verified 能力 | expo-router、expo-linking、expo-constants、reanimated(+worklets)、svg | router、linking、constants、reanimated、svg |
| preview 能力 | expo-asset、expo-camera、expo-file-system、expo-font、gesture-handler | file-system、image-picker、location、camera、secure-store、asset、device、clipboard、haptics |
| experimental 能力 | webview、image-picker、location、expo-notifications | expo-notifications、gesture-handler、async-storage、screens、safe-area-context、webview 等 |
| 本项目关键依赖覆盖 | file-system=preview；notifications=experimental；calendar/watermelondb/widget **无** | file-system=preview；notifications/screens/safe-area=experimental；calendar/watermelondb/widget **无** |

### 4.2 成熟度评级：早期（α）

依据：
1. **年龄**：两条工具链均只有 2–3 个月历史，版本号一个 0.1.x、一个 1.1x，均未宣称稳定。
2. **社区规模**：周下载 7 与 48（npm），说明生产使用者极少，坑未被充分暴露。
3. **能力面**：verified 层只有 5 个包（导航+渲染基座），本项目约 25 个原生相关依赖中大多数处于 preview/experimental/无适配。
4. **依赖锁定方式**：toolkit 的 adapter 以 Git URL + exact commit 接入（不走 npm 语义化版本），意味着上游修复不自动到达，升级需手动追 commit。
5. **双 React 共存**等架构级特殊处理（@oh-expo 用 react-harmony 别名解决 RN 0.83 与 RNOH 的 react 版本差异）说明生态尚未收敛出标准答案。

### 4.3 RNOH（React Native for OpenHarmony）本体

- 官方版本线：0.72.x / 0.77.x / 0.82.x / 0.84.x。**没有 0.81**——本项目 RN 0.81.5 恰好落在缺口上。
- RNOH 0.84 Release 已正式发布（华为开发者论坛 2026，主题「架构全面进化」）；两条工具链分别采用 0.84.1 与 0.82.29，佐证 0.82/0.84 是当前活跃线。
- RNOH usage-docs 已覆盖本项目用到的 datetimepicker、screens、safe-area-context、svg、reanimated、webview、gesture-handler 等社区库文档——组件层面文档可用性尚可；但无 watermelondb 索引、无 expo 系列文档。

## 5. 核心难点深潜

### 5.1 WatermelonDB 的 SQLite 底层（数据层最大风险）

**现状（本仓库）：** @nozbe/watermelondb 0.28.0，经 watermelondb-expo-plugin 注入构建配置，JSI 模式开启（app.json 中 disableJsi:false）；模型层大量使用 @relation/@children 装饰器（§5 受保护配置）。

**鸿蒙生态事实：**
1. 适配包存在：`@react-native-ohos/watermelondb` v0.28.2，基于上游 watermelondb@v0.28.1-0——与本项目 0.28.0 同代，**schema/model/迁移代码层面基本可原样迁移**。
2. 但版本验收范围仅 RN 0.72 / 0.77（RNOH 0.72.90 / 0.77.18，HarmonyOS NEXT DB3 与 HarmonyOS 6.0.0 Release）。**本项目 RN 0.81.5 不在其支持范围**，且 RNOH 没有 0.81 线。
3. 两种 JSI 模式（jsi:true / jsi:false）均有官方示例工程，即本项目当前的 JSI 配置在鸿蒙有对应先例。
4. 接入方式与 Android 完全不同：HAR 包（watermelondb.har）+ CMakeLists（rnoh_watermelondb）+ WatermelonDBPackage 注册，expo plugin 体系不适用。
5. 公开 API 绝大部分标注可用（find/observe/create/update/destroy/batch/write/action/withChangesForTables/unsafeResetDatabase/Query.observe/fetchCount/observeCount 等——本项目常用面全部在内）。
6. **遗留缺口**：内部接口 `_fetchQuery`、`_fetchIds`、`_fetchCount`、`_unsafeFetchRaw`、`_fetchRecord`、`_applyChangesToCache`、`_notify` 在鸿蒙标注「部分参数不支持」（社区 issue#2 至今未关闭）。这些是底层缓存/查询通道方法，常规 CRUD 与响应式查询路径不受直接影响，但属于未验证风险——任何迁移 PoC 必须优先跑响应式查询与批量写入压测。
7. 底层替代证据：op-sqlite 的鸿蒙适配（@react-native-ohos/op-sqlite 8.0.3/14.0.1）API 全表 yes（含事务、reactiveExecute、sqlcipher 加密）。若未来 WatermelonDB 鸿蒙适配停滞，技术上存在「换引擎」退路，但要付出绕开 Repository 抽象下 ORM 层的巨大代价，**不建议作为主路径**。

**结论：** 数据层不是「不可行」，而是「版本线错位 + 适配待验证」。它要求迁移必须先落到 RN 0.82/0.83 线（即路线 B 的前提），且 WatermelonDB 适配需跟进到该版本线——截至证据日，适配包最新验收停在 RN 0.77。

### 5.2 react-native-android-widget → Form Kit 服务卡片

**现状（本仓库）：** TodayWidget 4x2（180x110dp），内容为今日待办 top5 快照 + 底部快速记录按钮；数据经 App 侧序列化 JSON 写入 SharedPreferences（键 widget_today_snapshot_v1，§7.16 冻结契约），卡片不直接读 SQLite。

**鸿蒙生态事实：**
1. react-native-android-widget **无鸿蒙移植**（双证据：RNOH usage-docs 侧栏无任何 widget 库；两条工具链能力矩阵均未收录）。其 JS 声明式 widget API 面向 Android RemoteViews 体系，与鸿蒙 ArkTS 卡片体系不通用。
2. 鸿蒙原生对应物是 Form Kit 服务卡片：@ohos.app.form.FormExtensionAbility，卡片 UI 用 ArkTS 声明式写法，与 RN 组件零复用。
3. **可平移的资产**是桥接设计而非实现：「App 进程写快照 → 卡片进程读快照」在鸿蒙侧对应 SharedPreferences → @ohos.data.preferences（应用级 KV 存储），§7.16 的四个写入时机（启动/回前台/数据变更/手动刷新）语义可以一一对应；「卡片不写 DB、完成操作回 App」的约束在鸿蒙侧天然继续成立。
4. deep link（life://quick-add）在鸿蒙有对应机制（App Linking / 自定义 scheme 唤起），快速记录入口约定可保留。

**结论：** widget 是三条路线里工作量最确定的部分——**UI 必须全量 ArkTS 重写**（评级：高），但架构（快照桥接）不需要重新设计。

### 5.3 通知 / 日历（平台能力的代表性难点）

- **通知**：expo-notifications 在两条工具链都只是 experimental，无 verified 承诺。鸿蒙原生对应物是 Background Tasks Kit 的 @ohos.reminderAgentManager（后台代理提醒），ReminderRequestCalendar 支持按日历时间发布提醒，权限为 ohos.permission.PUBLISH_AGENT_REMINDER。**本项目的关键资产**是 ReminderScheduler 抽象（AGENTS.md §2：UI 不得直接 import expo-notifications）——重写面收敛在 src/notifications/ 的调度实现与 reconcile 逻辑，DST gap/fold、occurrenceKey 确定性等契约（§4 系）全部在纯 TS 层原样保留。
- **日历**：expo-calendar 无鸿蒙适配；原生对应 Calendar Kit @ohos.calendarManager。§7.15 的「只读、不写回」语义可映射；权限模型不同（OHOS 权限申请机制），需原生桥接。slice-9 记录的 expo-calendar 15.0.8「读写权限捆绑」怪癖在鸿蒙侧不复存在，但也不再有现成 JS API。

### 5.4 其余平台模块

file-system（preview）、sharing、document-picker、crypto、localization 无 verified 适配：导出/导入链路需要逐一原生桥接或找 JS 替代。这条链路逻辑薄（切片 8/12 已验证的导出流程），桥接工作量可控，但每一项都是新的原生面。

## 6. 三条路线评估

### 6.1 路线 A：等待社区工具链兼容 SDK 54 —— 不可行

| 论据 | 证据 |
| --- | --- |
| 工具链不会回头支持 54 | @oh-expo/expo-harmony README 明确不支持 SDK 54，基线 expo ~55.0.26；toolkit 唯一 verified 矩阵是 expo55-rnoh082。两者的投入方向都在 55+ |
| RNOH 没有 0.81 版本线 | 官方版本线 0.72 / 0.77 / 0.82 / 0.84；从 0.77 直接跳到 0.82，0.81 从未被支持。适配工作以「上游 RN 版本」为单位，不存在「为 54 补 0.81」的动机 |
| Expo 官方把 54 定为节点 | SDK 55（2026-02-25 发布，含 RN 0.83 + React 19.2）移除 Legacy Architecture；SDK 54 是 legacy 终点。生态向 55+ 收敛 |
| 等待无日程承诺 | 工具链均 0.x/早期阶段，issue 与路线图均无「54 支持」条目可跟踪 |

**判定：** 等待不是一个有终点的策略。若项目停在 SDK 54，鸿蒙窗口只会随时间关闭（依赖越老，后续升级跨度越大）。

### 6.2 路线 B：升级到 SDK 55 再转鸿蒙 —— 唯一渐进可行路径

**步骤（四步，每步可独立验收）：**
1. **SDK 54 → 55 升级**（纯 Android/iOS 侧常规升级）：expo ~54→~55，RN 0.81.5→0.83.6，React 19.1→19.2；本项目已开 newArch（newArchEnabled=true），SDK 55 移除 legacy 无阻力；依赖矩阵按 SDK 55 版本表重排。风险与普通 Expo 大版本升级同级。
2. **鸿蒙 PoC 壳**：选定工具链（见下）生成 harmony 工程，跑通 expo-router 导航 + 空 DB 页面 + 真机启动；同时用最小工程验证 WatermelonDB 鸿蒙适配在其声明支持的版本线上的实际表现（重点：响应式查询、批量写入、issue#2 涉及的内部接口路径）。
3. **平台能力桥接**：notifications（reminderAgentManager）、calendar（Calendar Kit）、file/sharing/document-picker（OHOS 文件 API）逐个经桥接接入，复用既有抽象层（ReminderScheduler / Repository）。
4. **服务卡片 ArkTS 重写**：Form Kit 实现 TodayWidget，快照桥接按 §7.16 语义平移到 @ohos.data.preferences。

**工具链选择（届时再定，当前倾向 @oh-expo/expo-harmony）：** @oh-expo 更新（0.84.1 的 RNOH 基线、CNG 工作流与本项目 app.json 驱动的构建方式同构，Android 生产线可保持 app.json 单一真相源）但更年轻（0.1.1，周下载 7）；toolkit 文档更厚、历史略长但基线旧（RNOH 0.82 / RN 0.82.1）且 adapter 走 Git URL 锁定。决定 PoC 时以当时最新版本实测为准。

**成本估算：** 第 1 步数天；第 2 步 1–2 周（含真机验收）；第 3 步 2–4 周（每模块一个原生面）；第 4 步 1–2 周。合计 **6–10 周量级**，且第 2 步存在「WatermelonDB 适配未覆盖 RN 0.83」这一可能导致路线整体延后的单点风险（届时要么等适配，要么临时落 0.72/0.77 旧线双轨）。

**风险：** 工具链 α 期质量；双端回归成本（RN 0.81→0.83 对 Android 现有行为的冲击）；鸿蒙适配包的非 npm 分发（HAR/Git URL）打破现有 lockfile 依赖管理习惯。

### 6.3 路线 C：ArkTS 重写原生壳、仅保留数据同步 —— 成本最高

**可复用面（真实但不宽）：** src/domain/ 纯 TS 领域逻辑（recurrence、DST、normalizeAllDayTimestamps 等）、@date-fns/tz、ical.js、@formatjs——约等于「领域内核 + 数据契约」。schema JSON 与迁移序列（WatermelonDB 侧）可作为迁移时的数据规范参考。

**重写面：** 全部 UI（screens/导航/表单/列表）、WatermelonDB 或其替代的 ArkTS 侧持久层、通知、日历导入、小组件、导出分享、搜索、小组件快照。即除 domain 外的一切。

**成本：** 相当于重做一个应用的壳，仅当鸿蒙成为一级目标市场、且路线 B 被生态阻塞（如工具链停更）时才成立。**当前不构成任何理由选择它**——本项目的架构分层（domain 纯 TS、Repository 抽象、ReminderScheduler 抽象）恰恰是为路线 B 保留复用面而设计的。

## 7. 建议

1. **现阶段不投入鸿蒙适配。** 依据：(a) 两条工具链均不支持本项目 SDK 54，准入门槛是先做一次与鸿蒙无关的 SDK 55 升级；(b) verified 能力面 ≈ 一个 router demo，与本应用 25 个原生相关依赖差一个量级；(c) 数据层适配验收停在 RN 0.77，无法承载当前 0.81.5；(d) widget 必须全量 ArkTS 重写，是独立于 RN 生态的原生工程。
2. **若决定跟进，走路线 B**（先 SDK 55 升级，后鸿蒙 PoC）。路线 A 无终点，路线 C 无必要。SDK 55 升级本身对 Android 现有功能是中风险常规操作，可与鸿蒙决策解耦——即使最终不做鸿蒙，升级也有独立价值（RN 0.81 已不在 RNOH/主流适配视野内）。
3. **重新评估触发条件（满足任一即重开评估）：**
   - @oh-expo/expo-harmony 或 toolkit 的 verified/preview 矩阵覆盖 file-system + notifications + calendar 三件套；
   - @react-native-ohos/watermelondb 适配验收推进到 RN 0.82/0.83 线（与 SDK 55 基线对齐）；
   - 工具链周下载量进入数百量级或出现第二家活跃维护方（生态进入 ≥β 的信号）。
4. **保持现有架构资产**：ReminderScheduler 抽象、Repository 抽象、widget 快照桥接契约、domain 纯 TS 层——这些是未来任何路线下迁移成本的主要压舱物，其价值已被本评估量化（路线 B 的可复用面 vs 路线 C 的重写面之差）。

## 8. 风险与未验证声明

1. 本报告为纯桌面调研：**未在鸿蒙真机运行 RNOH、未编译 harmony 工程、未实测任何适配包**。所有「可用/部分支持」判断均引用社区文档与验收环境描述，非本仓库实测。
2. issue#2（WatermelonDB 内部接口鸿蒙部分不支持）对本项目实际影响面未验证；PoC 阶段必须最先验证。
3. npm 周下载量、发布时间、能力矩阵均为 2026-11-07 单日观测，生态变化快，建议决策前复核附录 A 链接的当日状态。
4. 华为官方文档（Calendar Kit / reminderAgentManager / Form Kit）仅确认 API 存在与权限要求，未评估 API 行为细节与系统版本门槛。
5. 本切片未修改任何源码/依赖/构建配置（验收要求 2）；报告结论不影响现有 Android/iOS 构建路径。

## 附录 A：证据清单

| # | 证据 | 来源 |
| --- | --- | --- |
| 1 | @oh-expo/expo-harmony v0.1.1（基线、能力矩阵、CNG 工作流、不支持 SDK 54） | npm 包页 + atomgit.com/OH-Expo/expo-harmony README（2026-11-07） |
| 2 | expo-harmony-toolkit v1.11.4（verified 矩阵 expo55-rnoh082、能力分级、CLI、Git URL 锁定） | npm 包页 + github.com/BlackishGreen33/Expo-Harmony-Toolkit README（2026-11-07） |
| 3 | @react-native-ohos/watermelondb v0.28.2（RN 0.72/0.77、RNOH 0.72.90/0.77.18 验收环境、jsi 双模式示例、HAR 接入、API 表、issue#2） | OpenHarmony-RN 社区文档 react-native-ohos-library（zh-cn/watermelondb.md，GitHub 镜像 AuroraMaster/react-native-ohos-library）+ gitcode.com/OpenHarmony-RN/rntpc_watermelondb |
| 4 | @react-native-ohos/op-sqlite 8.0.3 / 14.0.1（API 全表 yes） | react-native-ohos-library（en/op-engineering-op-sqlite.md） |
| 5 | RNOH 版本线 0.72/0.77/0.82/0.84（无 0.81）；RNOH 0.84 正式发布 | 华为开发者论坛帖 0201225022072686182 + 两工具链基线佐证 |
| 6 | RNOH usage-docs 组件库覆盖清单（datetimepicker/screens/safe-area-context/svg/reanimated/webview/gesture-handler；无 widget、无 watermelondb 索引） | OpenHarmony-RN usage-docs 侧栏（2026-11-07） |
| 7 | Calendar Kit @ohos.calendarManager | developer.huawei.com/consumer/cn/doc/doccenter-references/api/js-apis-calendarmanager |
| 8 | reminderAgentManager / ReminderRequestCalendar / PUBLISH_AGENT_REMINDER | developer.huawei.com/consumer/cn/doc/harmonyOS-references/js-apis-reminderagentmanager |
| 9 | Form Kit @ohos.app.form.FormExtensionAbility（服务卡片） | developer.huawei.com/consumer/cn/doc/harmonyos-references/js-apis-app-form-formextensionability |
| 10 | Expo SDK 55 发布（2026-02-25，RN 0.83 + React 19.2，legacy 移除，newArchEnabled 从 app.json 移除） | expo.dev/changelog/sdk-55 |
| 11 | 本项目依赖实测版本 | package.json / app.json（附录 B） |

## 附录 B：本项目当前依赖实测清单（package.json，2026-11-07）

- 框架：expo ~54.0.0、react-native 0.81.5、react 19.1.0、expo-router ~6.0.0、expo-dev-client ~6.0.0、expo-build-properties ~1.0.10、expo-constants ~18.0.0、expo-linking ~8.0.0、expo-localization ~17.0.9
- 数据：@nozbe/watermelondb 0.28.0、@morrowdigital/watermelondb-expo-plugin 2.4.0-beta.0
- 平台能力：expo-notifications ~0.32.17、expo-calendar ~15.0.8、expo-file-system ~19.0.24、expo-sharing ~14.0.8、expo-crypto ~15.0.9、expo-document-picker ~14.0.8
- 小组件：react-native-android-widget ^0.26.0
- UI：react-native-screens ~4.16.0、react-native-safe-area-context ~5.6.0、@react-native-community/datetimepicker ^8.4.4
- 纯 JS：@date-fns/tz ^1.5.0、ical.js ^2.2.1、@formatjs/* 8.x
- 测试：jest-expo ~54.0.18
- app.json 要点：newArchEnabled=true；scheme life；android.package com.vibecoding.life；plugins 含 watermelondb-expo-plugin（JSI 开）、react-native-android-widget（TodayWidget 4x2）

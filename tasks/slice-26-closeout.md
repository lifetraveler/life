# 切片 26 收尾移交（closeout）：AI 透明度（提示词查看 + 用量展示）

- 日期：2026-11-17（切片 26 立项 2026-11-16，主体完成于 11-16 深夜至 11-17 凌晨）
- 分支：`task/slice-26`（基点 main @ `91ed33d`，切片 25 后 main 实际 @ `5ed723f`——任务卡 §0 记载基点 `91ed33d` 为立项时 main 快照引用，实际开发起点与合并目标均为 `5ed723f` 后的 main）
- 状态：**全部完成**（阶段 1 + 阶段 2 + 追加阶段 2b + 追加阶段 2c + 阶段 3 真机验收 + closeout）
- 提交索引（时间序）：

| Commit | 内容 |
| --- | --- |
| `d44836b` | feat(s26): 阶段1 域层 usage 管道 + schema v13（AI 透明度）（25 文件 +1137/−42，含 AGENTS v0.28、任务卡） |
| `42e1722` | docs(s26): 阶段 1 反馈总结（§7.33 Phase 1/共 3，commit d44836b） |
| `a29a423` | feat(s26): 阶段2 AI 透明度 UI 三落点 + useFlashChat 用量行接线（6 文件 +413/−10） |
| `2a845c5` | docs(s26): 阶段 2 反馈总结（Phase 2/共 3，commit a29a423） |
| `e532d4f` | feat(s26): 阶段2b AI 配置平台化 + DeepSeek 峰谷分层计价（12 文件 +1110/−59，含提案 docs/proposals/slice-26-ai-config-enhancement.md） |
| `64f8382` | docs(s26): 阶段 2b 反馈总结（Phase 2b/共 3+2b，commit e532d4f） |
| `52e6758` | feat(s26): 阶段2c 每平台独立配置槽（保存即激活 + 使用中徽标）（8 文件 +308/−91） |
| `032cbbe` | docs(s26): 阶段 2c 反馈总结（Phase 2c/共 3，commit 52e6758） |
| （本次） | closeout + backlog 划项 + AGENTS §8 刷新 |

- 阶段反馈文件（§7.33 情形 3）：`tasks/slice-26-phase1-feedback.md` / `-phase2-` / `-phase2b-` / `-phase2c-`（各 72/47/54/51 行，均随 docs(s26) 提交）。

## 〇、交付清单

1. **提示词查看**：`src/app/settings/ai-prompt.tsx` 只读展示 `AI_SYSTEM_PROMPT` 静态规则串（动态拼接部分页面注明不展示）；根 `_layout.tsx` 注册路由；profile 页「AI 提示词」navRow 入口。
2. **用量展示管道**：`src/domain/ai/usage.ts`（新建）——AiUsageSnapshot/AiUsagePrices/positivePriceOrNull/readAiUsageSnapshot/readAiUsageSnapshotTiered/isPeakBeijing/formatAiUsageLine；`OpenAICompatibleProvider.lastUsage` 副通道 getter；`FlashTurnResult.usage` 域内字段；`useFlashChat` 每轮 readTurnSettings + 消息尾用量行（开关 showAiUsage 控制，段缺失自动省略）。
3. **schema v13**：app_settings 加 `show_ai_usage`（boolean 非可选默认 false，v12 careful_mode 同款 addColumns，零 unsafeExecuteSql）。
4. **AI 配置平台化（追加阶段 2b）**：AiProviderConfig 加 `platform` + DeepSeek 六价字段（缓存命中/未命中/输出 × 高峰/空闲）；AI_PLATFORM_PRESETS（deepseek/volcano/bailian/xiaomi/custom）；isPeakBeijing 北京时间工作日 9-12/14-18 峰谷判定（UTC+8 固定偏移）；deepseek 平台走分层估算，其余平台保留 v0.20 全价两价估算；ai.tsx 平台/Model chips + 单价区按平台切换。
5. **每平台独立配置槽（追加阶段 2c）**：AiConfig 扩 `slots: Record<AiPlatform, AiProviderConfig|null>` + `activePlatform`（不变式 active ≡ slots[activePlatform]）；isAiConfig 读取时归一化（v1 旧 JSON 按 platform 归槽零独立迁移步骤、v2 逐槽校验 + active 重算）；UI 保存即激活（保存写入当前编辑平台槽并切换「使用中」徽标）、切平台仅切编辑视图、空槽按预设默认值初始化；「已保存」按钮残态切平台重置。
6. **文档**：ai.md v0.20→v0.21→v0.22 三条非破坏性变更记录（头部自 v0.17 顺带修正）；AGENTS.md v0.28→v0.29→v0.30（§7.38 两条注记段）；提案 `docs/proposals/slice-26-ai-config-enhancement.md`（含 §9 槽化修订）；任务卡三追加阶段小节 + 验收 3/4 分层语义；backlog §1/§2 划项 + 候选 29a/29b。
7. **APK 交付**：`life-0.23.0-v10-s26.apk`（工作区根，versionCode 10/versionName 0.23.0 沿 24/25 惯例不 bump，release 构建 108MB）。

## 一、环境事实

- 真机：MuMu 12（127.0.0.1:7555 / :5555 / emulator-5554 同实例多端点），Android 15 SM-S9260，截图 900x1600；adb 中文直输可用；深浅色切换 `adb shell cmd uimode night no/yes`。
- **MuMu 在切片 25 收尾后被重置**：secure-store 清空、databases 清空。v12 造库用 git worktree（`.tmp-s26/v12base` @ 5ed723f detached）+ powershell New-Item Junction 共享 node_modules，经 worktree Metro（8082）给 dev client 喂 v12 bundle 完成造库（careful_mode=1），再切主树 Metro（8081）实测 v12→v13 迁移。
- **dev client 二进制勘误**：`life-0.23.0-v10.apk` 是 release 构建（永不连 Metro，内嵌切片 23 时代 JS）；真 dev client 是 `android/app/build/outputs/apk/debug/app-debug.apk`（切片 23 时代构建，versionCode 10）。首启出 expo-dev-launcher HOME，点 server 连 Metro；冷启动 auto-launch last project。此后一切「旧 UI」怪象皆源于误用 release 包。
- Metro：主树 `npx expo start --dev-client --port 8081`（后台 job）；adb reverse tcp:8081 tcp:8081。**运行期间 Metro 三次崩溃**（exit 7），均因 edit/write 工具在项目目录写临时文件触发 Windows FallbackWatcher ENOENT（errno -4058）带崩 node 24——临时脚本一律写 `.tmp-s26/` 或项目外。
- APK 编译：JAVA_HOME 指向已删路径，有效 JDK 在 `C:/Users/randomtree/.jabba/jdk/system@17`（17.0.10）；`cd android && ./gradlew assembleRelease` BUILD SUCCESSFUL 1m48s。
- 杀进程：`taskkill //PID` 在本 bash 乱码失败，用 `powershell Stop-Process -Id <pid> -Force`。

## 二、数据库/构建事实

- schema v13：`SCHEMA_VERSION 12→13`（src/db/schema.ts:17）；migrations 追加 toVersion 13 单条 addColumns（app_settings.show_ai_usage boolean），v2–v12 step 未动；AppSettingsModel @field；DEFAULT_APP_SETTINGS + 读层防御归一 + 写层三处（getSettings 补插/updateSettings 建行/update patch 直通）。
- **真机迁移实测**：v12 库（user_version=12、careful_mode=1、无 show_ai_usage）→ force-stop 重启拉 v13 bundle → `PRAGMA user_version`=13、`global|1|0`（careful 保持、新列默认关）、table_info 11+1 列。日志见 Metro 崩溃前录屏：`Migrating from version 12 to 13... Migration successful`。
- 真库路径：`/data/data/com.vibecoding.life/life.db`（app 根目录；`databases/` 下是 release 遗留 0 字节空壳）。检查命令：`adb -s 127.0.0.1:7555 exec-out run-as com.vibecoding.life sqlite3 /data/data/com.vibecoding.life/life.db "SQL"`。
- SecureStore：值 AES 加密（expo-secure-store + Keystore alias key_v1），XML 层读不到明文；键名 `key_v1-ai_provider_config_v1`。槽化配置的权威展示是 UI 徽标（activePlatform）。

## 三、代码地图（切片 26 终态）

**域层**
- `src/domain/ai/usage.ts`（新建 ~200 行）：快照/单价/分层估算/峰谷判定/行合成（§〇.2）。
- `src/domain/ai/configStore.ts`（~180 行）：AiPlatform 五平台 + AI_PLATFORM_PRESETS + AiProviderConfig（platform/两价/六价）+ AiConfig 槽化（slots/activePlatform）+ createEmptyAiSlots + isAiConfig 归一化（v1/v2 双格式）。
- `src/domain/ai/openAiCompatible.ts`（~510 行）：OpenAiCompatibleConfig 扩单价六字段 + platform；构造器第三参 `now: () => number = Date.now`（clock 注入供测试）；parse() 每轮开头重置 lastUsage、envelope 提取（deepseek 走 tiered、其余走 flat）、成功路径赋值。
- `src/domain/ai/chat.ts`（~190 行）：FlashTurnResult.usage 域内字段；fallbackTurn usage:null；runFlashTurn 成功路径 `usage: provider.lastUsage`。
- `src/domain/ai/prompt.ts`：零改动（只读消费）。

**DB/数据层**
- `src/db/schema.ts` / `src/db/migrations.ts` / `src/db/models/AppSettingsModel.ts` / `src/domain/settings.ts` / `src/data/WatermelonItemRepository.ts`（读层防御归一 + 写层三处）：v13 列全链路。

**UI 层**
- `src/app/settings/ai-prompt.tsx`（新建 ~110 行）：只读提示词页。
- `src/app/settings/ai.tsx`（~590 行）：平台 chips（编辑视图切换 + 使用中徽标）+ Model chips（按平台预设）+ 单价区（deepseek 六价三组 / 其余两价）+ buildConfig 平台分叉 + 保存即激活 + parsePriceInput。
- `src/app/(tabs)/profile.tsx`：AI 提示词 navRow + 用量展示开关行（handleShowAiUsageChange 乐观更新回滚）。
- `src/app/_layout.tsx`：settings/ai-prompt 路由注册。
- `src/ui/useFlashChat.ts`（~810 行）：readTurnSettings（每轮一次读 carefulMode+showAiUsage）+ pushUsageLine + send() 接线。

**测试（81 套件 / 1145 用例，基线 79/1087，+2 套件 +58 用例）**
- 新建：`src/db/__tests__/migrationsV13.test.ts`、`src/domain/ai/__tests__/usage.test.ts`。
- 扩展：openAiCompatible.test.ts（lastUsage 8 条 + tiered 4 条）、chat.test.ts（usage 传输边界 3 条）、configStore.test.ts（platform/六价透传 + 槽化归一化 8 条）、useFlashChat.test.ts（用量展示 6 条）、SecureAiConfigStore.test.ts（槽化断言跟改）、categorySettings/viewQueries/migrationsV8/V9/V11/V12/seedPreset（版本号例行更新）。

## 四、踩坑教训（分阶段索引，细节见各 phase 反馈文件）

1. **edit/write 临时文件崩 Metro（×3）**：Windows FallbackWatcher 对受监视目录瞬态文件抛 ENOENT 带崩 node。临时脚本写项目外或 `.tmp-s26/`（Metro 不监视 dot 目录？错——`.tmp-s26` 在项目树内仍触发过一次；最稳是写到系统临时目录）。
2. **批量 edit 多行锚点必须逐字核对缩进**（阶段 1 两次失配均因行首空格数；read 工具「NN: 」行号前缀含分隔空格误导缩进判断）。
3. **展示格式断言以实现单点为准**（formatAiUsageLine 分隔符 ' · '，测试手写漏空格）。
4. **theme token API 先核对再写**（ThemeColors 键集冻结，ai-prompt.tsx 首版用错 API 重写）。
5. **python 含中文脚本必须写 UTF-8 文件执行**（heredoc 管道按 cp936 误解；console stdout GBK UnicodeEncodeError——输出一律落盘再 read）。
6. **adb 坐标操作对滚动敏感**：必须 uiautomator dump 或截图确认后再点；swipe 偶发不生效需重试+截图确认；**软键盘/placeholder 态改变 TextInput 宽度导致同 y 坐标下框位漂移**（「空闲」框 placeholder 态宽 197px vs 有值态 65px——每填一框重新 dump）；BACK 在输入框获焦时第一次收键盘、第二次退页面；CTRL+A= `input keycombination 113 29`（Android 11+）。
7. **uiautomator dump 随机失败**（偶发空/截断 XML，EditText 正则匹配不到）——重试或换宽松正则；RN 页面节点多时 dump 可能漏下半屏节点，滚动分段 dump。
8. **release APK ≠ dev client**（环境勘误见 §一）；dev client 缓存 bundle 会伪装成代码问题——先确认 bundle 来源再怀疑代码。
9. **savedTick 残态误导**（保存按钮「已保存」文本跨平台切换残留——阶段 2c 已修：切编辑视图重置）。
10. **表单联动重排**：ai.tsx 六价输入框 placeholder↔值切换时行内布局重排，自动化填表必须逐框 dump。

## 五、遗留披露

1. **DeepSeek 峰谷分层不做法定节假日识别**（ai.md v0.21 明文已知限制）：节假日工作时段按高峰计，误差方向=高估费用；精确节假日历表为 backlog 待定候选（backlog §6）。
2. **分层估算仅 deepseek 平台启用**：volcano/bailian/xiaomi/custom 平台沿用 v0.20 全价两价（priceInputPerMillion/priceOutputPerMillion）；各平台档位价格表后续按需扩展（预设表只含 BaseURL/Model）。
3. **buildConfig 丢 timeoutMs quirk 不修**（任务卡 §4 冻结，随 quirk 一起留给后续）。
4. **候选 29a/29b 已记 backlog**（用户 2026-11-17 真机反馈驱动：口语纠正短句误判新建、历史预览卡视觉区分、AI 日程查询/记忆检索愿景）。
5. **AI 平台预设表为静态快照**（2026-11-17 官方口径）：BaseURL/Model/官方价随上游演化需人工更新（无远程拉取）。
6. **chat 历史为内存态**：force-stop 后聊天流清空（既有行为，切片 22 设计），用量行随之消失；usage 本身无持久化。

## 六、终态验收

- tsc：0 错。
- jest：81 套件 / 1145 用例全绿（基线 79/1087 只增不减）。
- expo-doctor：2 项 = 预存基线（app config 同步检查 + RN Directory 元数据），无新增。
- 真机验收矩阵（任务卡 §3，10 项全通过；MuMu 7555，Metro 主树 8081）：

| # | 项目 | 结果 | 证据 |
| --- | --- | --- | --- |
| 1 | 开关默认关远端轮无用量行 | ✓ | 「后天上午9点开会」轮出卡无行（v04-accept1）；v31 历史区再证 |
| 2 | 开关开未配单价 token 段形态 | ✓ | 「明天上午10点站会」`📊 用量：输入 2633 tokens（缓存 2304）· 输出 268` 无 ≈（v14/v31） |
| 3 | 配单价 ≈ 精确 + 改价下一轮生效 | ✓ | 同步进展轮 ≈0.002215（=2304×0.02+413×1+439×4 分毫不差）；例会轮 ≈0.001761；**输出空闲 4→9 后健身轮 ≈0.002638**（=46.08+630+218×9）；改回 4 后吃药轮 ≈0.002289、晨跑轮 ≈0.004347 |
| 4 | DeepSeek 直连缓存命中段显示 | ✓ | 多轮「缓存 2304」>0 展示（官方响应 details.cached_tokens） |
| 5 | 澄清轮带用量行 | ✓ | 「提醒我吃药」反问「你要在什么时间提醒你吃药?」+ 用量行 ≈0.002289（v24） |
| 6 | 拦截轮用量行为 | ✓ | 「把晨跑改成夜跑」拦截确认卡（标题/内容拟改摘要）+ 草稿保持晨跑卡 + **拦截轮无用量行**（与阶段 2 单测一致）+「放弃修改」本地处理（「已放弃本次修改，卡片保持原样。」，不发起 AI 轮次）（v26/v32） |
| 7 | 降级轮无用量行 | ✓ | 无 Key 喝水轮（阶段 3 早期）+「周四下午2点评审」API 瞬时异常降级轮均无行、降级说明照旧 |
| 8 | 提示词页 | ✓ | 内容首尾与 AI_SYSTEM_PROMPT 逐字吻合（尾部「民用时刻归一化规则」5 条+末行 JSON 输出约定）；深色（默认）与浅色（uimode night no）两态正常；长文本可滚到底；hint 注明动态拼接部分不展示（s19-s29） |
| 9 | 持久化 | ✓ | 开关与六价杀进程重开保持（DB 1|1）；**v12→v13 迁移实测**：careful_mode 保持、show_ai_usage 默认关（user_version 13、global|1|0）；槽配置（DeepSeek 槽内容+使用中徽标）杀进程保持（s44） |
| 10 | 单价回显 | ✓ | 保存后重进 /settings/ai 六价回显正确；清空保存后回显空（placeholder 态）且下一轮估算段消失（=验收 2 形态） |

- 分层估算四轮真机核算汇总（空闲时段，官方价 0.02/1/4 + 改价 9 一轮）：

| 轮次 | 输入/缓存/输出 | 显示 ≈ | 手算 | 差 |
| --- | --- | --- | --- | --- |
| 同步进展 | 2717/2304/439 | 0.002215 | 2215.08 | 0 |
| 例会 | 2795/2304/306 | 0.001761 | 1761.08 | 0 |
| 健身（输出空闲改 9） | 2934/2304/218 | 0.002638 | 2638.08 | 0 |
| 吃药（恢复 4） | 3015/2304/383 | 0.002289 | 2289.08 | 0 |
| 晨跑（恢复 4） | 3141/2304/866 | 0.004347 | 4347.08 | 0 |

- 数据清理：验收轮草稿均未确认保存（无 items 污染）；app_settings 终态=用户自有配置（DeepSeek 槽官方六价 + show_ai_usage=1 + careful_mode=1）；聊天历史为内存态随进程消亡；用户自己保存的 3 张测试卡（提醒睡觉链）保留。
- APK：`life-0.23.0-v10-s26.apk` 已复制到工作区根（108MB，未入 git——与 `.tmp-s25/`、旧 APK 同为永不 add 项）。

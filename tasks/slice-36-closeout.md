# 切片 36 closeout — AI 日程查询/记忆检索（对话式日程管理）

- 日期：2026-11-23
- 分支：`task/slice-36`（基点 main @ `97feeb6`）
- 提案：`docs/proposals/slice-36-ai-schedule-query.md`（用户 2026-11-23 四问定案）
- 任务卡：`tasks/slice-36.md`（D1–D8 / 矩阵 §3 十项）
- 状态：**切片 36 全部完成**（阶段 1 提交 8a21db0；阶段 2 含真机矩阵 0–10 全过与 retrieval 日期缺陷修复，随本提交收尾）

## 〇、交付清单

- 阶段 1（`8a21db0`，36 文件 +2245/−91）：域 5 新文件（queryIntent/queryPrompt/queryGuard/retrieval/scheduleQuery）+ provider completeRaw 改造 + types ScheduleQueryTurnResult + settings v18 五文件接线（settings/schema/migrations/AppSettingsModel/configSnapshot）+ WatermelonItemRepository 四接线点 + 6 新测试套件 + 9 历史 schema 套件例行刷新 + AGENTS v0.40（§7.48+§8）/提案/任务卡。
- 阶段 2（本提交）：useFlashChat 查询分支（预判/开关/检索/编排/消息流/取消待确认/history 纯文本追加）+ flash.tsx placeholder 三态（D7）+ profile.tsx 开关行 + useFlashChat.test.ts 查询 describe 5 用例（Probe 模式）+ **retrieval 行格式 MM-DD 日期修复（真机矩阵 3 缺陷）** + closeout + backlog 划项（29b/候选①）。

## 一、环境事实

- 构建环境：Windows 本机 gradlew assembleRelease；APK 产物 `life-0.23.0-v10-s36.apk`（版本 0.23.0 / versionCode 10，与切片 35 相同版本号——版本号 bump 非本片范围）。
- 模拟器：MuMu「猴王」实例（切片 32/35 惯例；不用「猜猜」实例）。
- 升级安装：16384 存量（v17 库）→ 覆盖安装 s36 APK → v18 addColumns 迁移真机验收（AGENTS §5）。

## 二、数据库/构建事实

- schema v17→v18：app_settings 单列 `ai_schedule_query_enabled`（boolean isOptional 回填 null，读层 parseAiScheduleQueryEnabled 归一 null→true 默认开）；v2–v17 step 零改动；LokiJS 测试适配器忽略 sql 步骤的影响为零（本迁移零 sql 步骤，纯 addColumns）。
- 升级安装验收：见 §四矩阵 0 项（真机）。
- expo-doctor：2 项预存失败无新增（CNG 同步提示 + RN Directory 元数据）。

## 三、代码地图（新增/修改）

新增（域）：
- `src/domain/ai/queryIntent.ts` — matchesScheduleQueryIntent（排除表 8 词→疑问表 12 词→短语正则「安排了/预约了」正向环视白名单句尾/标点/语气助词 吗呢没）。
- `src/domain/ai/queryPrompt.ts` — AI_QUERY_SYSTEM_PROMPT 三行基座 + buildQueryWindowResolutionPrompt（轻 JSON 指令）+ buildQueryAnswerPrompt（纯文本 ≤150 字）。
- `src/domain/ai/queryGuard.ts` — parseCivilDateString/isQueryWindowWire（形状守卫）+ resolveQueryWindow（end<start/非法/null→回退今天起 7 天 usedFallback=true；civilDayStartMs DST 午夜 gap 逐小时顺延）。
- `src/domain/ai/retrieval.ts` — buildScheduleRetrievalContext（窗口相交：allDay 民用日粒度 endAt-1ms 取尾日；无时刻待办单列节；content 80 字截断；上限 50 条 truncated 披露；timed startAt 升序）。
- `src/domain/ai/scheduleQuery.ts` — runScheduleQueryTurn 两段式编排（无 Key/第一段失败保默认窗口/第二段失败→D6 降级本地行式列表；usage=第二段终态；debug=第一段窗口轮快照 stage1Debug 成功失败均捕获）。

修改（域）：
- `src/domain/ai/openAiCompatible.ts` — 重试循环抽 withRetry + 传输段抽 requestChatCompletion + 新公开 completeRaw（进入清空三副通道；不剥围栏不做 wire 守卫——查询层自己守卫；ai.md 契约零改动）。
- `src/domain/ai/types.ts` — ScheduleQueryTurnResult {answer, windowText, degraded, usage: AiUsageSnapshot|null, debug: AiTurnDebugSnapshot|null, degradedNotice?}。
- `src/domain/settings.ts` — AppSettings.aiScheduleQueryEnabled: boolean 必填（既有 15 字段全必填先例；提案散文 `?:` 偏离披露）+ DEFAULT true + parseAiScheduleQueryEnabled（非 boolean→true）+ validateAiScheduleQueryEnabled（非 boolean 抛错）。
- `src/db/schema.ts`（SCHEMA_VERSION=18+列）/ `src/db/migrations.ts`（toVersion 18 单条 addColumns）/ `src/db/models/AppSettingsModel.ts`（@field isOptional）/ `src/domain/configSnapshot.ts`（normalizeSnapshotAppSettings 追加三例行——syncMerge 复用同函数覆盖配置恢复与双向同步两条链）/ `src/data/WatermelonItemRepository.ts`（toDomainSettings/getSettings create/updateSettings 预校验+update 四接线点）。

修改（UI）：
- `src/ui/useFlashChat.ts` — send 顶部查询预判（编辑窄规则之前）+ 查询分支（开关关→本地提示；开→全域检索组包→runScheduleQueryTurn→纯文本回答+usage 行+debug 入口+history append user/assistant 纯文本）；readTurnSettings 加 aiScheduleQueryEnabled（catch 回退 true 默认开）；pushDebugEntry 第 2 参改 draftJson: string（查询轮传 '（查询轮无草稿）'）。
- `src/app/(tabs)/profile.tsx` — AI 配置区块「对话式查询」Switch（widgetToggleRow，settingsSavingKey 互斥，carefulMode 行同款乐观更新+失败回滚）。
- `src/app/(tabs)/flash.tsx` — 输入框 placeholder 三态（预览卡在场/保存后结果卡在场/其余；D7 正向文案）。

测试（新增 6 套件 + 追加）：
- `src/domain/ai/__tests__/queryIntent.test.ts`（词表冻结+矩阵）/ `queryGuard.test.ts` / `retrieval.test.ts` / `scheduleQuery.test.ts`（降级三路径+两段成功+重试披露）/ `src/domain/__tests__/settingsAiQueryEnabled.test.ts` / `src/db/__tests__/migrationsV18.test.ts`（结构+LokiJS 行为级）。
- `src/ui/__tests__/useFlashChat.test.ts` 追加查询 describe 5 用例（开关关/无 Key 降级/远端两段 debug+usage/窄规则优先含疑问词排除命中/待确认取消+查询）。
- 9 个历史 schema 套件例行刷新（v17→v18 断言滚动，切片 32–35 惯例）。

## 四、真机验收矩阵（MuMu 猴王 127.0.0.1:16384；2026-11-23 执行）

- 0. **升级安装 ✓**：16384 存量（v17 库）`adb install -r` s36 APK → 启动 → logcat 实证「[🍉] [SQLite] Migrating from version 17 to 18... Migration successful」；计划页存量数据完整（今天 3 条+明天开会 1 条，2026-11-23 周一）。
- 1. **「这周有什么安排」✓**：远端两段轮（回答为自然语言摘要+调试入口消息在场）——回答含本周全部条目（周一 09:00 去超市买东西（备注记得带伞）/16:00 写本周周报/17:00 取快递；周二 11:00 开会）+无时刻待办单列；**无卡片、无落库**；调试弹层实证第一段轻 JSON：system=AI_QUERY_SYSTEM_PROMPT（非 AI_SYSTEM_PROMPT，域隔离）、content=`{"start":{"date":"2026-11-23"},"end":{"date":"2026-11-29"}}`、卡片数据=「（查询轮无草稿）」。
- 2. **「下周末有空吗」✓**：窗口解析 12-05/12-06（正确「下周」语义，reasoning_content 可见模型推理链）；空档回答如实（「没有具体时间的日程安排，整体是有空的」+无时刻待办单列）；窗口外本周条目零误报；弹层轻 JSON 同型核验过。
- 3. **「三月内有哪些就医」✓（含一处缺陷与修复，见 §五 T1）**：预造「记一下下周三下午2点牙医复诊」条目并详情页归档 → 查询回答明说「状态为已归档」=**全域检索归档计入 ✓**；窗口解析 2026-11-23 至 2027-02-23（今天起 3 个月）✓；吃药/吃药提醒被正确归为待办不算就医 ✓。**缺陷**：首验回答把 12-02 周三误报为 2026-11-25——retrieval 行格式原只有「周三 14:00」无绝对日期，模型按窗口起始日推算错位 → 修复行格式加 MM-DD 前缀（§五 T1）+单测 13 断言滚动 → 重建 APK 复验通过（回答含「12-02 周三 14:00 牙医复诊，状态为已归档」）。
- 4. **查询轮后「帮我把周一那个改到周二」✓**：未误判查询（无疑问词）走录入路径；切片 34 编辑链路正常——按摘要块 targetItemId 基线（牙医复诊）出更新卡（标题/分类/标签照抄、时间改周二 12-01 14:00）；查询轮纯文本对未破坏编辑语义（buildHistoryBriefing 跳过非 JSON 条目实证）。验证后放弃该卡。
- 5. **查询轮后「记一下明天下午3点开会」✓**：正常新建出卡（2026-11-24 15:00 工作）——预判不误伤录入。
- 6. **「提醒我明天8点吃药」✓**：排除表生效（「提醒我」命中 → 不判查询）正常录卡（2026-11-24 08:00 健康+闹钟渠道=强提醒场景）。
- 7. **开关关闭 ✓**：profile「对话式查询」Switch 关 → 查询句 → 即时本地提示「对话式查询已关闭，可在「我的」-设置开启。」（无 RTT、无新调试入口=无远端调用）→ 开关复开 checked=true。
- 8. **断网/远端不可达降级 ✓**：adb 端 `svc wifi/data disable` 会连带挂死 MuMu 内 adbd shell 通道（断网手段不可行，见 §五 T2）；改用 **baseUrl 置为不可达地址**（AI 配置页改 `http://10.255.255.1` 保存）复现远端不可达 → 查询句 → 中途态「AI 服务异常，正在重试（3/3）…」（onRetry 即时提示在查询轮同生效）→ 两段各 4 次尝试（20s 超时×4×2+间隔 ≈166s）耗尽 → **本地行式列表回答**（「2026-11-23 至 2026-11-29日程：」+7 条 timed 行【含 MM-DD 日期前缀，降级路径同受益于 T1 修复】+【无时刻待办】节 8 条）+ 披露「AI 摘要生成失败（请求超时（已重试 3 次）），已用本地日程列表回答。」（timeout kind+重试计数披露精确）+ 降级调试入口「远端解析失败已降级」在场 + 无 usage 行；第一段超时失败按设计回退今天起 7 天默认窗口（未降级中断，第二段仍尝试——D6 语义）。baseUrl 已恢复原值并复验远端正常。
- 9. **待确认取消+查询 ✓**：认真模式开 → 「明天开会」出卡（全天）→ 「明天在第三会议室开会」→ 认真模式拦截「修改需要确认」（内容 (空)→地点：第三会议室+应用/放弃选项）→ 输入查询句「这周有什么安排」→ **confirm 快捷选项消失（resolved）**+查询轮正常远端回答（含本周全部条目）+草稿保持未动（查询轮不产卡不落库）。
- 10. **深浅色两态 ✓**：浅色 profile 开关行+查询回答截图存证（.tmp-s36/m3-retest.png 等）；深色 `adb shell cmd uimode night yes` → profile「对话式查询」行（label+hint+Switch）与闪电页查询回答（降级列表+远端摘要+调试入口+输入框）Token 化渲染全部可读无硬编码色残留 → night no 恢复。深色态追加实证：baseUrl 恢复后的远端回答按 MM-DD 检索行正确给出绝对日期（「11-23 周一：09:00 去超市买东西（记得带伞）…」），且 8 条无时刻待办计数准确。
- D7 placeholder 三态真机实证：初始态「输入事项，或直接提问查询日程…」/ hasDraft 态「输入事项，或继续纠正上面的卡片…」/ hasLiveCard 保存后态「已保存，继续输入可修改该条目，或直接提问查询日程」。
- profile 开关行渲染：label「对话式查询」+hint「闪电录入中可直接提问日程（如「这周有什么安排」），检索含已归档条目。」+Switch（存量库 checked=true 默认开）。

## 五、踩坑教训

- **T1 retrieval 行格式缺绝对日期（真机发现，本片修复）**：原行「周三 09:00 标题」在跨周窗口下语义不足——模型把「三月内」窗口中的 12-02 周三按窗口起始日（11-23 周一）推算为「本周三 11-25」错误作答。修复：formatTimedRow 加 `${MM}-${DD}` 民用日前缀（`getZonedParts` 拆解非本地时区拼接）→「11-24 周二 09:00 标题」；allDay=「11-25 周三 全天」。retrieval.test.ts 13 断言+scheduleQuery.test.ts 4 断言滚动更新；重建 APK 复验矩阵 3 通过（回答「2026-12-02 周三 14:00 牙医复诊（健康类，已归档）」）。教训：**喂给模型的相对时间表达必须自带绝对锚点**——「周X」在 >7 天窗口内不可定位。
- **T2 MuMu adb 断网命令连环挂死（两次实例重启才恢复）**：`svc wifi disable`/`cmd connectivity airplane-mode enable`/`cmd statusbar expand-notifications`/`iptables` 均 exec 不返回；`svc data disable` 更把 adbd 半死（shell 连接在但无响应，input 全失效）——实例级 `control -v 0 restart` 不够，需 **`mumu-cli main kill`+`main launch` 主程序整体重启**才恢复（≈2min）。教训：MuMu 上断网类命令一律不碰（adb 通道与虚拟 NAT 共栈）；远端不可达验收改走 baseUrl 置不可达地址（语义等效 network-error/timeout 降级，且不破坏 adb）。
- **T3 release build 偶发 send 卡死（busy 锁）**：矩阵 3 造数据轮 tap 发送后 UI 全冻结（按钮仍绿、输入/Enter/全部 tap 无效、logcat 无 crash/ANR、JS 无日志）——判定 JS 线程挂起或 send() await 永不返回（busy 守卫拦截一切后续输入）。`am force-stop`+重启恢复，复测同流程正常。教训：真机偶发挂死的恢复路径=重启 app；「按钮 enabled 但全部交互无效」是判别信号；与本切片代码无因果（同流程复现 0/3）。
- **T4 页面状态假设必须每步 dump 验证（两次输入打错字段）**：AI 配置页滚动位置漂移导致 input text 打进非预期字段（BaseURL 被追加查询句/URL 拼接污染）——uiautomator dump 确认字段值+bounds 是唯一可靠锚点；DEL 逐字删除需字段聚焦（tap 后不收键盘），`input keycombination CTRL_A` 在 MuMu 不可用。教训：改文本字段=「tap 聚焦→END→逐字 DEL→input→dump 验证」五步序列，跳步即污染。
- **T5 TextInput 焦点持有吞 tap（复用切片 34 教训）**：MuMu 硬件输入模式无软键盘，「先 keyevent 111 再 tap 发送」仍是可靠序列；焦点未释放时 tap 发送可能无效果。
- **T6 既有实现语义澄清（非缺陷）**：「改成周五下午5点游泳45分钟」未触发认真模式拦截——editIntent 窄规则 TIME_TOKEN_START 白名单无「周五」（周几不在编辑词后时间表达白名单）且时间同变（`!diff.timeChanged`=false）→ 按 §7.37 实现语义不拦。矩阵 9 改用切片 25 已验证句式（content 变+时间不变）完成拦截验证。周几编辑词支持属后续候选（不扩窄规则，本片边界）。

## 六、遗留披露

- **lastDebug/lastUsage 被查询轮覆盖（D8 已知行为）**：查询轮两段调用覆写 provider 副通道——紧随其后的解析轮调试弹层看到的 request/response 是解析轮自己的（每次进入清空），无跨轮污染；但反向「查询轮后看查询调试」依赖弹层入口消息快照（内存态），重启即失。设计既定（chat.ts parse 进入清空语义不变）。
- **lastDebug 语义细化（实现即披露）**：查询轮的 debug 入口消息携带**第一段窗口轮**快照（D2+矩阵 #2 综合落实，用户批准的第二解释落点）；usage 行取**第二段**终态（D2）。两段各自完整保留请求/响应原文。
- **提案偏离 2 条（已在阶段 1 报告披露）**：①configSnapshot.ts 不在提案文件清单——normalizeSnapshotAppSettings 追加 aiScheduleQueryEnabled 行（不接线则配置恢复/双向同步静默丢字段，切片 35 D4 缺口同构）；②AppSettings 接口字段用必填 boolean（提案散文 `?:`；既有 15 字段全必填、读层归一保总额性先例；isOptional 语义保留在列层与读层归一）。
- **误判样例（真机矩阵 5/6 记录）**：矩阵 5「记一下明天下午3点开会」/矩阵 6「提醒我明天8点吃药」均未被预判拦截（无疑问词/排除词命中）——**零误判样本**；正向误判样本（查询句走录入）未出现：疑问词表 12 词+短语正则在矩阵 1/2/3/9 的 5 个查询句全部命中。预判保守策略（先排除后疑问+漏判走录入用户重述兜底）真机成立。
- **retrieval 行格式含状态后缀的取舍**：`[已归档]`/`[已完成]` 后缀是检索上下文的模型侧信息（不进 UI），模型据此如实披露归档状态（矩阵 3 实证）——文案措辞由模型自由组织，无模板注入。
- **APK 版本号策略**：versionCode 10 / 0.23.0 与切片 35 相同（升级安装靠 `install -r` 覆盖；版本 bump 非本片范围，与既有各切片惯例一致）。
- **两段式 RTT 量级**：正常轮端到端 ≈10–20s（两段串行）；远端不可达时 = 两段各 4 次×20s 超时 ≈166s 才出降级回答——用户感知为「转圈近 3 分钟后出本地列表」，可接受（重试提示 (n/3) 中途可见）；如需更快可调 `ai_retry_max` 或 `timeoutMs`（既有配置面，非本片范围）。

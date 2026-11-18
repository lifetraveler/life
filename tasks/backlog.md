# 任务遗留与路线清单（backlog）

> 用途：未完成任务的唯一汇总清单，防止散落在各 closeout「遗留披露/后续候选」里的条目丢失。
> 维护规则（用户 2026-11-16 确认的惯例）：**每个切片 closeout 时同步更新本文件**——已完成条目划掉（~~删除线~~）并注明关闭切片号，新候选先记这里再编号立项；**AGENTS.md §8 已于 2026-11-16 精简为指针（「未完成项以 tasks/backlog.md 为准」，与 v0.26 修订一起随切片 24 提交生效）**，此后 AGENTS §8 不再罗列候选清单（不撑长），每切片 closeout 更新本文件时同步刷新 §8 的当前切片状态行，以本文件为准。
> 建立日期：2026-11-16（基线 main @ 7a414e6，切片 1–23 完成合并）。

## 1. 已立项未开工

- ~~**切片 24：夜间模式与视觉清理**~~（✅ 已完成，关闭于切片 24，见 `tasks/slice-24-closeout.md`）
  - ~~阶段 1 `src/ui/theme.ts` Token + `useTheme()` + 两个逻辑修复；阶段 2 全局硬编码色替换 + StatusBar 跟随；阶段 3 `adb shell cmd uimode night yes/no` 真机验收。~~
  - ~~打包修复：FlashPreviewCard 时间行日期重复（slice-23 遗留 5）；AI 上下文合并带入上一轮 tags（slice-23 遗留 2）。~~

- ~~**切片 25：闪电录入认真模式**~~（✅ 已完成，关闭于切片 25，见 `tasks/slice-25-closeout.md`）
  - ~~阶段 1 schema v12 `careful_mode` + settings/repository 读写 + 编辑轮守卫 + 新意图误留旧标题修复（slice-24 closeout §5 遗留 1）；阶段 2 `useFlashChat` `kind: 'confirm'` 确认交互 + `profile.tsx` 设置开关；阶段 3 真机验收。基点 main @ d5cb4cc，分支 `task/slice-25`。~~
  - 验收终态：tsc 0 错 / jest 79 套件·1087 用例（只增不减）/ expo-doctor 2 项预存无新增 / MuMu 观察点①②④通过、③以代码+功能+持久化三重证据替代视觉帧（亚帧窗口不可达，closeout §五.3）。遗留披露见 closeout §五（代理谓词两边界、保存后上下文重置、disabled 瞬态未留证）。

- **切片 26：AI 透明度（提示词查看 + 用量展示）**（2026-11-16 立项，卡 `tasks/slice-26.md`，基点 main @ 5ed723f，分支 `task/slice-26`）
  - 阶段 1 域层 usage 管道（新建 `src/domain/ai/usage.ts` + openAiCompatible `lastUsage` 副通道 + `FlashTurnResult.usage` + AiProviderConfig 可选单价字段）+ schema v13 `show_ai_usage` + settings/repository 读写；阶段 2 UI（新建 `src/app/settings/ai-prompt.tsx` 提示词查看页 + profile 开关/navRow + /settings/ai 单价输入 + useFlashChat 消息接线）；阶段 3 真机验收矩阵 + closeout。
  - 规划修订：原行「B 涉及 AiParser.parse 返回值扩展」的假设**不成立已修订**——usage 不进 ParsedItemDraft/history，走 provider `lastUsage` 副通道（卡 §1 D1）；ai.md 仅追加非破坏性变更记录条目。切片 25 收尾新增 4 条待定候选已权衡，均不并入本切片（①②同根后续可合并立项、③需变更提案、④纯评估）。
  - 验收终态：tsc 0 错 / jest 81 套件·1145 用例（只增不减） / expo-doctor 2 项预存无新增 / 真机验收矩阵 10 项全通过（含分层计价四轮分毞不差实测：0.002215 / 0.001761 / 0.002638改价 / 0.002289 与 0.004347）。遗留披露见 closeout §五。

- **~~切片 27：系统日历 live 直读显示（方案 C）~~**（✅ 已完成 2026-11-17，关闭于切片 27，见 `tasks/slice-27-closeout.md`；提交 c79fe3d / 97eb070 / aeeed50；迁移占用 v14。口径修正：入口为**筛选面板日历显示区**（取消独立设置页，2026-11-17 用户决策）；真机矩阵 12 项通过 + L10 复核坐实（见 L10 条目）；遗留 = CalDAV 验收未验（MuMu 无环境）+ expo-calendar 15.0.8 权限挂起已 8s 兜底）
  - 前置已解：调研报告 §9 四个开放问题用户 2026-11-17 定案——Q1 四视图全做 / Q2 重叠自动去重 + 设置页提示 / Q3 本片不做写回（如立项走独立变更提案 + 独立切片）/ Q4 weekdays 多选日重复跳过并在 UI 提示。
  - 阶段 1 域+数据层+契约文档（schema v14 `display_calendar_ids_json` + migrations/settings/repository 读写 + SystemCalendarReader 扩 color/sourceName + ui.md/repository.md 新节）；阶段 2 live 管道与 UI（liveCalendar 纯函数 + useSystemCalendarEvents hook + plan.tsx 四视图合并渲染只读徽标 + /settings/calendar-display 设置页）；阶段 3 L10 真机复核 + 验收矩阵 + closeout。设计决策与冻结边界（不落库/不参与调度搜索筛选快照/不写回/不轮询）见卡 §0–§1 与 AGENTS §7.39。

- **~~切片 29：闪电录入对话能力强化包~~**（✅ 已完成 2026-11-17，关闭于切片 29，见 `tasks/slice-29-closeout.md`；提交 f363cd1 / cdbaffc / bbed994；基点 main @ 0085863）
  - ~~① 口语纠正短句 prompt 成文（AI_SYSTEM_PROMPT 多轮节——**不含新事由名词**的短纠正句如「还是30分钟后吧」默认编辑上一张卡，反向边界同步修订防误伤「明天开会」类全新意图）；② 「推迟 X 分钟」语义边界 prompt 成文（推迟=卡片基准 / X分钟后=说话时刻，同现互不覆盖）；③ 历史结果卡视觉区分（最后一条 card=当前卡，其余降透明度+「历史」角标，FlashResultCard historical prop）。本地兜底改写评估后**否决**（卡 §1 D1）；无迁移（schema 停留 v14）、ai.md 契约零改动。~~
  - 验收终态：tsc 0 错 / jest 87 套件·1209 用例（只增不减）/ expo-doctor 2 项预存无新增 / 真机矩阵 11 项全通过。阶段 3 范围修订（用户批准）：真机验收发现保存清空 history 使条款 post-save 失活 → `useFlashChat.ts` 保存后播种最后一张卡摘要替代清空（「每存一张=新对话」语义不变）；切片 25 候选①因此部分覆盖（见该行）。遗留披露见 closeout §六。

- **~~切片 30：闪电录入草稿放弃、已删除卡联动与 AI 重试~~**（✅ 已完成 2026-11-17，关闭于切片 30，见 `tasks/slice-30-closeout.md`；提交 15449cb / 9aa4f8d / 833fa4f / e8a9cc8；基点 main @ 16d33a3）
  - ~~阶段 1 schema v15（`ai_retry_max` number isOptional + `flash_deleted_card_display` string isOptional，addColumns 两列）+ settings/repository 读写 + profile 设置 UI（重试档位与删除显示 radio 组）；阶段 2 AI 重试（remote provider 传输层 fetch 包装，可重试=网络/超时/5xx/429/JSON 解析失败、不可重试=401/403/400，固定间隔 1000ms，重试提示即时展示不留历史、耗尽披露「（已重试 N 次）」）；阶段 3 草稿放弃（纯本地清 draft+confirm，不落库不播种）；阶段 4 已删除卡联动（useFocusEffect 批量存在性查询 + mark 置灰禁用/remove 移除）；阶段 5 真机验收矩阵 10 项 + 切片 29 回归 + closeout。~~
  - 验收终态：tsc 0 错 / jest 90 套件·1241 用例（只增不减）/ expo-doctor 2 项预存无新增 / 真机矩阵 10 项全通过（含 401 不重试与网络错误重试 3 次同屏对比、aiRetryMax=0 立即降级、切片 29 播种回归）。遗留披露见 closeout §六（固定间隔无退避、重试轮无 usage、mark/remove 内存态语义）。

- **~~切片 28：配置备份 WebDAV~~**（✅ 已完成 2026-11-18，关闭于切片 28，见 `tasks/slice-28-closeout.md`；提交链 2125ba3（阶段 1 域+数据层）→ 90774f1（阶段 2 UI）→ 1d9006b（Phase 1–2 反馈）→ 阶段 3 收尾提交；分支 `task/slice-28` 基点 main @ 4c8e6ea）
  - ~~阶段 1 域+数据层（configSnapshot/webdav 纯域 + WebdavClient PROPFIND/GET/PUT/MKCOL/DELETE 自写客户端 + SecureWebdavConfigStore 独立键 + Repository createConfigSnapshot/applyConfigSnapshot 契约外扩展成对 + repository.md 注记节 + AGENTS v0.34 §7.42）+ 提案/卡随阶段 1 提交；阶段 2 /settings/backup 设置页（连接表单/测试连接/立即备份/快照列表/恢复确认）+ profile navRow；阶段 3 真机验收矩阵 10 项（宿主机临时 node WebDAV 服务器）+ closeout。~~
  - 验收终态：schema 停留 v15 零迁移 / tsc 0 错 / jest 95 套件·1314 用例（基线 90/1241 只增不减）/ expo-doctor 2 项预存无新增 / 真机矩阵 10 项全过 + 损坏快照整包拒绝负例（恢复计数口径与服务器侧裁剪 DELETE 逐条核对）。遗留披露见 closeout §六（测试连接 207 假阳性面、MKCOL 单级、同秒覆盖、设备测试产物 chips=[30,90,120,240] 等）。

- **~~切片 31：数据备份/恢复 WebDAV~~**（✅ 已完成 2026-11-18，关闭于切片 31，见 `tasks/slice-31-closeout.md`；提交链 659a9bb（阶段 1 域+数据层）→ 0ac3e10（阶段 2 UI）→ 94714b4（docs F1/F2）→ 收尾提交；分支 `task/slice-31` 基点 main @ 5edeeec）
  - ~~阶段 1 域+数据层（src/domain/dataSnapshot.ts 六块 wire+守卫 / Repository createDataSnapshot+applyDataSnapshot 单 batch 原子+_raw.id 保真 / WebdavClient 文件名过滤参数化 / repository.md 注记节 / AGENTS v0.35；提案+卡随阶段 1 提交）；阶段 2 UI（backup.tsx 数据备份区块 + Alert 确认 + 恢复后 reminderScheduler.reconcile 一次失败不阻断）；阶段 3 真机矩阵 + closeout。~~
  - 验收终态：schema 停留 v15 零迁移 / tsc 0 错 / jest 98 套件·1365 用例（基线 95/1314 只增不减）/ expo-doctor 2 项预存无新增 / 真机矩阵 9 项过（#1/#2/#3/损坏负例/#5/#6/#7/#8/#9 reconcile 30→0→30 闭环）+ **4 项 pending 移入下条**（猴王 adb 死锁事故，closeout §四）。遗留披露见 closeout §六（prepareCreateFromDirtyRaw 保真建行、svc wifi disable 死锁教训、双实例混淆等）。

## 2. 待编号路线（用户 2026-11-16 委托按进度/复杂度排序；每切片开工仍按 §7.1 逐切片确认）

建议顺序（编号为建议值，立项时可调）：

| 建议编号 | 任务 | 复杂度 | 要点 |
| --- | --- | --- | --- |
| ~~切片 25~~ | ~~**认真模式**~~ | ~~中~~ | ~~修改标题/内容前给选项确认（agent 式交互），默认模式按预设直接处理。范围：app_settings 迁移（v12）+ wire 选项字段 + useFlashChat 守卫 + Chat 选项交互 + 设置页开关。~~（✅ 已完成，关闭于切片 25，见 `tasks/slice-25-closeout.md`） |
| ~~切片 26~~ | ~~**AI 透明度**~~ | ~~中偏小~~ | ~~A. 提示词查看界面（读 AI_SYSTEM_PROMPT 静态串，轻）；B. AI 回答可选显示 token 消耗/缓存命中率/大致价格（openAiCompatible usage 管道 + 设置开关 + app_settings 迁移——B 涉及 AiParser.parse 返回值扩展，ai.md 契约正常演进需成文）。两子项打包（slice-23 closeout §6 候选 2）；与已完成的 25 同域（flash/设置页），迁移列可同批设计。注：迁移版本号届时顺延（v12 已被切片 25 占用）~~（✅ 已完成，关闭于切片 26，见 `tasks/slice-26-closeout.md`。交付含追加阶段 2b（AI 配置平台化 + DeepSeek 峰谷分层计价，提案 `docs/proposals/slice-26-ai-config-enhancement.md`）与 2c（每平台独立配置槽，保存即激活 + 使用中徽标）；迁移占用 v13）~~ |
| ~~切片 27~~ | ~~**系统日历 live 直读显示**（方案 C）~~ | ~~中偏大（≈1 切片）~~ | ~~Toki 式直读：筛选面板日历显示区多选（app_settings 新列 display_calendar_ids_json，取消独立设置页）+ SystemCalendarReader 扩 color/sourceName + live hook + 四视图合并渲染（只读徽标）+ 与已导入项重叠去重（§5 规则）+ 平台 gating + ui.md/repository.md 契约新增节；写回（D1）如立项走独立变更提案 + 独立切片（须改 §7.15 / repository.md:142 冻结语义）~~（✅ 已完成 2026-11-17，关闭于切片 27，见 `tasks/slice-27-closeout.md`；迁移占用 v14） |
| ~~切片 30~~ | ~~**草稿放弃 + 已删除卡联动 + AI 重试**~~ | ~~中偏小~~ | ~~用户 2026-11-17 提案三效果：①草稿卡可放弃（置灰+「已放弃」角标，纯本地）；②已删条目的结果卡标记已删除（默认 mark，remove 做成配置 flash_deleted_card_display）或直接移除；③AI 服务异常自动重试（ai_retry_max，默认 3，档位 0/1/3/5，固定间隔 1000ms，耗尽再降级）。~~（✅ 已完成 2026-11-17，关闭于切片 30，见 `tasks/slice-30-closeout.md`；schema v15 两列，提交链 15449cb→9aa4f8d→833fa4f→e8a9cc8） |
| ~~切片 28~~ | ~~**数据备份/同步：配置 + 日程（WebDAV）**~~ | ~~大（设计讨论先行，提案 §7.5）~~ | ~~范围澄清见 §3：配置（app_settings/分类/标签）与日程相关数据（items/reminders/channel_presets）都同步；形态（备份恢复 vs 双向同步）与冲突策略待专项讨论，讨论结论落提案再开工。导出已存在（切片 12），主体是导入 + WebDAV。（2026-11-17 被切片 30 插队顺延）~~（✅ 已立项 2026-11-18 为切片 28：用户定案备份拆两类——**配置备份本片**（app_settings + categories + tags 快照上传 WebDAV + 快照列表浏览 + 增量覆盖恢复），数据备份与双向同步拆为后续候选；提案 `docs/proposals/slice-28-config-backup-webdav.md` 五问定案，schema 停留 v15） |
| ~~待定~~ | ~~**数据备份/恢复（WebDAV）**（切片 28 拆分余部）~~ | ~~大（设计讨论先行）~~ | ~~items/reminders/channel_presets 备份与恢复（切片 12 导出格式需扩：tags 完整化、id 关联还原）~~（✅ 已立项 2026-11-18 为切片 31：仅手动备份+恢复、channel_presets 进快照、恢复与配置快照同构、独立 life-data-*.json 各保留 10 份；提案 `docs/proposals/slice-31-data-backup-webdav.md` 六问定案，schema 停留 v15） |
| 待定 | **双向同步（WebDAV）**（数据备份立项时拆分） | 大（设计讨论先行） | 持续双向同步（多设备/云端，变更合流与冲突处理）从未立项；冲突策略/粒度/时机设计空间未定，立项前先开设计讨论；复用切片 28/31 的 WebdavClient/快照列表/滚动删除基础设施。 |
| ~~待定~~ | ~~**切片 31 真机验收补做（4 项）**（2026-11-18 用户批准跳过）~~ | ~~小（预计 30 分钟）~~ | ~~猴王实例 adb 死锁事故（svc wifi disable → 网卡持久化 down，closeout §四）导致剩余真机项未执行：#4 全量还原（卸载重装→WebDAV 快照恢复）、#10 断网/401 文案区分+深浅色、#11 切片 12 导出回归、chips [30,90,120,240]→[10,60]（切片 28 遗留设备态）。猴王恢复（手动开 wifi 或重置实例——重置顺带完成 #4 与 chips）后一次补齐；核心语义已由 15 个仓库单测锁定，补做以可观察流为准~~（✅ 已完成 2026-11-19，见 `tasks/slice-31-closeout.md` §四 补做结果：#4 上会话随实例重置完成；#10 网络错误文案深浅两态截图 + 恢复 sanity「数据备份完成」Alert、#11 分享面板 + 页内提示、chips 经实例重置已是默认 [10,60] 直接确认） |
| 待定 | **闪电录入多提醒与绝对时刻 once**（反馈 F1，2026-11-18） | 中偏大 | 「明天8点、10点提醒」被判「提醒时刻已过去」未创建（现象与根因定性见 `tasks/feedback-log.md` F1）：wire 层无绝对时刻 once 表达字段（RemoteDraftWire 仅 reminderOffsetMinutes/reminderDelayMinutes 相对偏移）+ savePlan 落库链单计划边界（L5）。修复方向：wire 扩 reminders 数组（absolute once，ai.md 契约演进）+ mapper/savePlan 多计划落库 + prompt 约束（绝对时刻用新字段、禁硬塞 offset/delay）；与 L5 合并立项。 |
| 待定 | **AI 对话调试查看器**（反馈 F1 诉求，2026-11-18） | 中 | AI 配置页 2 个开关（「查看本次 AI 的输入」「查看本次 AI 的输出」）；勾选后点击用量消息弹出详情：AI 输入（请求体）/ AI 输出（原始响应）/ 系统生成卡片数据关键数据；两开关均未勾选时点击无反应。数据面沿 provider 副通道先例（lastRequest/lastResponse，lastUsage 同构），请求头含 API Key 不展示；排查 F1 类问题的基础设施。 |
| ~~候选 29a~~ | ~~**闪电录入对话能力强化包**~~ | ~~中偏小~~ | ~~用户 2026-11-17 真机反馈驱动（切片 26 阶段 3 期间发现）：① 编辑意图识别强化——口语纠正短句（「还是30分钟后吧」）在 history 有上一张卡时被远端模型误判为新建（实测：上一轮「10分钟后」编辑成功、下一轮同型短句新建，模型意图判断波动；prompt 需明确「短口语无新事由默认编辑上一张卡」+ 本地兜底评估）；② 「推迟 X 分钟」语义边界 prompt 明确（推迟=基于卡片当前时间；「X分钟后」=说话时刻，实测已按此语义工作，需成文防漂移）；③ 聊天历史预览卡与当前草稿卡视觉区分（历史卡降透明度/加「历史」角标），避免「新添加了一张」误读。①②涉及 prompt.ts（AI_SYSTEM_PROMPT 静态串，切片 26 刚交付只读展示页）+ 可能的 useFlashChat 本地启发式~~ （✅ 已立项并完成 2026-11-17，关闭于切片 29，见 `tasks/slice-29-closeout.md`；本地兜底评估否决，纯 prompt+UI 无迁移） |
| 候选 29b | **AI 日程查询/记忆检索（对话式日程管理）** | 大（设计讨论先行） | 用户愿景（2026-11-17 提出）：日程作为「记忆/RAG 系统」——提问「未来一周有什么安排 / 有没有饭局或就医」→ 意图识别为查询 → 到日程库检索（日程相关操作封装为 tool）→ 查询结果返回标准日程卡片 → 可继续对话修改各属性（复用 FlashPreviewCard 形态）。需要：查询意图路由（录入 vs 查询 vs 编辑）、日程检索 tool（Repository 查询层已有基础：viewQueries/filterSheet 多维筛选可复用）、检索结果卡片化与对话修改链路。**与候选 29a 同域（闪电录入对话能力），建议合并立项或先做 29a 打基础（29a 已于 2026-11-17 立项为切片 29，打基础达成）；29b 编号顺延（立项时编号待定），立项前仍先出设计讨论稿（查询 DSL/tool 接口/上下文注入预算）** |
| 待定 | **手动深浅色切换**（切片 24 后续，用户 2026-11-16 提出，记档不立项） | 小 | app_settings 新列 `theme_mode`（'system'/'light'/'dark'，默认 'system'，addColumns 迁移；版本号立项时顺延——v13 已被切片 26 `show_ai_usage` 占用）+ `src/ui/theme.ts` 偏好 store（useSyncExternalStore，useTheme 返回 resolved scheme，切片 24 全部消费点零改动跟随）+ `profile.tsx`「外观」三选 radio 区。完整设计草案见 `tasks/slice-24-closeout.md` §5；立项时编号待定，后续切片顺延 |
| 待定 | **切片25 候选①：保存后上下文保留或提示语**（来源 slice-25-phase2-feedback §六；切片 29 阶段 3 部分覆盖） | 小偏中 | 现状（切片 29 修订）：保存后 `historyRef` 已从清空改为**播种最后一张卡摘要**（切片 15 JSON 格式，用户批准范围修订）——post-save 短纠正句「还是30分钟后吧」已可用；完整对话上下文仍清零、无提示语。剩余部分：轻改法=保存后提示语「已保存，继续输入将新建条目」；重改法=保留完整对话上下文（需评估与切片 22 遗留决策的冲突）。候选不关闭。 |
| 待定 | **切片25 候选②：已保存条目内容对话式编辑**（来源 slice-25-phase2-feedback §六） | 中 | 已保存条目目前仅窄规则时间修改与快捷顺延；content/category/tags 修改只能走详情页表单。对话式编辑需把「最后保存的条目」挂回上下文并扩展编辑意图语义——与候选①同根，可合并立项。 |
| 待定 | **切片25 候选③：待确认期间补充语义合并**（来源 slice-25-phase2-feedback §六；需变更提案） | 中偏大 | 现状：待确认（pending confirm）期间任何新输入直接取消待确认按普通轮处理（§7.37 冻结交互）。合并=新输入作为补充信息并入待确认草稿——与「任何新输入取消待确认」冻结条款冲突，立项须先出变更提案修订 §7.37。 |
| 待定 | **切片25 候选④：守卫谓词 expressed 上收评估**（来源 slice-25-phase2-feedback §三.2） | 小（先评估） | isEditTurn 代理谓词（编辑词轮∨未表达新时刻）有两个边界：同轮改时间+标题/内容误放行、同时间重述+新标题误拦。评估把 `parsed.expressed` 集合上收 hook 层的代价（AiParser.parse 冻结签名不动，返回值已有结构可查）——纯评估任务，结论决定是否立项。 |
| 插队 | **变更 B：网络渠道后台送达** | 大（变更提案） | 提案重估：前台服务救不了 RN JS 定时器（slice-20 遗留披露 1）→ 原生 AlarmManager 驱动投递 vs Headless 唤醒两路线对比。重复投递 in-flight 缺陷已在切片 21 修复关闭，变更 B 剩后台送达本体。启动时机用户定；提案确认前禁改 `src/notifications/`（§7.17 闸门） |

排序理由：25/26 同在闪电录入/AI 域（useFlashChat、app_settings、设置页），连续做上下文温热、迁移列同批；live 直读（27）用户感知价值最高，4 问已于 2026-11-17 定案并立项；备份体量最大且提案先行，压后。变更 B 时刻可插队。切片 25 收尾新增 4 条候选（保存后上下文/对话式编辑/补充语义合并/expressed 上收评估）为待定项未参与排序，与 27/28 无阻塞关系，下片立项时一并权衡。候选 29a 已完成（关闭于切片 29），29b 编号顺延、不占当前表序。切片 30 已完成（关闭于切片 30），28 顺延解除、回到建议序（下一候选）。候选 28 已于 2026-11-18 立项为切片 28（配置备份先行，拆分决策见提案 `docs/proposals/slice-28-config-backup-webdav.md`）；数据备份拆为待定候选（设计讨论先行），不占当前表序。候选数据备份已于 2026-11-18 立项为切片 31（六问定案见提案 `docs/proposals/slice-31-data-backup-webdav.md`）；双向同步拆为待定候选（设计讨论先行），不占当前表序。2026-11-18 真机反馈 F1/F2 登记于 `tasks/feedback-log.md`，新增两行待定候选（闪电录入多提醒与绝对时刻 once / AI 对话调试查看器）并实证切片 25 候选②，均不占当前表序。

## 3. 语义澄清记录（用户 2026-11-16 提出「配置导入导出 JSON / WebDAV 双向同步」，补录防丢失）

- **已有记录——数据导出**：切片 12 已交付**单向导出**（`src/domain/export.ts` `serializeExportData` + 设置页「导出 JSON」：items + tags 名称数组 + reminders 摘要，version=1）。**导入从未做过**——slice-12 closeout 明载：决策 D 取舍（tags 只含名称数组、Reminder 剔调度内部字段），重导入不能仅凭该 JSON 还原 id 关联。
- **已有记录——WebDAV**：slice-20 排期 v1「slice-24 数据备份 JSON 导出 + WebDAV（大；变更提案先行 §7.5）」顺延至今（slice-21/22/23 closeout §6 → AGENTS §8 ④）。记录语义 = **备份/恢复（一次性快照，单向）**：全量 JSON（items/categories/tags/reminders/channel_presets/app_settings + schema 版本 + 时间戳）、导入结构校验 + 预览页 + 替换语义定夺（整库事务替换 vs 按 id upsert）+ 导入前本地快照兜底；WebDAV 自写 fetch 客户端（PROPFIND/GET/PUT/MKCOL 零新依赖），凭据存 expo-secure-store。
- **无记录（本次补录）——「WebDAV 双向同步」**：持续双向同步（多设备/云端，变更合流与冲突处理）从未立项；slice-8/slice-9 任务卡的「不实现双向同步」是 ICS/系统日历语境，与此无关。
- **用户 2026-11-16 范围澄清（补录）**：WebDAV 同步需**同时支持两类内容**——①**配置**的同步（app_settings 及分类/标签等设置项）；②**日程相关**的同步（items/reminders/channel_presets 等业务数据）。**具体设计待专项讨论**：一次性备份恢复 vs 持续双向同步、冲突策略、同步粒度与触发时机等均未定，建议切片 28 立项前先开设计讨论，结论落成提案（§7.5 提案先行）再开工。

## 4. 无归属遗留（散落披露汇总，L 编号便于引用）

- **L1** 事项 Tab 占位页 `src/app/(tabs)/items.tsx`（「即将上线」，slice-14 阶段 5 留下，独立事项视图无切片归属）。
- **L2** 筛选面板 3 占位行：订阅日历/智能颜色编码/更多日历设置（`src/ui/FilterSheet.tsx:69`，Alert「即将上线」）。
- **L3** 标签删除入口（slice-14 phase3：分类不可删是任务卡明文，标签删除留待后续切片）。
- **L4** 重复提醒的提前偏移分钟数不落库（`docs/contracts/ai.md:74` 契约化已知限制，从未排期补齐）。
- **L5** AI 同现语义单计划：offset+delay 同现只落一条 once（slice-19 遗留 2，「双提醒同现留后续需求再议」）。（2026-11-18 F1 真机实证扩展：绝对时刻 once 多提醒无 wire 字段可表达且被误判「已过去」，见 `tasks/feedback-log.md` F1；修复与新 wire 字段合并立项，见 §2 候选行）
- **L6** 网络渠道重试策略：attemptStatus 仅 ok/failed 一次，无自动重试（slice-18 遗留 5）。
- **L7** 频道级静音时段（slice-18 提案 §10 候选）。
- **L8** 远端间歇「AI 服务暂不可用（返回结构异常）」——isRemoteDraftWire 整体拒绝→降级，当晚复现率高且内容相关（slice-23 遗留披露 1，「独立问题待后续切片排查」，未排查）。
- **L9** 创建流「7点半」半点解析——localFallback 只认整点（slice-22 遗留 3 附注，原拟并入切片 23 提案，实际未做）。
- **L10** 重复系列导入疑缺陷：同一重复系列所有实例共享 event.id → 按现逻辑导入只落首实例（**已复核坐实**，切片 27 阶段 3：导入 6 条只落 3 条，sqlite 证据见 `tasks/slice-27-closeout.md` §四.1；live 直读不受影响——D2 按设计只精确命中首实例，其余实例正常显示。修复涉去重键语义（repository.md v0.9 冻结），须另立变更提案）。
- **L11** release 签名与 ABI 拆分：现为 debug keystore + universal 103MB，正式分发前需自有 keystore（slice-20 排期「其他（延续）」）。
- **L12** 旧列清理：reminders.channel/channel_config 旧列仍在 schema（无 dropColumn 能力，待 schema 清理切片评估，slice-18/19 顺延）。
- **L13** SDK 55 升级（鸿蒙评估 §7.2 建议：与鸿蒙决策解耦但有独立价值，RN 0.81 已不在主流适配视野）。

## 5. 用户手验项（非开发）

- **U1** webhook 回前台不双发实机复验（slice-21 遗留）：webhook 渠道造 once 提醒 → 触发后杀/切后台 → 回前台秒级补发，对照 `C:\Users\Public\webhook-receiver-s20.log` 时间戳应只出现一条 POST。
- **U2** slice-22 真机清单 3/4/5：allDay 卡「全天」无 chips / 无时间待办无日期行无 chips / 保存链失败纯文本不出卡（均有单测覆盖）。
- **U3** slice-22 两条「开周会」once 提醒（11-16 07:20 与 14:50）实际触发观察。
- **U4** 切片 27 矩阵 13 补验：装真机（有订阅日历/CalDAV 环境）验证外部日历在筛选面板日历显示区正常列出（分组头=账户名、色点=服务器色）且 live 行正常（slice-27 closeout §三.13，MuMu 无 CalDAV 环境未验）。

## 6. 契约化已知限制（明确接受，不算任务，防止误判为遗漏）

- 时区伪影 `getDeviceTzid` 返回 UTC（§7.15 明文接受 UTC 坐标系自洽）。
- 「上午9点」无钟点粒度 → allDay 全天（schema 无半天粒度）。
- expo-doctor 2 项预存基线失败（app config 非 CNG、RN Directory 元数据）——closeout 明文不修。
- DeepSeek 峰谷分层计价不做法定节假日识别（切片 26 阶段 2b，ai.md v0.21
  明文）：节假日恰逢工作日时段时按高峰价计，误差方向为高估（估算上界语义
  不变）；如需精确需接入节假日历表，待定候选。
- 鸿蒙适配：现阶段不投入，三个重估触发条件见 `docs/proposals/harmony-assessment.md` §7。

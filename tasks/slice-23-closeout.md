# 切片 23 收尾：闪电录入意图澄清与渠道智能推荐

完成日期：2026-11-16。分支 `task/slice-23`（基点 main @ 8827699）。
阶段 1 commit e51ac5b（上一会话）；本切片主体阶段 2–4 及验收反馈修补见下方提交索引。

## 0. 交付清单

- 功能：强提醒场景 alarm 渠道推荐（远端 prompt + 本地正则）、远端上下文编辑
  （buildHistoryBriefing 摘要块 + 毫秒禁令）、Chat 澄清交互（不出卡+反问+续答合并）、
  渠道标识（⏰/🔔 预览卡与结果卡）、滚动遮挡三轮修补（v6 近底守卫）、主动澄清扩展至
  预约/预订/安排类（顺带问细节）、标题保留主题词+细节进 content（prompt 语义反转 +
  降级合并标题保护）、预览卡与结果卡内容行。
- 契约文档：docs/contracts/ai.md 新增「主动澄清扩展至预约/预订/安排类」节 + v0.19
  阶段 2/3 落点记录节；AGENTS.md §7.35 成文（上一会话）。
- 反馈文件：tasks/slice-23-phase2-3-feedback.md（§7.33 情形 2：Phase 2–3/共 4，
  验收反馈修补段随后续提交滚动更新）。
- 版本：versionName 0.23.0 / versionCode 10（app.json L5 + android/app/build.gradle L95-96）。

### 提交索引（task/slice-23）

| commit | 内容 |
| --- | --- |
| e51ac5b | feat(s23) 阶段 1：AI 契约/Prompt/本地正则（上一会话） |
| 88bc4bf | docs(s23) 阶段 1 反馈文件（上一会话） |
| 9a83956 | feat(s23) 阶段 2：buildHistoryBriefing + prompt 毫秒禁令 + openAiCompatible 注入 |
| 0430fb0 | feat(s23) 阶段 3：useFlashChat 澄清分支/窄规则 guard/appendEditHistory 回正 + channels 快照 + 卡片渠道行 |
| c313076 | docs(s23) Phase 2-3 反馈文件 |
| 229d004 | chore(s23) 版本 0.23.0/versionCode 4 |
| cab0760 | docs(s23) 反馈补 MuMu 实测记录 |
| 44dca30 | fix(s23) 滚动遮挡修补一轮（effect 滚底，v5） |
| 3ffe293 | fix(s23) 滚动遮挡三轮收敛（v6 animated:false + 近底守卫 120px） |
| 2f3bded | feat(s23) 主动澄清扩展至预约/预订/安排类（prompt 澄清节三条） |
| a618171 | feat(s23) 标题主题词 + content 语义（prompt 反转 + chat.ts 降级标题保护 + 预览卡内容行） |
| 5c1abe4 | feat(s23) 结果卡内容行（FlashCardPayload.content 快照） |

## 1. 环境事实

- Windows 原生 bash（GNU bash 5.3，无 MSYS）；构建 JDK：`D:\enviroment\java\jdk\oracle-jdk-17.0.10`。
- MuMu 模拟器：`adb -s 127.0.0.1:16384`（Android 15），包名 `com.vibecoding.life`，
  launcher 用 `adb shell monkey -p com.vibecoding.life -c android.intent.category.LAUNCHER 1`
  （resolve-activity 报 No activity found 不可用）。
- MuMu 已配置 API Key（install -r 保留 SecureStore）→ 实测走远端路径；无 Key 路径由 hook 测试覆盖。
- MuMu 无软键盘（硬件输入模式）：input text 中文直过但空格不可靠（%s）→ 用无空格串；
  坐标恒定：输入框 382,1440 / 发送 816,1437 / 确认添加 667,1321 / 底部 tab 条 y=1503–1600
  每格 225 宽（闪电为第 1 格，中心 ≈112,1550；事项 tab 是「即将上线」占位页）。
- a11y dump：`uiautomator dump /dev/tty` + grep 提取；FlatList 窗口化会裁掉屏外节点，
  判可见性必须 screencap 像素级。

## 2. 数据库/构建事实

- 本切片无 schema 变更（schema 停留 v11）；无新依赖；无 as any；src/notifications/ 与
  src/domain/recurrence/ 零 diff（冻结区未触碰）。
- 构建：`cmd /c "set JAVA_HOME=...&& gradlew.bat assembleRelease --console=plain"`
  （workdir 必须 android/）；构建插曲 mergeDexRelease classes.dex 被残留 daemon 占用 →
  `gradlew --stop` 后重建。
- 验证终态：`npx tsc --noEmit` 0 错；`npx jest --runInBand` 76 套件/1042 用例全过
  （切片基线 74/1012 → +2 套件 +30 用例）；`npx expo-doctor` 2 项预存基线失败无新增
  （app config 非 CNG、RN Directory 元数据）。

## 3. 代码地图（本切片新增/改动）

- src/domain/ai/prompt.ts：AI_SYSTEM_PROMPT——强提醒场景节（阶段 1）、多轮节摘要块基准
  + 毫秒禁令 + 补充轮规则行（title 沿用主题词/细节进 content）、主动澄清节（强提醒 +
  预约/预订/安排类 + 防误伤边界）；buildHistoryBriefing 导出。
- src/domain/ai/openAiCompatible.ts：parse() 拼接 briefing 进 system 消息。
- src/domain/ai/chat.ts：fallbackTurn 降级纠正合并标题保护（expressed title 与上一轮
  不同 → 沿用上一轮 title、原词并入 content）。
- src/domain/ai/localFallback.ts：强提醒关键词 → alarm 渠道（阶段 1，上一会话）。
- src/domain/ai/types.ts：needsClarification/clarificationPrompt 字段（阶段 1）、
  FlashCardReminderSnapshot.channels、FlashCardPayload.content。
- src/domain/ai/cardPayload.ts：reminder.channels / content 透传 + 防御拷贝。
- src/ui/useFlashChat.ts：澄清分支（setDraft(null)+反问+降级补充）、窄规则 guard
  （澄清轮 return false）、appendEditHistory 契约回正（assistant=草稿 JSON）。
- src/ui/FlashPreviewCard.tsx：渠道行 describeDraftChannelLine + 内容行。
- src/ui/FlashResultCard.tsx：describeCardReminderLine（⏰/🔔）+ 📝 内容行。
- src/app/(tabs)/flash.tsx：滚动跟随三轮修补终态（scrollToBottom(force) + nearBottomRef
  120px 守卫 + onContentSizeChange）。
- 测试：prompt.test、openAiCompatible.test、chat.test、cardPayload.test、
  useFlashChat.test（新，hook 测试基建：react-test-renderer+Probe）、
  flashChannelDisplay.test（新）、localFallback.test（阶段 1）。

## 4. 踩坑教训

1. jest.mock 路径必须相对测试文件（src/ui/__tests__/ 下用 '../../data'）。
2. formatItemTime 是 'YYYY-MM-DD HH:mm' 全格式（无独立 HH:mm helper），时刻断言须组合。
3. 静态 prompt 指令节含「上一张卡片草稿摘要」字样 → not.toContain 必须用完整渲染块头
   「上一张卡片草稿摘要（修改时以此为准，禁止新建条目）：」判定。
4. grep 管道吃掉前段 exit code；python -c 内联脚本经管道 exit 139——判定用输出行数。
5. 非倒置 FlatList 不自动跟随新内容：effect 滚底有竞态、animated:true 与窗口化挂载竞速
   停半截；收敛解 = animated:false + onScroll 近底守卫（仅近底或最后一条为 user 时跟随）。
6. sed 改构建文件须核对路径（workdir=android/ 下是 app/build.gradle 不是 android/app/...），
   && 链短路时 tail 读旧日志会误判成功——versionCode 与 BUILD SUCCESSFUL 同验。
7. uiautomator dump 含屏外窗口化节点，可见性判定必须 screencap。
8. 远端澄清/编辑依赖本轮是否降级：降级轮走本地槽位解析（无标题提炼能力），需要 chat.ts
   侧的标题保护兜底（本轮 expressed title≠上一轮 → 沿用+并入 content）。

## 5. 遗留披露

1. 远端间歇「AI 服务暂不可用（返回结构异常），已用本地解析」（isRemoteDraftWire 整体
   拒绝 → 降级），当晚复现率高且内容相关非必现——独立问题待后续切片排查（isRemoteDraftWire
   校验或服务端返回结构漂移）。
2. 上下文合并会把上一轮 tags 带入新输入的卡片（叫醒卡带散步/心情标签）——既有行为未修。
3. once 时间录入「上午9点」无钟点粒度 → allDay 全天（schema 无半天粒度，已知限制）。
4. MuMu 库测试条目可删：叫我起床、提醒吃药、写周报、喝水、流感疫苗、预约体检×2、开周会。
5. FlashPreviewCard 时间行日期重复「2026-11-16 2026-11-16 07:30」（describeDraftTime
   既有格式）——低优观察项。

## 6. 下一候选切片（本次用户提出，归属已定）

1. **认真模式**：修改标题/内容前给选项确认（agent 式交互），默认模式按预设直接处理；
   需 app_settings 迁移 + wire 选项字段 + 守卫 + Chat 选项交互 + 设置页开关——完整切片量，
   未塞入本切片，需先出任务卡/提案。
2. **AI 透明度**：提示词查看界面（读 AI_SYSTEM_PROMPT 静态串，较轻）+ AI 回答可选显示
   token 消耗/缓存命中率/大致价格（usage 管道 + 设置开关 + 迁移）——两者打包一个切片候选。

后续路线（既有）：夜间模式 → 数据备份 JSON+WebDAV（提案先行）；变更 B 网络渠道后台送达
插队候选。开工按 §7.1 逐切片确认。

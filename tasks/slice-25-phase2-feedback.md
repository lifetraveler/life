# 切片 25 · 阶段 2 反馈总结（认真模式 · Chat 确认交互 + 设置页开关）

- 日期：2026-11-16
- 阶段：Phase 2 / 共 3（阶段 1 为 schema v12 + 设置管道 + 域修复；阶段 3 为真机验收矩阵）
- 分支：`task/slice-25`（基点 main @ 3685e52；阶段 1 提交 `0dc462c` + 反馈文档 `9351297`）
- 阶段提交：`feat(s25): 阶段2 认真模式 Chat 确认交互 + 设置页开关`（dc3377c，6 文件 +916/-15）+ 真机缺陷修补提交（见 §六，hash 见 git log）
- 状态：⏸ 暂停等待阶段 3 真机验收矩阵（MuMu 模拟器冒烟验收已完成，见 §六；已披露边界见 §三）

## 一、成果定性：达标

| 维度 | 结果 |
| --- | --- |
| 类型安全 | `npx tsc --noEmit` 0 error |
| 测试 | `npx jest --runInBand` 79 套件 / 1087 用例全过（基线 79/1073 → +0 套件 +14 用例：阶段 2 用例 11 + 修补回归 3，只增不减） |
| expo-doctor | 16/18，2 失败均为预存基线（android/ CNG 同步提示 + RN Directory 元数据），无新增 |
| 真机 | MuMu 模拟器（SM-S9260 profile / Android 15 / fabric）冒烟验收完成：v11→v12 迁移实测 + 缺陷修补回归 + 核心场景通过（§六）；阶段 3 完整矩阵待做 |

## 二、范围落点（阶段提交，5 文件）

| 文件 | 修补 | 解决的问题 |
| --- | --- | --- |
| `src/ui/useFlashChat.ts` | FlashChatMessage kind 扩 `'confirm'` + 新增导出 `FlashConfirmChange`/`FlashConfirmPayload`（confirmId/pendingDraft/bufferedHistory/changes/resolved）；hook 新增 `readCarefulMode`（每轮 `getSettings()` 重读、失败 warn 回退 false）/`cancelPendingConfirm`（未决原地 resolved）/`pushConfirm`；send() 入口先取消未决 pending，runFlashTurn 返回后、draftRef 提交前插守卫（命中→不出新卡不提交草稿/history，旧预览卡保持可见）；新增 `applyConfirm`/`dismissConfirm`（本地处理，不发起 AI 轮次）；applyEdit 与 confirmSave 入口同步取消未决 pending | 任务卡阶段 2-1/2-5：拦截轮状态机 + §7.37 交互形态 |
| `src/ui/FlashConfirmCard.tsx`（新增） | 纯展示确认卡：标题「修改需要确认」+ 拟改字段摘要行（旧→新，空值显示「（空）」）+「应用修改/放弃修改」chips（FlashResultCard 同款样式）；Token 化（§7.36）；busy 时 chips 禁用、resolved 后 chips 隐藏 | 任务卡阶段 2-2：确认消息 UI |
| `src/app/(tabs)/flash.tsx` | renderMessage 加 `kind==='confirm'` 分支（payload 捕获局部 const 再进闭包，不包 row wrapper）；onApply/onDismiss 接线 `chat.applyConfirm/dismissConfirm` | 任务卡阶段 2-3：Chat 列表渲染 |
| `src/app/(tabs)/profile.tsx` | AI 配置区块内加「认真模式」Switch 行（hint「修改标题/内容前先向我确认。」）；useFocusEffect 同一次 getSettings 读 `carefulMode`；新增 `handleCarefulModeChange`（乐观更新→updateSettings({carefulMode})→失败回滚）；保存互斥键 `widgetSavingKey`→`settingsSavingKey` 改名扩权（widget 区块 5 处引用同步改） | 任务卡阶段 2-4：设置页开关，即时生效、重启保持 |
| `src/ui/__tests__/useFlashChat.test.ts` | +2 describe 11 用例：本地路径 8（拦截出卡且草稿不变/应用后提交且新基线生效/放弃不动+幂等/待确认新输入取消+标题不被旧卡污染/改时间不拦/carefulMode=false 全走默认/getSettings 失败回退/澄清先行）+ 远端路径 3（应用后 bufferedHistory 进请求体/放弃后被弃轮不进 history/title+content 双改合并一条） | 基线只增不减；全局 fetch mock 驱动 OpenAICompatibleProvider（先例见测试共用件注释） |

## 三、偏差披露（均已注释说明）

1. **「编辑轮」谓词补齐**：阶段 2 指令字面只写「carefulMode 开 && 当前有展示中的卡片 && diffDraftChanges 命中 title/content」，缺「编辑轮」谓词。按任务卡阶段 2-2 措辞（「编辑轮 diffDraftChanges 命中」）与 §7.37 拦截范围冻结补齐：`isEditTurn = matchesEditIntent(input) || !diff.timeChanged`——hook 层拿不到 `parsed.expressed`，以「编辑词轮 ∨ 本轮未表达新时刻」代理 chat.ts 标题保护三支中的前两支；「带新时刻又带新主题词 = 全新意图不拦」（任务卡阶段 3 矩阵 #2/#4）天然成立。
2. **已知边界（阶段 3 真机观察点，非缺陷）**：① 远端路径一轮同时改时间+标题/内容会被代理判为全新意图不拦（误放行 = 切片 24 旧行为，可接受）；② 同时间重述+新标题（如远端把 10:00 重发一遍但改了标题）会被误拦（误拦截可「放弃修改」恢复旧卡）。两者均为代理谓词的固有代价，待 backlog 评估是否上收 expressed 集合到 hook 层。
3. **超字面披露（防御性扩展）**：`applyEdit`（编辑弹窗回写）与 `confirmSave`（保存落地）入口也取消未决 pending——否则保存后应用 stale pendingDraft 会用旧数据覆盖刚保存的状态；`pushConfirm` 的消息 id 在 setMessages updater 外先捕获再自增。该隐患后在 MuMu 真机实锤为必然缺陷，既有 `push()`/`pushCard()` 已同模式修复——见 §六。
4. **设置页互斥键扩权**：profile.tsx 小组件区块的 `widgetSavingKey` 改名 `settingsSavingKey` 并覆盖认真模式行——app_settings 为单行读改写，两个区块并发写会丢字段（另一区块的 patch 不含对方键值）。

## 四、关键设计落点（阶段 3 消费面）

- **守卫位置**：send() 内 runFlashTurn 返回之后、`historyRef=[...historyRef,...result.historyAppend]; draftRef=result.draft;` 之前；澄清轮分支（needsClarification）在守卫之后、行为不变；拦截时 assistantNote 不进消息流。
- **守卫谓词全量**（注释已同步）：`turnStartDraft !== null && turnStartDraft.needsClarification !== true && result.draft.needsClarification !== true` → `diff.titleChanged || diff.contentChanged` → `carefulMode` → `isEditTurn`。
- **pending 生命周期**：创建（拦截轮）→ 应用（applyConfirm：提交 bufferedHistory 两条 + pendingDraft，setDraft 后预览卡自动刷新）→ 放弃（dismissConfirm：追加「已放弃本次修改，卡片保持原样。」，草稿与 history 均不动）→ 取消（send 入口任何新输入 / applyEdit / confirmSave）。resolved 原地标记，FlatList key（消息 id）稳定。
- **拦截范围**：仅 title/content；时间（窄规则与解析轮）、提醒、渠道、标签均不拦；carefulMode 读取失败回退 false = 默认模式行为与切片 24 完全一致。
- **冻结面零 diff 核实**：`AiParser.parse` 签名零改动、`docs/contracts/ai.md` 零改动、`src/notifications/` 与 `src/domain/recurrence/` 零 diff、零新依赖、无 `any`/`as any`。

## 五、真机验收清单（阶段 3 执行，本阶段预置；前三条已在 MuMu 冒烟中覆盖，见 §六）

- 设置页开关：AI 配置区块「认真模式」可开可关、即时生效、重启保持；与小组件开关互斥（保存中另一行 Switch disabled）
- 任务卡阶段 3 场景矩阵 6 条（默认关回归 → 开启拦截/应用/放弃/新输入取消 → 域修复回归）
- Chat 确认卡深浅色对比度（Token 化）；busy 转圈期间确认卡 chips 呈禁用态

## 六、真机缺陷修补（用户报告 m00248）与 MuMu 模拟器验收

**缺陷**：「闪电录入 提醒我吃药，提交后，系统报错。无法继续录入其他内容」。MuMu 模拟器 logcat 实锤：澄清轮（user + 反问两条相邻 push）必现 `Encountered two children with the same key '.$2'`（15:17 两次复现，reload 后旧 bundle 仍再报），dev 构建 LogBox 报错遮挡全屏 → 用户感知「系统报错、无法继续」。

**根因**：`push()`/`pushCard()` 在 `setMessages` updater 内读 `nextIdRef.current`（自增在 updater 外）——React 18 并发队列重放时相邻两条消息读到同一 id；阶段 2 新增的 `pushConfirm` 已规避该模式，旧 push/pushCard 为切片 22/23 遗留。

**修补**（3 文件，随本反馈文件提交）：
- `src/ui/useFlashChat.ts`：`push`/`pushCard` 的消息 id 改为 updater 外捕获为闭包常量再自增（任何重放语义下 id 恒不相撞），注释说明真机缺陷；`pushConfirm` 注释同步。
- `src/ui/__tests__/useFlashChat.test.ts`：+describe「消息 id 唯一性（切片 25 阶段 2 真机缺陷修补）」3 用例（StrictMode 施压：澄清轮/出卡轮/拦截轮全消息 id 唯一）。jest 环境不触发 fabric 队列重放路径，无法红绿复现真机缺陷——本 describe 固化不变量，结构性修复在任意重放语义下成立。

**MuMu 模拟器验收记录**（127.0.0.1:7555，SM-S9260 profile / Android 15 / fabric，bundle 由本机 Metro 经 `adb reverse tcp:8081 tcp:8081` 提供）：
- 新 bundle 启动：`Migrating from version 11 to 12... Migration successful`——v12 迁移真库实测通过。
- 澄清轮（缺陷回归）：`提醒我吃药` → 反问 + 降级注，**无重复 key 报错**；续答 `明天上午10点` 出卡（吃药 2026-11-17 10:00）——「无法继续录入」消除。
- 默认模式（关）：`地点在第三会议室` → 直接更新卡片（标题保护生效、内容行可见），无确认卡。
- 认真模式（开）：`地点在第五会议室` → 拦截出确认卡（内容 旧→新 摘要 + 应用修改/放弃修改 chips）且旧预览卡不动；应用 → 卡片更新、chips 原地消失（resolved）；二次拦截 diff 基线 = 已应用草稿；放弃 → 「已放弃本次修改，卡片保持原样。」草稿不动。
- 时间修改不拦：`改成明天上午11点` → 「已改为 2026-11-17 11:00（请核对卡片）」。
- 待确认新输入取消：拦截未决时输入 `明天下午3点开会` → pending 原地 resolved（0 残留 chips）、新意图出卡（开会 15:00）且标题不被旧卡污染（§7.37 域修复实测）。已知观察项：新卡 content 随 merge 携带旧卡内容（切片 24 merge 语义，content 非 expressed 字段，阶段 2 范围外，backlog 评估）。
- 保存链路：确认添加 → 结果卡（分类/时间/内容/+15分钟/+1小时 chips）→ 计划页明天分组可见。
- 开关持久化：认真模式开 → force-stop 重启 → Switch 仍为开。
- 全程 logcat（15:41 起）0 次 same key / FATAL / Uncaught / UnableToResolve；验收后测试数据已删除。
- 环境注记：Metro（`npx expo start --dev-client`）+ `adb reverse tcp:8081 tcp:8081` 需在位；adb server 曾被 wedged 进程占死 5037（`Stop-Process` 后重连 MuMu 127.0.0.1:7555 恢复）；Android 15 模拟器 `adb shell input text` 支持中文直输。

## 七、教训（closeout 时汇总）

- **setMessages updater 必须是纯函数、不得读可变 ref**：id 这类「生成即定」的值要在 updater 外捕获为常量——React 18 并发重放会多次执行 updater，updater 内读 `nextIdRef.current` 会让相邻消息撞 id；jsdom/jest 测不出来，真机 fabric 才现形，logcat 是这类缺陷的唯一观测面。
- **jest.clearAllMocks 不清 mockImplementation**：跨 describe 共用 store/fetch mock 时，每个 beforeEach 必须显式复位默认 implementation（无 Key），否则远端用例配置泄漏到后续本地用例（全走远端路径，失败模式隐蔽）。
- **helper 提升到模块级**：describe 内定义的断言 helper 对后续 describe 不可见（测试文件按 describe 分块追加时的固定坑），沿用既有 `assistantTexts()` 模块级先例。

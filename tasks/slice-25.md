# 切片 25：闪电录入认真模式（修改标题/内容前确认）

## 目标
1. 新增「认真模式」设置（默认关）：开启后，闪电录入中 AI 修改**标题或内容**前，先在 Chat 中给出确认消息与快捷选项（agent 式交互），用户确认后才应用；关闭时行为与切片 24 完全一致（预设直接处理）。
2. 拦截范围冻结为 title / content 两个字段；时间/提醒/渠道/标签等字段编辑与全新建卡不拦。
3. 顺带修复切片 24 closeout §5 披露的「新意图误沿用上一张卡标题」域 bug（标题保护谓词与 inheritTags 对齐）。

## 背景与依据
- 需求来源：slice-23 closeout §6 候选 1（用户提出），backlog §2 路线第一位（编号 25）。
- 契约依据：AGENTS.md §7.37（v0.27，随本切片成文入库）。
- 决策注记：守卫放 **useFlashChat 层**（对比上一张展示中卡片与本轮解析结果），不改 `AiParser.parse` 冻结签名，ai.md 契约零改动。

## 强制实施阶段

### 阶段 1：schema v12 + 设置管道 + 域修复（纯逻辑，可单测）
1. `src/db/schema.ts`：app_settings 新列 `{ name: 'careful_mode', type: 'boolean' }`
   （非可选 boolean，addColumns 自动回填 false = 默认关）；schema 版本 11→12。
2. `src/db/migrations.ts`：schemaVersion 12，单条 addColumns（零 unsafeExecuteSql、
   零 UPDATE，沿 v10/v11 惯例与注释风格）。
3. `src/domain/settings.ts`：`AppSettings`（:34）加 `carefulMode: boolean`，
   `DEFAULT_APP_SETTINGS` 同步默认 false。
4. `src/data/WatermelonItemRepository.ts`：app_settings 读层（~:206-220）映射
   carefulMode（防御归一：非 boolean 回退 false）；写层 updateAppSettings patch
   （~:1815-1863）支持 carefulMode。
5. 域修复（切片 24 closeout §5 遗留 1）：`src/domain/ai/chat.ts:87-97` 标题保护块
   加编辑轮谓词守卫——仅 `matchesEditIntent(trimmed) || previousDraft?.needsClarification === true`
   时才沿用上一轮标题（与 :79 inheritTags 同谓词）；全新意图不再误留旧标题。
   远端路径：`src/domain/ai/prompt.ts` 注记「新意图=新建条目，不复用上一张卡标题；
   仅修改类输入以上一张卡草稿为准」。
6. 新增 `src/domain/ai/editDiff.ts`：`diffDraftChanges(previous, next)` 逐字段比较
   返回 `{ titleChanged, contentChanged, ... }`（阶段 2 守卫消费）。
7. 测试：settings 读写归一、editDiff、chat.ts 标题守卫（新意图不沿用/编辑词沿用/
   澄清续答沿用）。

### 阶段 2：Chat 确认交互 + 设置页开关
1. `src/ui/useFlashChat.ts`：`FlashChatMessage` kind 联合类型（:68）扩展
   `'confirm'`，载荷含拟改字段摘要、新标题/新内容文本、pendingDraft 快照。
2. 守卫：turn 管线内——carefulMode 开 && 当前有展示中的卡片 && 编辑轮
   diffDraftChanges 命中 title/content → **不更新草稿不出新卡**，追加 confirm 消息，
   卡片保持旧状态可见。title 与 content 同轮双改只给一条合并确认消息。
3. 快捷选项：confirm 消息底部 chips「应用修改 / 放弃修改」（`src/app/(tabs)/flash.tsx`
   渲染）；**点击本地处理，不发起 AI 轮次**——应用 = pendingDraft 走正常出卡路径；
   放弃 = 仅追加放弃文本，草稿不动。
4. 待确认期间新输入：pending 作废，按普通轮处理。
5. `src/app/(tabs)/profile.tsx`：AI 配置区块（:364 区域）新增「认真模式」Switch 行
   （复用 :407 Switch 先例样式），说明文案「修改标题/内容前先向我确认」；切换即经
   Repository 写 app_settings，即时生效、重启保持。
6. 测试：守卫状态机（拦截→应用/放弃/新输入取消）+ 设置开关写路径。

### 阶段 3：真机验收
场景矩阵（默认关先回归，再开启验证）：
1. 默认（关）：改标题/改内容/改时间直接出卡，与切片 24 行为一致。
2. 认真模式开：改标题→confirm 消息+chips；[应用修改]→卡更新；改内容→同；
   改时间→不拦直接出卡；全新建卡→不拦。
3. [放弃修改]→卡片保持旧状态，随后输入正常处理。
4. 待确认时直接输入新指令→pending 取消，新意图正常出卡且标题不被旧卡污染（域修复）。
5. 设置开关即时生效、重启保持；expo-doctor 确认 v12 迁移真机执行（重启验收）。
6. 标题保护修复回归（默认模式）：「起床」→「后天下午3点开会」新意图，标题不再沿用「起床」。

## 验收标准
1. `npx tsc --noEmit` 0 错；`npx jest --runInBand` 全过（基线 77 套件/1053 用例，只增不减）；
   `npx expo-doctor` 2 项预存基线失败无新增。
2. schema v12 迁移真机执行，旧数据 careful_mode 回退 false，不清库、不改已发布 step。
3. 认真模式开/关行为符合阶段 3 场景矩阵；chips 点击不产生 AI 轮次。
4. 无新依赖、无 `any`/`as any`；`src/notifications/` 与 `src/domain/recurrence/` 零 diff。
5. 文档随切片入库：AGENTS.md v0.27（§7.37 + §8 刷新）与本任务卡。

## 明确不做
- 不拦时间/提醒/渠道/标签编辑；不做逐字段选项（同轮双改合并一条确认）。
- 手动深浅色切换（theme_mode）不在本切片——backlog 待定项独立立项；v12 列号以本卡
  careful_mode 为准，后续切片迁移顺延 v13。
- 不碰冻结区；不引新依赖；不改 `AiParser.parse` 冻结签名。

## 分支与提交
- 从最新 main（d5cb4cc）新建 `task/slice-25`，分阶段提交；
  AGENTS.md v0.27 与本卡随阶段 1 提交。

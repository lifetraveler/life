# 切片 26 阶段 2 反馈总结（AI 透明度 UI 三落点 + hook 接线）

- 日期：2026-11-16
- 阶段范围：Phase 2 / 共 3（AI 透明度 UI：提示词查看页、用量展示开关与单价输入、useFlashChat 用量行接线）
- 分支：`task/slice-26`（基点 main @ `91ed33d`）
- 阶段 1 提交：`d44836b`（域层 usage 管道 + schema v13，25 文件 +1137/−42）
- 阶段 2 提交：`a29a423` feat(s26)（6 文件 +413/−10）；本反馈文件以 docs(s26) 补充提交（§7.33 允许形式，沿用切片 25 先例）
- 状态：**完成，暂停等待阶段 3**（真机验收 + closeout），无阻塞遗留

## 成果定性

| 维度 | 结果 |
| --- | --- |
| tsc | `npx tsc --noEmit` 0 错 |
| jest | `npx jest --runInBand` **81 套件 / 1124 用例全绿**（基线 79/1087；阶段 1 后 81/1118 → 本阶段 +6 用例，只增不减） |
| expo-doctor | 2 项失败 = 预存基线（app config 同步检查 + RN Directory 元数据），无新增 |
| 真机/模拟器 | 本阶段不适用，阶段 3 执行任务卡 §3 十项矩阵 |

## 范围落点

| 文件 | 落点 | 解决的问题 |
| --- | --- | --- |
| `src/ui/useFlashChat.ts` | `readCarefulMode` 升级为 `readTurnSettings`（一次读两开关，失败回退 false/false）；新增 `pushUsageLine`；send() 拦截判定改用 `turnSettings.carefulMode`、澄清/出卡两分支尾接 `pushUsageLine(result.usage, turnSettings.showAiUsage)`；deps 数组同步 | §7.38 开关即时生效（每轮重读）+ 用量行展示；getSettings 由每轮最多两次降为一次 |
| `src/app/(tabs)/profile.tsx` | state `showAiUsage`/`showAiUsageError`；focus load 同步读取；`handleShowAiUsageChange`（乐观更新→updateSettings→失败回滚，与认真模式共用 settingsSavingKey 互斥）；AI 配置 navRow 下新增「AI 提示词」入口；carefulMode 行下新增用量展示开关行（复用 widgetToggle 样式） | §7.38 设置页开关落点 |
| `src/app/settings/ai-prompt.tsx`（新建） | 只读页：`AI_SYSTEM_PROMPT` 全文展示 + 顶部 hint 注明动态拼接部分（时间事实/多轮上下文）不展示；无 TextInput/Clipboard/分享（只读契约）；theme token 全覆盖（§7.36） | §7.38 提示词查看落点 |
| `src/app/_layout.tsx` | 根 Stack 注册 `settings/ai-prompt`（title: 'AI 提示词'） | 路由挂载 |
| `src/app/settings/ai.tsx` | 新增 `parsePriceInput`（空串/非法/非正数→undefined，与 configStore 归一口径一致）；state `priceInput`/`priceOutput`；load effect 回填已存单价；buildConfig 透传两单价（正数才写入）；清除配置重置；Model 下新增单价区（label+hint+两个 decimal-pad 输入） | §7.38 单价配置落点 |
| `src/ui/__tests__/useFlashChat.test.ts` | 新 describe「AI 用量展示」6 条：远端+开启（行内容/顺序/无费用段）、默认关闭、降级轮不展示、设置读取失败回退、单价齐备 `≈0.003600`、拦截轮无新增行 | 阶段 2 行为锁定 |

## 关键设计落点（阶段 3 消费面）

- 用量行格式（`formatAiUsageLine` 单点实现）：`📊 用量：输入 N tokens（缓存 M） · 输出 K · ≈C`，缺段自动省略；费用段 toFixed(6)。
- 拦截轮（认真模式 pushConfirm 分支）无 AI 回复消息 → 不追加用量行；首轮已追加的行保留。
- 单价输入归一：UI 层 `parsePriceInput` 与 configStore 层 `positivePriceOrNull` 口径一致（非正数静默丢弃不整包拒绝）。
- `buildConfig` 丢 timeoutMs 为已知 quirk，本切片按计划不修（现状保持）。
- 展示层不持久化任何用量数据：usage 只在当轮消息流中渲染，重启后聊天历史（内存态）清空即消失。

## 教训

1. theme token API 与页面惯例先行核对：ai-prompt.tsx 初版按猜测写 `theme.background(colorScheme)` 失败——实际 API 是 `useTheme()` → `colors` 对象（键集冻结：background/card/text/textMuted/primary/border/danger/textOnPrimary），照 ai.tsx 惯例重写。
2. write 工具偶发瞬时 EIO（Win32 1175）于新建文件覆写时——原样重试即恢复，无需干预。
3. `makeStyles` 每页各自定义（本工程无共享样式表先例），新页面沿用 per-page makeStyles(colors) 模式。
4. jest mock 的 rejected getSettings 安全性先核对调用点：hook 内 getSettings 仅 send 的 readTurnSettings 与 confirmSave（各自 try/catch），mount effect 不调用，`mockRejectedValue` 不会造成未处理拒绝。

## 教训索引

指向 `tasks/slice-26-closeout.md`（阶段 3 交付，暂未生成）。

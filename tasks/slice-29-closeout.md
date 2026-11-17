# 切片 29 收尾移交（closeout）

> 切片 29：闪电录入对话能力强化包。分支 `task/slice-29`（基点 main @ `0085863`）。
> 三阶段一口气连续完成（§7.33 惯例 1：不写 phaseM-feedback，阶段粒度由本 closeout 承载）。

## §0 交付清单

| 阶段 | 提交 | 内容 | 规模 |
| --- | --- | --- | --- |
| 阶段 1 | `f363cd1` | AI_SYSTEM_PROMPT 多轮节三条款（短纠正句判定 / 推迟语义 / 反向边界防误伤）+ prompt 单测 + 任务卡 + AGENTS.md v0.32（§7.40/§8） | 4 文件 +148/-7 |
| 阶段 2 | `cdbaffc` | FlashResultCard `historical` prop（降透明 + 「历史」角标）+ flash.tsx lastCardId 判定 + 新建渲染单测 | 3 文件 +183/-2 |
| 阶段 3 | `bbed994` | 保存后 history 播种修复（用户批准范围修订）+ D3 加固句 + 单测加固断言 + 卡 §阶段3 记录 + AGENTS §7.40 修订 | 5 文件 +37/-3 |

范围修订披露：阶段 3 真机验收发现**保存清空 history**（`useFlashChat.ts` 原实现 `handleConfirmSave` 内 `historyRef.current = []`）使新条款在保存后结构性失活（对照实验 tokens 铁证，见 §四）。经用户批准做**最小接线修补**：保存后播种 `{ role:'assistant', text: JSON.stringify(保存时草稿) }`（切片 15 格式）替代清空，「每存一张 = 新对话起点」设计语义不变（不跨条目串味，仅摘要块存在）。修订已记入卡「### 阶段 3」小节与 AGENTS §7.40。

反馈文件核对：三阶段一口气完成 → 按 §7.33 惯例 1 不写 phaseM-feedback，本 closeout §四 承载验收结论。

## §一 环境事实

- 模拟器：MuMu（`127.0.0.1:7555`，与 `emulator-5554` 同实例）；adb 全路径 `/c/software/platform-tools/adb.exe`（裸 `adb` 不在 PATH）。
- Metro：`npx expo start --dev-client --port 8081` 后台常驻；验收前 `adb reverse tcp:8081 tcp:8081`；App force-stop 重启加载新 bundle。
- App 配置态（验收全程未动用户配置）：DeepSeek 槽「使用中」，BaseURL `https://api.deepseek.com`，Key 已配（全程掩码未触碰），Model `deepseek-flash`；认真模式 ON；AI 用量展示 ON。
- 矩阵 10 用飞行模式制造断网（未碰用户 Key）；飞行模式已关（`airplane_mode_on=0`，wifi 图标确认）。
- 设备收尾态：深色模式；切片测试 DB 产物留存（开会 11-18 全天、部门例会 11-18 09:00、临时例会 11-17 14:15、吃药 11-17 18:14 带闹钟）＋历史数据（今日下午同步会/明日站立会/晨跑/提醒睡觉×3）；垃圾草稿与待确认卡均已放弃/清除（内存态不入库）。
- 包名事实：dev client 包名 `com.vibecoding.life`（monkey 拉起用，勿用 `com.anonymous.life`）。

## §二 数据库 / 构建事实

- **schema 停留 v14，零迁移**（本片无 schema 变更，符合卡 §1 冻结）。
- `npx tsc --noEmit`：0 错（每阶段提交前均过）。
- `npx jest --runInBand`：**87 套件 / 1209 用例全过**（基线 86/1199 → +1 套件 +10 用例，只增不减）。
- `npx expo-doctor`：2 项预存失败（app config 非 CNG、RN Directory 元数据）无新增。
- 零新依赖；未触碰 `src/notifications/`、`src/domain/recurrence/`、`editIntent.ts`（D1 否决维持）。

## §三 代码地图

| 文件 | 改动 | 对应验收 |
| --- | --- | --- |
| `src/domain/ai/prompt.ts` | 多轮节追加两条款（「短纠正句判定（切片 29）」：摘要块存在时不含新事由名词的短纠正句默认编辑上一张卡、以摘要为基准，无摘要块不生效；「推迟语义（切片 29）」：推迟/延后=卡摘要基准 ±X 平移、X分钟后=说话时刻、同现互不覆盖）+ 反向边界条款修订（含新事由名词的短句如「明天开会」仍全新意图，防误伤）+ D3 加固句（`prompt.ts:92` 附近：推迟/延后类修正禁止把原文写入 title/content） | 矩阵 1/3/5/6 |
| `src/domain/ai/__tests__/prompt.test.ts` | 新 describe「短纠正句与推迟语义（切片 29 §7.40）」+ 既有修改类清单断言更新 | — |
| `src/ui/FlashResultCard.tsx` | `historical?: boolean`（默认 false）：Pressable style 数组追加 `opacity 0.55` + 右上角 absolute「历史」角标（Token 化 `c.card`/`c.border`/`c.textMuted`，`pointerEvents:'none'`）；不加外层 wrapper View（切片 22 行包裹塌缩教训） | 矩阵 7/8/9 |
| `src/ui/__tests__/FlashResultCard.test.tsx` | 新建套件 3 例（默认无角标无 dim / historical 有角标+dim / historical chips 保留可用） | 矩阵 7 |
| `src/app/(tabs)/flash.tsx` | `lastCardId` useMemo（倒序找最后一条 `kind==='card' && cardPayload!==undefined`），card 分支传 `historical={item.id !== lastCardId}`；FlashConfirmCard 不参与 | 矩阵 7/8 |
| `src/ui/useFlashChat.ts` | `handleConfirmSave`（:741 区域）：保存后 `historyRef.current = [{ role:'assistant', text: JSON.stringify(current) }]` 播种替代清空（用户批准修订，注释注明） | 矩阵 1/5 |
| `tasks/slice-29.md` | 阶段 3 小节（范围修订记录） | — |
| `tasks/slice-29-closeout.md` | 本文件 | — |
| `AGENTS.md` | v0.32：§7.40 新增 + §8 刷新；阶段 3 补推迟语义加固句与播种 bullet | — |
| `tasks/backlog.md` | 29a/切片 29 划项关闭 | — |

## §四 真机验收矩阵（卡 §3，11 项全通过）

| # | 场景 | 结果 | 证据/备注 |
| --- | --- | --- | --- |
| 1 | 摘要块+「还是30分钟后吧」→ 编辑不新建 | ✅（修复后） | 修复前 post-save 全新解析复现 2 次（根因=保存清 history，见 §0）；修复后临时例会标题保留、时间 18:11=说话+30，输入 2905 tokens（vs 修复前裸 2745）证明播种进请求 |
| 2 | 「不行，改到明天上午9点」窄规则回归 | ✅ | 「已改为 2026-11-18 09:00」本地窄规则路径（无 usage 行），标题/分类/标签保留 |
| 3 | 「明天开会」仍全新意图 | ✅ | 开会 / 2026-11-18 全天 / 工作 / 标签工作、会议 |
| 4 | 首轮无摘要块「还是30分钟后吧」不崩 | ✅ | 对照实验 T2：按普通解析出草稿，无崩溃（修复后首轮 history 仍空，路径相同） |
| 5 | 「推迟30分钟」=卡基准+30 | ✅ | 18:11→18:41（卡基准），无 content 写入；「推迟」写入 title 的风险已由 D3 加固句约束 |
| 6 | 「30分钟后提醒我吃药」delay 路径 | ✅ | 全新意图：吃药/健康/⏰闹钟（强提醒识别）+ 提醒 30分钟后，startAt 不换算（§7.30） |
| 7 | 3+ 张卡旧卡降透明+角标、最后一张正常 | ✅ | 深色下两历史卡降透明+角标可读；历史卡 chip 实测 +15分钟 → 14:00→14:15（DB+提醒联动，重启后计划页确认持久化） |
| 8 | 保存后最新卡无历史样式 | ✅ | 最后一张卡（吃药）正常透明度无角标 |
| 9 | 深浅色两态可读 | ✅ | `cmd uimode night yes/no` 两态截图核对 |
| 10 | 无 Key/断网降级回归 | ✅ | 飞行模式：降级披露文案 ✓；「改成7点半」窄规则照常 ✓；「还是30分钟后吧」本地按既有边界走原解析（写 content，被认真模式拦截兜住）——不新建错误卡、不崩，D1 边界如实记录 |
| 11 | ai-prompt 只读页含新条款 | ✅ | 三条款完整展示（自动反映 AI_SYSTEM_PROMPT 常量） |

对照实验（usage tokens 铁证）：T1 明天开会 2743 → T2 还是30分钟后吧 2745（无 history）→ T3 明天上午9点部门例会 2853（草稿上下文）→ T4 保存后还是30分钟后吧 2745（与 T2 全同，坐实保存清空）→ T5 mid-flow 还是30分钟后吧 2868（**已更新卡片**，条款在有摘要块时完全生效）。

## §五 踩坑教训

1. **RN jest preset 下 Pressable 类型恒等丢失**：`node.type === Pressable` 匹配不到任何实例（mock 丢类型恒等）——按 prop 形状匹配（样式数组含 opacity 值 / `props.onPress` 是 function + 子树文案，`[...pressables].reverse().find()` 取最内层）。`ReactTestInstance` 无 `.find/.parent` 类型面（TS2339），回调断言需 `as () => void` 窄化。
2. **保存清空 history 是结构性接线缺口**：prompt 条款「无摘要块时本条不生效」依赖 `buildHistoryBriefing` 有料；`handleConfirmSave` 清空后条款失活。诊断利器 = **usage tokens 对照**（同输入 tokens 差值 ≈ history 是否进请求）。保存后播种摘要（切片 15 JSON 格式）是最小修复。
3. **MuMu 飞行模式事故链（重要）**：`adb shell cmd connectivity airplane-mode enable` 会**挂起全部 adb 命令**（MuMu 的 adb 桥接走 guest 内飞行模式会杀的网卡），且 `airplane_mode_on=1` **跨重启持久化**。恢复路径（不走 adb）：`mumu-cli`（`/e/Program Files/Netease/MuMu/nx_main/mumu-cli.exe`）→ `main launch --params "-v:0"` 拉起 → `info --vmindex 0` 轮询 `is_android_started` → **`sh -v 0 -c "cmd connectivity airplane-mode disable"`**（私有 RPC shell，adb 无关，还能注入 `input tap/text`）。`mumu-cli control` 无截图子命令。**结论：MuMu 上造断网一律用 `mumu-cli sh` 开关飞行模式，全程不碰 adb。**
4. **adb server 卡死处置**：git-bash `taskkill //F` 报无效参数；用 `powershell.exe -NoProfile -Command "Stop-Process -Id <PID> -Force"`。
5. dev client 包名 `com.vibecoding.life`（dumpsys `topResumedActivity` 查证）；force-stop 清内存聊天态（草稿/消息全没），DB 保留。
6. v0.30「未保存编辑丢弃」实测：AI 配置页误输入未点「保存配置」直接返回即丢弃，无损害——教训是 input text 前先截图确认焦点落点。
7. 认真模式拦截兜住了本地降级的 content 合并（「修改需要确认：内容 (空)→还是30分钟后吧」）——拦截边界在降级路径同样按设计工作。

## §六 遗留披露

1. **矩阵 1 的「卡 14:00→改 14:30」字面值仅在说话时刻≈14:00 时成立**：D3 冻结语义「X分钟后=说话时刻」优先，实测 18:11=说话+30 记录为通过依据。任务卡措辞未按 D3 校准，属表述瑕疵非行为缺陷。
2. **回复文案不区分编辑/新建**：post-save 修复后短纠正句走「已解析，请核对卡片」（`previousDraft=null` 的 note 分支）而非「已更新卡片」——以内容定性编辑成功；文案美化留作候选。
3. **播种只播最后一张卡摘要**：完整对话上下文保存后仍清零（backlog 切片 25 候选①「保存后上下文保留或提示语」部分覆盖——摘要保留已达成，「提示语/完整保留」设计决策仍待定，候选不关闭）。
4. **本地兜底对短纠正句写 content**（D1 冻结边界，认真模式拦截兜住）；`editIntent.ts` 窄规则不扩展维持否决。
5. backlog U1–U4、L1–L13 状态不变。

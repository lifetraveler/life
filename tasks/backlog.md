# 任务遗留与路线清单（backlog）

> 用途：未完成任务的唯一汇总清单，防止散落在各 closeout「遗留披露/后续候选」里的条目丢失。
> 维护规则：每个切片 closeout 时核对并更新本文件；新候选先记这里，再编号立项；条目关闭时划掉并注明关闭切片。
> 建立日期：2026-11-16（基线 main @ 7a414e6，切片 1–23 完成合并）。

## 1. 已立项未开工

- **切片 24：夜间模式与视觉清理**——任务卡 `tasks/slice-24.md` 已建（未提交）；AGENTS.md v0.26（§7.36 主题与视觉规范）随切片 24 一并提交（用户 2026-11-16 决定）。
  - 阶段 1 `src/ui/theme.ts` Token + `useTheme()` + 两个逻辑修复；阶段 2 全局硬编码色替换 + StatusBar 跟随；阶段 3 `adb shell cmd uimode night yes/no` 真机验收。
  - 打包修复：FlashPreviewCard 时间行日期重复（slice-23 遗留 5）；AI 上下文合并带入上一轮 tags（slice-23 遗留 2）。

## 2. 待编号路线（用户 2026-11-16 委托按进度/复杂度排序；每切片开工仍按 §7.1 逐切片确认）

建议顺序（编号为建议值，立项时可调）：

| 建议编号 | 任务 | 复杂度 | 要点 |
| --- | --- | --- | --- |
| 切片 25 | **认真模式** | 中 | 修改标题/内容前给选项确认（agent 式交互），默认模式按预设直接处理。范围：app_settings 迁移（v12）+ wire 选项字段 + useFlashChat 守卫 + Chat 选项交互 + 设置页开关。需先出任务卡（slice-23 closeout §6 候选 1，用户提出、归属已定） |
| 切片 26 | **AI 透明度** | 中偏小 | A. 提示词查看界面（读 AI_SYSTEM_PROMPT 静态串，轻）；B. AI 回答可选显示 token 消耗/缓存命中率/大致价格（openAiCompatible usage 管道 + 设置开关 + app_settings 迁移——B 涉及 AiParser.parse 返回值扩展，ai.md 契约正常演进需成文）。两子项打包（slice-23 closeout §6 候选 2）；与 25 同域（flash/设置页），迁移列可同批设计 |
| 切片 27 | **系统日历 live 直读显示**（方案 C） | 中偏大（≈1 切片） | Toki 式直读：设置页日历多选（app_settings v12 `display_calendar_ids_json`）+ SystemCalendarReader 扩 color/source + live hook + 四视图合并渲染（只读徽标）+ 与已导入项重叠去重（§5 规则）+ 平台 gating + ui.md/repository.md 契约新增节。**前置：用户回答调研报告 §9 的 4 个开放问题**；写回（D1）如立项走独立变更提案 + 独立切片（须改 §7.15 / repository.md:142 冻结语义） |
| 切片 28 | **数据备份/同步：配置 + 日程（WebDAV）** | 大（设计讨论先行，提案 §7.5） | 范围澄清见 §3：配置（app_settings/分类/标签）与日程相关数据（items/reminders/channel_presets）都同步；形态（备份恢复 vs 双向同步）与冲突策略待专项讨论，讨论结论落提案再开工。导出已存在（切片 12），主体是导入 + WebDAV |
| 插队 | **变更 B：网络渠道后台送达** | 大（变更提案） | 提案重估：前台服务救不了 RN JS 定时器（slice-20 遗留披露 1）→ 原生 AlarmManager 驱动投递 vs Headless 唤醒两路线对比。重复投递 in-flight 缺陷已在切片 21 修复关闭，变更 B 剩后台送达本体。启动时机用户定；提案确认前禁改 `src/notifications/`（§7.17 闸门） |

排序理由：25/26 同在闪电录入/AI 域（useFlashChat、app_settings、设置页），连续做上下文温热、迁移列同批；live 直读用户感知价值最高但有 4 问待决策，排在 26 之后等决策不阻塞进度；备份体量最大且提案先行，压后。变更 B 时刻可插队。

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
- **L5** AI 同现语义单计划：offset+delay 同现只落一条 once（slice-19 遗留 2，「双提醒同现留后续需求再议」）。
- **L6** 网络渠道重试策略：attemptStatus 仅 ok/failed 一次，无自动重试（slice-18 遗留 5）。
- **L7** 频道级静音时段（slice-18 提案 §10 候选）。
- **L8** 远端间歇「AI 服务暂不可用（返回结构异常）」——isRemoteDraftWire 整体拒绝→降级，当晚复现率高且内容相关（slice-23 遗留披露 1，「独立问题待后续切片排查」，未排查）。
- **L9** 创建流「7点半」半点解析——localFallback 只认整点（slice-22 遗留 3 附注，原拟并入切片 23 提案，实际未做）。
- **L10** 重复系列导入疑缺陷：同一重复系列所有实例共享 event.id → 按现逻辑导入只落首实例（系统日历评估 §3 推论，**待真机复核**；live 直读立项时一并处理）。
- **L11** release 签名与 ABI 拆分：现为 debug keystore + universal 103MB，正式分发前需自有 keystore（slice-20 排期「其他（延续）」）。
- **L12** 旧列清理：reminders.channel/channel_config 旧列仍在 schema（无 dropColumn 能力，待 schema 清理切片评估，slice-18/19 顺延）。
- **L13** SDK 55 升级（鸿蒙评估 §7.2 建议：与鸿蒙决策解耦但有独立价值，RN 0.81 已不在主流适配视野）。

## 5. 用户手验项（非开发）

- **U1** webhook 回前台不双发实机复验（slice-21 遗留）：webhook 渠道造 once 提醒 → 触发后杀/切后台 → 回前台秒级补发，对照 `C:\Users\Public\webhook-receiver-s20.log` 时间戳应只出现一条 POST。
- **U2** slice-22 真机清单 3/4/5：allDay 卡「全天」无 chips / 无时间待办无日期行无 chips / 保存链失败纯文本不出卡（均有单测覆盖）。
- **U3** slice-22 两条「开周会」once 提醒（11-16 07:20 与 14:50）实际触发观察。

## 6. 契约化已知限制（明确接受，不算任务，防止误判为遗漏）

- 时区伪影 `getDeviceTzid` 返回 UTC（§7.15 明文接受 UTC 坐标系自洽）。
- 「上午9点」无钟点粒度 → allDay 全天（schema 无半天粒度）。
- expo-doctor 2 项预存基线失败（app config 非 CNG、RN Directory 元数据）——closeout 明文不修。
- 鸿蒙适配：现阶段不投入，三个重估触发条件见 `docs/proposals/harmony-assessment.md` §7。

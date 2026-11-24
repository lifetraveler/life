# 提案：切片 38 — 闪电对话持久化（跨重启 DB 表 + 跨重装快照块）

> 状态：待用户确认。确认后按 §7.1 输出范围再开工。
> 提案依据：用户反馈 F4（2026-11-23「对话重装消失」）→ backlog §2 候选行；四问定案 2026-11-25（本会话 ask_user_question，全推荐项）。

## 1. 背景

- 用户诉求（F4，feedback-log.md）：对话记录（含卡片）没有保存，App 卸载重装后全部消失；期望对话可持久化。
- 现状定性（feedback-log F4 核对）：聊天消息为内存态（useFlashChat `useState` 空数组起步，重启清空；卸载重装连 WatermelonDB 全库清除）。
- 链路现状：切片 37 基础设施温热——schema v19 三新表 createTable 先例、dataSnapshot 可选块双向兼容模式（sparks/sparkAttachments/sparkItems 三块现成）、WatermelonDB Repository 新端口分层模式现成；本次仅扩展不新建模式。

## 2. 四问定案（2026-11-25，全推荐项）

| # | 问题 | 定案 |
| --- | --- | --- |
| Q1 | 持久化档位 | **两档全做**——a) 跨重启：schema v20 新表 + 发送落库 + 启动恢复；b) 跨重装：数据快照追加可选块 chatMessages（随切片 31/35 WebDAV 链路上云） |
| Q2 | 持久化粒度 | **全量文本+结果卡**：'text' 全部（用户输入/助手回复/查询轮/澄清轮）+ 'card' 结果卡（含 payload）；'confirm'/'debug' 瞬态交互态排除；上限最近 200 条滚动裁剪 |
| Q3 | 恢复形态 | **平铺恢复+末卡播种**：重启后原序平铺（非最后 card 自动「历史」角标，切片 29 规则现成）；最后一张卡重新播种进 historyRef（「改一下刚才那个」跨重启可用）；「每存一张=新对话」语义不破坏 |
| Q4 | 隐私与开关 | **无开关默认开**：对话进 DB+随快照上云与 items 全量明文同级别知情（切片 31/35 延续）；零 app_settings 迁移、零设置面 |

## 3. 不做清单（本切片明文不做）

- **不做**对话编辑/删除 UI（重启后历史消息只读展示，仅现存的已删除卡联动生效）；不做跨对话分页/搜索；不做多会话（单线性流 + 200 条滚动）。
- **不做** confirm/debug 持久化（瞬态交互态：确认卡恢复后无对应草稿状态；调试入口消息依赖内存态 lastDebug）。
- **不做** app_settings 开关（Q4 定案无开关）；不做消息级加密。
- **不做**已删除卡的「恢复编辑」（cardPayload.itemId 指向的条目被删后，恢复卡仍走切片 30 已删除联动置灰——现状规则不变）。
- **冻结区零改动**：`src/notifications/`、`src/domain/recurrence/`、`src/domain/export.ts`；不触碰 AiParser.parse/RemoteDraftWire/ChatMessage kind/AI_SYSTEM_PROMPT/retrieval/queryIntent（AI 域零改动——持久化是 UI+数据层）。
- **不做**同步（sync 快照）含聊天块——Spark 先例：聊天仅进数据备份/恢复（kind:'data'），多设备对话同步留候选。
- schema 仅 v20 一新表（v2–v19 step 不动）；无新依赖；app_settings 零迁移。

## 4. 设计决策（D1–D5）

### D1 schema v20 新表 flash_chat_messages

- 列：`seq`(number isIndexed——消息序号=现有 nextIdRef number id，业务键)、`role`(string 'user'|'assistant')、`text`(string)、`kind`(string 'text'|'card')、`card_payload_json`(string isOptional——kind='card' 时 FlashCardPayload JSON)、`seed_json`(string isOptional——保存链播种的 serializeDraftForHistory 输出，末卡恢复播种依据，D3)、`created_at`(number)。
- SCHEMA_VERSION 19→20，createTable 迁移（v19 三新表先例；columns 为字典形态——切片 37 T9 教训）；`ChatMessageModel` 注册。
- 主键用 WatermelonDB 自动 string id；seq 为业务键（恢复排序/幂等 upsert 依据）。

### D2 发送落库（持久化接线）

- `src/data/ChatMessageRepository.ts`（端口）+ `src/data/WatermelonChatMessageRepository.ts`（实现，ItemRepository 分层同构）；方法面：`replaceTail(messages)`（全量 upsert by seq：新消息 insert/已有消息覆盖（保存更新场景 :902 cardPayload 变化）/裁剪 seq < maxSeq-199；confirm/debug 过滤在调用方）+ `listOrdered(limit=200)`（seq 升序）+ `clearAll()`（恢复前的快照替换语义不需要——见 D5 upsert）。repository.md 追加非破坏性注记节。
- useFlashChat 接线：`useEffect([messages])` → 域函数 `persistChatMessages(messages)`（过滤 kind='confirm'|'debug' → repository.replaceTail）；写入节流（消息追加高频场景接受，每次 ≤200 行 upsert 单 batch，量级无害）。直导单例先例（reminderScheduler :77）。
- cardPayload 序列化 `JSON.stringify`（纯数据快照）；恢复 parse 失败 → 该消息降级为 'text' 显示原文（宽容降级，不炸列表）。

### D3 启动恢复 + 末卡播种（Q3）

- useFlashChat mount `useEffect`（一次）：`listOrdered()` → setMessages（seq 升序映射回 FlashChatMessage；id=seq 延续，`nextIdRef = maxSeq+1`）。
- 末卡播种：恢复列表中**最后一条带 seed_json 的 card 消息** → `historyRef = [{role:'assistant', text: seed_json}]`（单条 assistant 条目，buildHistoryBriefing 从末尾向前扫 assistant JSON 可命中）；恢复的摘要块让「改一下刚才那个」跨重启可用。保存链（handleConfirmSave create/update 成功后）写 seed_json 到对应 card 行；本地编辑回写（applyEditToDraft）不落库（瞬态 historyRef，重启后由末卡 seed 兜底）——「每存一张=新对话」语义保持（historyRef 恢复仅末卡单条，下次保存照常重置）。
- 已删除联动：恢复消息进 messagesRef 后，切片 30 useFocusEffect 批量存在性查询自动覆盖（零改动）。
- 恢复消息视觉：非最后 card 自动降透明度+「历史」角标（切片 29 判定规则「最后一条 kind:'card'=当前卡」现成，零改动）。

### D4 数据快照扩展（Q1b，向后兼容）

- kind:'data' version 1 不变 + 追加可选顶层块 `chatMessages: ChatMessageEntry[]`（守卫 `isChatMessageEntry`：seq number/role/text/kind/card_payload_json?/seed_json?/created_at——与切片 37 三可选块同构；缺块跳过=旧快照双向兼容；旧 App 读新快照忽略未知键恢复六/九块）。
- createDataSnapshot 组包追加（listOrdered(200) 全量）；applyDataSnapshot 恢复段：**upsert by seq**（命中覆盖/未命中创建/本地独有保留——items 同构哲学；无文件 IO，恢复在单事务内；无 sparkAttachmentFiles 式披露段）。
- sync 快照（kind:'sync'）不含聊天块（§3 不做清单）。

### D5 滚动裁剪与上限（Q2）

- 200 条滚动：persist 裁剪 `seq < maxSeq-199` 旧行；快照组包取最近 200 条；恢复上限 200（FlatList 反向列表量级无害）。
- 消息 id（seq）在重启后延续（nextIdRef=maxSeq+1），无撞号。

## 5. 文件落点与单测

| 落点 | 变更 |
| --- | --- |
| `src/db/schema.ts` / `migrations.ts` / `models/` / `index.ts` | v20 flash_chat_messages + ChatMessageModel + toVersion 20 |
| `src/data/ChatMessageRepository.ts` / `WatermelonChatMessageRepository.ts` | 新端口+实现（D2） |
| `src/ui/chatPersistence.ts` | persistChatMessages/restoreChatMessages 纯函数（过滤/裁剪/映射） |
| `src/ui/useFlashChat.ts` | persist useEffect + mount 恢复 + 末卡播种（D3）；其余逻辑零改动 |
| `src/domain/dataSnapshot.ts` | chatMessages 可选块（守卫/组包/恢复，D4） |
| `src/data/WatermelonItemRepository.ts` | applyDataSnapshot 追加聊天段 |
| `docs/contracts/repository.md` | 注记节（ChatMessageRepository 新端口成对说明） |
| 单测 | migrationsV20 / ChatMessageRepository upsert+裁剪 / chatPersistence 过滤映射降级 / dataSnapshot 聊天块守卫+缺块跳过+双向兼容 / 恢复播种（Probe） |

## 6. 风险

| 风险 | 缓解 |
| --- | --- |
| messages 高频变更致写放大 | replaceTail 单 batch 幂等 upsert（≤200 行，量级无害）；节流可选 |
| cardPayload 版本演化 | parse 失败降级 text 显示原文，不炸列表 |
| seed_json 与卡片状态漂移 | seed 仅保存链写入（权威时刻快照）；本地编辑回写瞬态由末卡 seed 兜底（披露） |
| 旧 App 读新快照 | isDataSnapshotWire 只查必需键（已核对），未知键忽略；单测锁定 |
| LokiJS batch 撞号（切片 37 T4） | upsert pair 语义（先收集后同批），测试锁定 |

## 7. 验收口径

- `npx tsc --noEmit` 0 错；`npx jest --runInBand` 基线 **119 套件/1707 用例只增不减**；`npx expo-doctor` 2 项预存基线无新增。
- schema v19→v20 真机升级安装 migration 执行验收（AGENTS §5）。
- 真机矩阵（阶段 3 全过）：文本轮重启恢复/结果卡重启恢复（payload 渲染+itemId 联动）/已删除卡联动对恢复卡生效/末卡播种跨重启编辑（「改一下刚才那个」）/confirm/debug 不落库/200 条裁剪/数据备份含聊天块/卸载重装恢复含聊天/旧格式快照回归（缺块跳过）/深浅色。
- APK bump **0.38.0 / versionCode 38**（§5 版本号策略）。

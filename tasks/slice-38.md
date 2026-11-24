# 切片 38：闪电对话持久化（跨重启 DB 表 + 跨重装快照块）

> 基点：main @ f92997c（切片 37 合并 + backlog 立项登记后）
> 分支：`task/slice-38`（从 main @ f92997c 切出，§7.8）
> 提案：`docs/proposals/slice-38-chat-persistence.md`（用户 2026-11-25 四问定案：两档全做 / 全量文本+结果卡 / 平铺恢复+末卡播种 / 无开关默认开）
> 交付纪律：本卡与提案、AGENTS v0.44 随本切片阶段 1 提交（§7.9；不单独提交）。

## 0. 明确不做（禁改清单）

- **冻结区实现文件为空**：`src/notifications/`、`src/domain/recurrence/`、`src/domain/export.ts` 零改动（测试夹具 stub 属编译必需不属实现改动，§7.13）。
- AI 域零改动：不触碰 `AiParser.parse` / `RemoteDraftWire` / `ChatMessage kind` / `AI_SYSTEM_PROMPT` / queryIntent/queryPrompt/queryGuard/retrieval/scheduleQuery（持久化是 UI+数据层）。
- 不做 confirm/debug 持久化；不做对话编辑/删除 UI、跨对话分页/搜索、多会话；不做消息级加密。
- 不做 app_settings 开关（Q4 无开关默认开）；schema 仅 v20 一新表（v2–v19 step 不动）；无新依赖。
- sync 快照（kind:'sync'）不含聊天块（聊天仅进数据备份恢复）；不触碰 spark*/WebDAV 附件链路。

## 1. 设计决策摘要（D1–D5，细则见提案 §4）

- **D1** schema v20 新表 `flash_chat_messages`：seq(number isIndexed 业务键)/role/text/kind('text'|'card')/card_payload_json?/seed_json?（保存链播种 JSON，末卡恢复依据）/created_at；createTable 迁移（columns 字典形态——切片 37 T9 教训）；ChatMessageModel 注册。
- **D2** 发送落库：ChatMessageRepository 端口+实现（replaceTail 全量 upsert by seq——新 insert/已有覆盖（保存更新 :902）/裁剪 seq<maxSeq-199；listOrdered(200)；confirm/debug 过滤在调用方）；useFlashChat `useEffect([messages])` → persistChatMessages；cardPayload parse 失败降级 text。
- **D3** 启动恢复+末卡播种：mount 一次 listOrdered → setMessages（id=seq 延续，nextIdRef=maxSeq+1）；最后一条带 seed_json 的 card → historyRef=[assistant seed_json]（「改一下刚才那个」跨重启可用）；「每存一张=新对话」语义保持（恢复仅末卡单条）；已删除联动/历史卡视觉规则零改动生效。
- **D4** 数据快照扩展：kind:'data' version 1 不变+可选块 chatMessages（isChatMessageEntry 守卫；缺块跳过=双向兼容；旧 App 忽略未知键）；恢复=upsert by seq（命中覆盖/未命中创建/本地独有保留；无文件 IO 单事务）；sync 快照不含聊天块。
- **D5** 滚动裁剪：200 条上限（persist 裁剪+快照组包+恢复上限三处对齐）；seq 重启延续无撞号。

## 2. 三阶段

### 阶段 1：域 + 数据层 + 契约文档
1. schema v20：flash_chat_messages（tableSchema+注释）+ ChatMessageModel + migrations toVersion 20 + 单测 migrationsV20。
2. ChatMessageRepository 端口 + WatermelonChatMessageRepository 实现（replaceTail upsert/裁剪/listOrdered）+ 单测。
3. `src/ui/chatPersistence.ts` 纯函数（过滤 confirm/debug/裁剪/映射/降级）+ 单测。
4. dataSnapshot.ts chatMessages 可选块（守卫/组包/恢复）+ WatermelonItemRepository applyDataSnapshot 追加聊天段 + 单测（缺块跳过/双向兼容/upsert 语义）。
5. `docs/contracts/repository.md` 注记节（ChatMessageRepository 新端口）；AGENTS v0.44（§7.50 + §8）；**提案+本卡随阶段 1 提交**。

### 阶段 2：UI 接线
1. useFlashChat：persist useEffect + mount 恢复 + 末卡播种（D3）；其余逻辑零改动。
2. Probe 测试：恢复播种跨重启编辑链路/已删除联动对恢复卡生效。

### 阶段 3：真机验收 + 收尾
1. 真机矩阵（§3）+ closeout + backlog 划项（F4 候选行关闭）+ AGENTS §8 刷新。
2. APK bump 0.38.0/versionCode 38（§5 版本号策略）。

## 3. 真机验收矩阵（10 条）

1. 文本轮重启恢复：发送文本→force-stop→重开→消息原序出现。
2. 结果卡重启恢复：保存条目→重启→卡片渲染（分类色/时间/提醒行）→点击跳 item/[id]。
3. 已删除卡联动：恢复卡对应条目已删→重启→恢复卡置灰+「已删除」角标（切片 30 规则对恢复卡生效）。
4. 末卡播种跨重启：保存条目→重启→「改一下刚才那个」→编辑轮正常出卡不新建。
5. confirm/debug 不落库：认真模式拦截轮+调试入口消息→重启→不出现。
6. 200 条裁剪：超 200 条后最早消息被裁（DB 检查+恢复上限）。
7. 数据备份含聊天块：立即备份→服务器快照 JSON 含 chatMessages 块。
8. 卸载重装恢复含聊天：卸载→装 0.38.0→恢复数据快照→聊天记录恢复（含卡片）。
9. 旧格式快照回归：恢复切片 31 时代快照（无聊天块）→六/九块正常+聊天块跳过无异常。
10. 深浅色：恢复消息深浅两态（历史卡角标/降透明度）。

## 4. 验收命令

- `npx tsc --noEmit`（0 错）
- `npx jest --runInBand`（基线 **119 套件/1707 用例** 只增不减）
- `npx expo-doctor`（2 项预存基线无新增）
- Android 真机：dev client 重装（无新依赖，可 `adb install -r` 但按 §5 出包 bump 0.38.0/v37→v38）；MuMu/猴王按矩阵执行。

## 5. 风险与注意

- cardPayload JSON 演化：parse 失败降级 text（不炸列表）——测试锁定。
- seed_json 漂移：仅保存链写入（权威）；本地编辑回写瞬态由末卡 seed 兜底（披露）。
- LokiJS batch 撞号（切片 37 T4 教训）：upsert pair 语义测试锁定。
- messages 高频变更写放大：replaceTail 单 batch 幂等（≤200 行）；真机观察流畅度。
- 真机操作沿用切片 37 教训（T5 dump text 与 placeholder 同形/T7 Alert tap 失灵 keyevent 4）。

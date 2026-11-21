# 切片 34 收尾移交 — 已保存条目对话式编辑（targetItemId 回填 + update 落库链）

- 日期：2026-11-21 立项 → 2026-11-22 收尾
- 分支：`task/slice-34`（基点 main @ `862a227`）；提交链 `8c010e7`（阶段 1：域层+落库链+契约+单测）→ 收尾提交（阶段 2：真机验收+closeout+backlog）
- 状态：**完成**（两阶段全部完成；真机矩阵 8/8 通过，F2 关闭）

## 一、交付清单

- 提案 `docs/proposals/slice-34-saved-item-conversational-edit.md`（用户 2026-11-21 三问定案：wire 加键显式回填 / 含提醒增删 / 仅当前基线可编辑）
- 任务卡 `tasks/slice-34.md` + AGENTS.md v0.38（新增 §7.46，随阶段 1 提交）
- 源码 6 文件（阶段 1）：`src/domain/ai/openAiCompatible.ts` / `types.ts` / `guard.ts` / `merge.ts` / `savePlan.ts` / `prompt.ts`；落库链 `src/ui/useFlashChat.ts`（confirmSave update 分支）
- 契约：`docs/contracts/ai.md` v0.25（非破坏性演进，冻结签名/必填键清单零改动）
- 测试 6 文件（+29 用例）：`openAiCompatible/guard/prompt/merge/savePlan` 单测 + `useFlashChat` 集成测试（update 全链/提醒增/降级不存在/降级 sourceReadOnly/无 targetItemId 回归）
- closeout 本文件 + backlog.md 划项（随收尾提交）

## 二、环境与构建事实

- 验收环境：MuMu 猴王实例 adb `127.0.0.1:16384`（900x1600，Android），安装包 `life-0.23.0-v10-s34.apk`（`cd android && JAVA_HOME='F:/code/tools/jdk17/jdk-17.0.21+9' ./gradlew assembleRelease`，108,571,026 字节 universal，不提交）。
- schema **停留 v16 零迁移**；无新依赖；冻结区（`src/notifications/`、`src/domain/recurrence/`、`src/domain/export.ts`）零改动。
- 设备 AI 配置终态：DeepSeek `https://api.deepseek.com` / deepseek-flash / 调试两开关开（用户排障用，保持原样）/ 重试 3 次 / 认真模式测后还原关闭。
- 设备测试数据不清理（惯例）：去买菜、去超市买东西、吃药×2、吃药提醒、取快递、写本周周报、开会。

## 三、代码地图

| 文件 | 改动 | 要点 |
| --- | --- | --- |
| `src/domain/ai/openAiCompatible.ts` | wire +targetItemId | `RemoteDraftWire.targetItemId?: string \| null`（键可缺省宽容、值出现即从严整体拒绝[非串/空串]、null→undefined 归一）；守卫块与 `wireToParsedItemDraft` 透传（reminders v0.23 同构） |
| `src/domain/ai/types.ts` | ParsedItemDraft +targetItemId | `targetItemId?: string`（undefined=未表达=全新意图/本地降级轮，不参与 merge 掩码） |
| `src/domain/ai/guard.ts` | draft 守卫 | undefined 宽容；非串/空串→null 整体拒绝；return 携带 |
| `src/domain/ai/merge.ts` | return 透传 | `targetItemId: next.targetItemId`（路由信号非内容字段，恒取本轮；DraftField 掩码不加键） |
| `src/domain/ai/savePlan.ts` | FlashSavePlan+透传+两个差异纯函数 | `diffOnceReminderPlans(baseline, targets, mode:'replace'|'append')`——once+onceAt 双侧过滤、epoch 经 `resolveCivilTimeToInstant` 换算（分钟分辨率鲁棒）；replace：增 create/减 delete/同 epoch keep 渠道不漂移、**非 once 行与不可解析 epoch 基线恒保留 toKeep**；append：toDelete 恒空、新 epoch 增量。`diffItemTags`——`normalizeTagName` dedupKey 比较，目标空串跳过+去重 |
| `src/domain/ai/prompt.ts` | 五处 | ①`serializeDraftForHistory(draft, tzid, itemId?)` 显式非空串→输出 `itemId` 键（targetItemId 经 rest 透传）；②BriefingDraftShape.itemId；③`parseBriefingItemId`（读 `itemId ?? targetItemId`，**兼容两键=修复 chat.ts 摘要块无 itemId 键的多轮链洞**）；④renderBriefing「关联条目 id」行；⑤AI_SYSTEM_PROMPT 字段定义 targetItemId 行 + 多轮节「编辑已保存条目（切片 34）」bullet（编辑后完整绝对时刻集合/无 id 行一律 null/禁止编造） |
| `src/ui/useFlashChat.ts` | confirmSave 重写 | plan 后 targetItemId 预检（getItemById try/catch→null=`目标条目不存在或已被删除，已按新建处理`、sourceReadOnly=`目标条目为外部导入只读条目，已按新建处理`——**预检挡在写之前**：updateItem 护栏抛错发生在写事务内，先预检转披露降级更干净）；update 分支：updateItem 全量 patch{title,content,type,categoryId,priority}+updateItemTime→diffOnceReminderPlans(baseline, plans, `current.reminders!==undefined?'replace':'append'`)→toCreate/toDelete 逐条失败 warn+披露不中断→diffItemTags→add/removeTagToItem 逐条→seedItemId=基线 id；create 分支含降级（seedItemId=created.id 覆盖陈旧基线）；reconcile 一次失败不阻断；措辞 update=`已更新《title》`/create=`已添加《title》`；播种 `serializeDraftForHistory(current, tzid, seedItemId)` |

## 四、真机矩阵（8/8，任务卡 §3）

1. **① F2 回归 ✅**：「明天上午9点去超市买东西」→保存→「内容加上：记得带伞」→调试弹层一图三验：请求体 history assistant 条目带 `"itemId":"3aGdJRxostcwwqQQ"`（播种键）、模型响应 wire `"targetItemId":"3aGdJRxostcwwqQQ"`（回填，reasoning 自述 field name is targetItemId）、请求体字段定义含 targetItemId 行+多轮节编辑 bullet；确认保存→详情页 content=记得带伞、标签/时间保留、**列表无重复**；首卡置灰+历史角标。
2. **② 提醒减 ✅**：「明天8点、10点提醒我吃药」（闹钟×2）→保存→「去掉10点那条提醒」→模型输出编辑后完整集合 [08:00]→确认→详情页提醒（1）08:00 闹钟已启用、上次对账 2026-11-22 02:44（reconcile 显式一次）。
3. **③ 提醒增 ✅**：「明天下午5点取快递」（无提醒）→保存→「明天下午3点也提醒我」→确认→详情页提醒（1）15:00 系统通知（非强提醒场景走默认渠道）、对账 02:48；结果卡即时反映（🔔 通知行）。
4. **④ 认真模式 ✅**：开关打开→「明天上午9点写周报」出卡→「标题改成：写本周周报」→**「修改需要确认」确认消息（标题 写周报→写本周周报 + 应用/放弃）**→应用→草稿卡标题更新、无新 AI 轮次（§7.37 拦截在 update 改造下零改动复用）；测后开关还原关闭。
5. **⑤ 窄规则回归 ✅**：保存写周报后「改成明天下午4点」→「已改为 2026-11-23 16:00」本地路径（无 AI 轮次）、卡即时更新、列表落库 16:00、取快递卡不受影响。
6. **⑥ 全新意图回归 ✅**：取快递轮（前一张卡=吃药）targetItemId 缺省→create 正常落库，标题/标签未继承污染（§7.40 反向边界）。
7. **⑦ 降级回归 ✅**：BaseURL 追加 `.invalid`（测试连接 Network request failed 佐证）→「后天上午11点开会」→「AI 服务暂不可用（网络错误），已用本地解析（已重试 3 次）」+ 失败轮调试气泡→本地卡（11-24 11:00 工作）→确认→create 落库（周二 24 分组）；**测后 BaseURL 已恢复并核验**。
8. **⑧ 历史卡跳详情 ✅**：点取快递历史卡（置灰+历史角标）→直接导航 item/[id] 详情页（对账 02:51 佐证窄规则轮 reconcile）。

## 五、踩坑与遗留披露

1. **措辞可见性边界（提案 D4-e 落点澄清）**：「已更新《title》」落在消息 data 层（`useFlashChat.ts:1049` message.text + ConfirmSaveResult.message）；切片 22 起结果卡直接作 FlatList 单元渲染、包装文本不显示，且 `flash.tsx:123` Alert 标题硬编码「已添加」仅在有披露时弹（update 无披露=无 Alert 静默原地更新）。措辞由单测断言；Alert 标题未改（提案未覆盖，既有设计）。update 路径带部分失败披露时 Alert 标题仍为「已添加」——已知 cosmetic 边界，披露正文已说明。
2. **摘要块 id 解析兼容 targetItemId 键（偏离提案 :48 字面，阶段 1 已披露）**：chat.ts 两处 historyAppend 场景草稿无 id、输出 JSON 无 itemId 键 → 下一轮摘要块无「关联条目 id」行 → 模型填 null → 退化新建（多轮远端编辑链洞）。`parseBriefingItemId` 读 `itemId ?? targetItemId` 兼容两键修复；播种/回写链路经矩阵①验证。
3. **diffOnceReminderPlans 非 once 行恒保留（阶段 1 实现修正）**：重复提醒与非 once 频率「不参与差异」实现为恒留 toKeep（map+filter 保下标、toDelete 仅 once 行），结果卡快照完整展示；不可解析 epoch（DST gap）基线同样保留不删。
4. **真机操作注意（复用）**：搜狗输入法下 `adb input text` 半角空格会截断——输入串严禁空格；键盘弹起时发送按钮坐标上移，先 `keyevent 111` 收键盘再点发送；AI 配置子页无 tab bar，返回用 `keyevent 4`。
5. **模型行为佐证**：矩阵① reasoning 自述「field name is targetItemId, not itemId」——v0.33 阶段 2 键名对齐（摘要块用 wire 键名）对模型回填同样起效，键名纪律价值再证实。

## 六、验证命令与结果汇总

- `npx tsc --noEmit`：**0 错**
- `npx jest --runInBand`：**98 套件 / 1455 用例**（基线 98/1426 只增不减，+29）
- `npx expo-doctor`：16/18（2 项预存基线失败无新增：app config 非 CNG、RN Directory 元数据）
- 真机矩阵 8/8（§四）；F2 关闭；backlog 划项随收尾提交

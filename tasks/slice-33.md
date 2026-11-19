# 切片 33：deepseek-flash 解析适配（reasoning 拼接与毫秒同化修复）

- 基点：main @ `00b5ce1`（切片 32 合并后）
- 分支：`task/slice-33`（从 main @ `00b5ce1` 切出）
- 提案：docs/proposals/slice-33-deepseek-flash-parsing-adaptation.md（已定案）
- 关联：切片 32 矩阵③（阻塞补验）、feedback-log L8、切片 23 遗留「返回结构异常」

## 0. 明确不做（违反即停）

- 不改 `AiParser.parse` 冻结签名；不改 `RemoteDraftWire` 键纪律与 12 必填键清单（值从严不变）。
- 不消费 `reasoning_content` 字段（不做多渠道 reasoning 形状探测）。
- 不做模型推荐/切换引导 UI。
- 不改 localFallback；不动 lastDebug/lastUsage 副通道。
- 不修「AI 服务暂不可用」的网络类成因。
- 冻结区（实现文件为空）：`src/notifications/`、`src/domain/recurrence/`（civilTime.ts 只 import 不改）、`src/domain/export.ts`。
- 无新依赖；无 schema 迁移（schema 停留 v16）；无 `as any`。
- ui/data-model/repository/notifications/recurrence/build-and-deps 契约零改动（仅 ai.md 演进）。

## 1. 设计决策（详见提案 §3）

- **D1** 尾部平衡 JSON 提取 `extractLastBalancedJson(text): string`：末尾向前扫描配平 `{}[]`（字符串字面量感知+转义处理），取最靠后配平块；无配平块原样返回；纯 JSON 零回归。链序 `extractContent → stripCodeFence → extractLastBalancedJson → JSON.parse`。
- **D2** history assistant 序列化民用化 `serializeDraftForHistory(draft, tzid): string`（prompt.ts 导出）：startAt/endAt epoch→`{date,time}|null`（allDay→time null）、reminders epoch[]→`[{date,time}]`、其余照抄；chat.ts 两处 `historyAppend` 接线（fallbackTurn / runFlashTurn）。`tryParseBriefingDraft`/`renderBriefing` 双形状兼容（number=legacy 毫秒换算渲染、`{date,time}`=新直接渲染）。prompt :108 措辞改写（history 一律民用、摘要块唯一基准、严禁输出毫秒）。
- **D3** ai.md v0.24 变更记录：history 格式演进 + 解析链提取；wire 零改动。
- **D4** L8 定性闭环：修复后真机复验，feedback-log L8 注记（显著回落→「已定性已修复」；仍复现→记录残余症状观察）。
- **D5** 验收矩阵 7 条（见 §3）。

## 2. 阶段

### 阶段 1：域层修复 + 契约文档（纯函数+单测，无 UI）

1. `openAiCompatible.ts`：新增导出 `extractLastBalancedJson`；解析链 :661-662 插入（`stripCodeFence` 之后）。
2. `prompt.ts`：新增导出 `serializeDraftForHistory`；`tryParseBriefingDraft` 判据扩展（startAt/endAt 双形状、reminders 双形状）；`renderBriefing` 渲染分支（民用直接渲染、legacy 换算渲染）；:108 措辞改写。
3. `chat.ts`：两处 `historyAppend` assistant 文本 → `serializeDraftForHistory(draft, deps.tzid)`。
4. 单测（提案 §4.2 清单）：提取矩阵 / 序列化 / briefing 双形状 / chat history 民用断言（旧断言同步更新）。
5. `ai.md` v0.24：头部版本行 + 变更记录条目（history 格式演进 + 解析链提取；wire 键纪律零改动声明）。
6. `AGENTS.md` v0.37：版本行 + §7.45（五条 bullets：捆绑修复定性/extractLastBalancedJson/serializeDraftForHistory+双形状/prompt 措辞/不做清单）+ §8 刷新。
7. 提案+卡随阶段 1 提交。

验收：tsc 0 错；jest 98/1408 只增不减；expo-doctor 2 项预存。

### 阶段 2：真机验收 + 定性闭环 + closeout

1. 真机矩阵 §3（deepseek-flash 配置，MuMu + Metro + adb reverse；调试开关 show_ai_request/show_ai_response 辅助观察 CoT/输出形状）。
2. L8 注记（tasks/feedback-log.md）。
3. backlog 划项 + AGENTS §8 刷新 + closeout（tasks/slice-33-closeout.md）+ §7.9 提交序列。

## 3. 真机验收矩阵（deepseek-flash 主路径）

| # | 场景 | 期望 |
| --- | --- | --- |
| 1 | F1 原句「明天8点、10点提醒我吃药」 | 远端成功轮（无降级），预览卡两条绝对时刻提醒，保存两条 once |
| 2 | 编辑轮「改成明天下午4点」（上一张卡含 reminders） | 远端成功，掩码合并保留提醒（切片 32 矩阵③补验） |
| 3 | 多轮编辑链：新建→改时间→补内容 | 全程远端无降级 |
| 4 | 普通新建（无提醒） | 远端成功 |
| 5 | 长 CoT 句式「提前10分钟和30分钟后各提醒我一次」 | 远端成功轮 |
| 6 | 无 Key | 本地降级路径回归不受影响 |
| 7 | 调试弹层 response | CoT+JSON 原文可见（lastDebug 不变，知悉即可） |

## 4. 验证命令

- `npx tsc --noEmit`
- `npx jest --runInBand`（基线 98 套件/1408 用例，只增不减）
- `npx expo-doctor`（2 项预存基线失败无新增）
- 真机：development build + MuMu 矩阵 §3

## 5. 风险

- 提取误取 CoT 推演片段：尾部扫描+字面量感知+wire 从严守卫兜底（误取→正常降级，不比现状差）。
- 民用序列化精度：getZonedParts 与落库换算同源（civilTime.ts），DST 语义统一。
- 旧毫秒 history 渲染回归：双形状兼容+legacy 单测保持。
- deepseek-flash 毫秒惯性：prompt 措辞+示范双管；复验仍见毫秒键→保持拒绝降级（不做宽容解析）。
- 多轮测试断言同步：旧「history=JSON.stringify(draft)」断言需改为民用形状。

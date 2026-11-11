# 切片 16 · 阶段 2 反馈总结（调度器渠道抽象）

- 日期：2026-11-12
- 阶段：Phase 2 / 4（调度器渠道抽象）
- 分支：`task/slice-16`（基点：阶段 1 末 `f3d1b1d`）
- 阶段提交：`0ea0c8d feat(s16): 阶段2调度器渠道抽象——ReminderChannel 分发 + once 展开 + 网络渠道 timer/对账补发`（23 文件，+2064/-95）
- 状态：✅ 完成（tsc + jest 全绿，无真机步骤），已暂停等待阶段 3 确认

## 一、成果定性：达标，可进入阶段 3

阶段 2 的目标是让调度器按 `reminder.channel` 分发、把 `once` 纳入 occurrenceKey 体系、让网络渠道（webhook/apprise）在纯前端约束下跑通「定时 + 对账补发」。硬指标：

| 维度 | 结果 |
| --- | --- |
| 类型安全 | `npx tsc --noEmit` 0 error |
| 测试 | `npx jest --runInBand` 59 套件 / 729 用例全过，其中新增 43 个用例专测本阶段行为（once 展开 5 + 定时器注册表 9 + Webhook 6 + Apprise 7 + 渠道工厂/闹钟 6 + 调度器分发 10） |
| 提交 | `0ea0c8d`，23 文件 +2064/-95；冻结接口 `ReminderScheduler` 签名零变化 |
| 依赖 | package.json / lockfile 零改动，无新依赖（网络投递走 `globalThis.fetch` + AbortController） |
| expo-doctor | 2 失败均为 slice-14/15 预存基线（WatermelonDB New Architecture 未测、simdjson/widget-snapshot-store 无元数据、CNG 同步提示），零新增 |

架构上最重要的三个决策都按提案落地（docs/proposals/slice-16-reminder-channels.md）：

1. **once occurrenceKey = `once:<reminderId>:<epoch ms>` 独立根前缀**（§2.3 拍板）——与 `recurrence:v1|` 构成双族；`isOurOccurrenceIdentifier` 双族并认，diff/取消/forceRebuild 全部走并集；DST gap 展开为空 + 日志，不抛错不平移。
2. **渠道抽象 = 接口 + 工厂，调度器不认识具体渠道**——`ReminderChannel`（schedule/cancel）与 `NetworkReminderChannel`（追加吞错不抛的 deliver）在 `src/notifications/channels/`，`createReminderChannel` 穷尽 switch；调度器只按渠道 id 查表分发。
3. **网络渠道可靠性边界显式契约化**——`setTimeout` 内存定时器（2^31-1 溢出续链）、不向 OS 注册、10s 超时 + 2xx 即成功、attempts 表进程级抑制双发、missed 每轮 reconcile 立即补发一次、不占 500 调度预算、无 AsyncStorage/WorkManager。at-least-once 边界（timer 成功后、游标推进前进程死 → 重启补发一次）已确认接受并写进 notifications.md。

## 二、做得好的三点

1. **冻结区改造「外扩不内改」**：reconcileDiff 的 `diffNotifications`/`computeMissed` 与 500 预算语义原样保留，新增一律走旁路（once 前缀族、网络桶 pruneExcept、missed 补发循环）；调度器全量重写后 `getLastReconciledAt` 等冻结接口行为不漂移（既有 17 条调度器用例零改动全过即为回归证据）。
2. **可靠性边界不是注释而是契约 + 用例**：at-least-once、attempts 不持久化、每轮一次补发机会，逐条落在 notifications.md v0.16 节，并各有对应测试（attempt ok 抑制补发但游标照推；500 失败后第二轮不再补发；fake timers 全链 timer→fetch）。
3. **渠道切换卫生双向闭环**：system→webhook 清残留 expo 通知、webhook→system 清挂起 timer、disabled/删除后被 `pruneExcept` 收割——三个方向都有专测，避免「换渠道后双发/幽灵通知」这类最难现场排查的脏状态。

## 三、过程中暴露的问题（均已修复，留作教训）

1. **共享可变时钟污染后续用例**：timer 全链测试把 `nowMs` 推进到 fireAt 后未复位，后续用例的窗口过滤 `(now, now+30d]` 把 `fireAt == now` 排除，3 个测试假失败。教训：套件内有可变 `now` 就必须 `beforeEach` 复位，窗口过滤对「恰好等于 now」的边界极敏感。
2. **测试结束时残留的真实 setTimeout 吊住 jest**：system→webhook 用例结束遗留 5 天延迟的真实定时器，Node 事件循环不空转，jest 300s 超时（转后台后 job_kill）。教训：凡结束时可能残留挂起 timer 的用例一律 `jest.useFakeTimers()`，`afterEach` `useRealTimers` 兜底（切回真实计时器即丢弃 fake 队列）。
3. **fake timers 唤醒前未对齐时钟走续链分支**：networkTimers 的 onFire 抛错用例直接 `advanceTimersByTime`，因 `fireAt > now` 被当作 clamp 提前醒来而重挂、不触发。教训：续链重挂让「advance 就触发」不再无条件成立，断言前先让 `now >= fireAt`。
4. **按目录 add 漏掉同目录新文件**：第一次提交只 add 了 `src/domain/recurrence/index.ts`，同目录新建的 `onceOccurrence.ts` 与其测试未入暂存，提交树编译不过；未推送，amend 补入（`0ea0c8d`）。教训：提交后必查 `git status --short`；新文件与修改文件分开核对。
5. **git 首次 add 的 CRLF 提示**为 Windows 常态（`core.autocrlf`），无内容影响，不处理。

## 四、契约合规与遗留风险（按优先级）

1. **契约文档随阶段提交**：notifications.md 追加「once occurrenceKey 与渠道抽象（v0.16，切片 16 阶段 2 落地）」节——once key 格式与双族根前缀、渠道抽象约束（expo 渠道仍受 §4.16–4.20 全部约束、alarm 为高优先级全屏通知模拟不引原生模块）、网络渠道边界（仅 App 存活保证、重启 reconcile 重建、attempts 内存抑制、不占 500 预算、无 AsyncStorage/WorkManager）、多渠道互不干扰。
2. **at-least-once 边界（已接受，非缺陷）**：网络渠道 timer 投递成功后、`markReminderFired` 游标推进前进程死亡 → 重启后该 occurrence 已过点，reconcile 判 missed → attempts 表随进程清空 → 再补发一次。用户已拍板接受；持久化 attempts 属后续增强，不在本切片。
3. **真机实弹验证未做（如实披露）**：阶段 2 无 UI、无 schema 变化，行为由 729 单测背书；webhook/apprise 的真实网络投递与 timer 唤醒留待切片收尾真机步骤（或阶段 3 表单落地后一并验），不构成阶段 2 验收缺口。
4. **阶段 1 遗留照旧**：once→重复频率切换未传时刻时规则列占位 00:00/[]/0 的 UI 引导、debug-reminders 不显示 channel/onceAt、闪电添加 `reminderOffsetMinutes` 降级——全部归阶段 3。
5. **闹钟渠道 iOS 行为**：无 Android 通知通道概念，`ensureAlarmNotificationChannel` 直接返回、trigger 不带 channelId，走普通高优先级通知——与提案「expo-notifications 模拟」一致，iOS 全屏 intents 不在本切片。
6. **`getNetworkArmedKeys()`** 为调试/测试出口（非冻结接口），暴露当前挂起的网络 timer key 列表，方便阶段 3 调试页与真机核对。

## 五、给阶段 3 的一句话建议

调度器渠道分发已闭环（once 展开 + 四渠道路由 + 网络补发），阶段 3 UI 只需消费 `Reminder.channel/channelConfig/onceAt` 做表单与展示：渠道枚举用现成的 `REMINDER_CHANNELS/isReminderChannel`，channelConfig 归一交给 `normalizeReminderChannelFields`（webhook 单 URL / apprise baseUrl+key 或 urls），创建/编辑落库后 `scheduleForReminder` 即正确分发；表单须注明「Webhook/Apprise 仅 App 存活时保证推送」（§7.26.2），once 表单拼接 `{year,month,day,hour,minute}` 即可，epoch 换算与 gap 处理调度器已兜底。

## 附：阶段 2 修改文件清单

- **核心实现**：`src/notifications/ReminderScheduler.ts`（渠道分发重写）、`src/notifications/reconcileDiff.ts`（once 前缀族）、`src/notifications/channels/` 11 文件（types/shared/networkTimers/SystemNotificationChannel/AlarmChannel/BaseNetworkChannel/WebhookChannel/AppriseChannel/appriseConfig/channelFactory/index）、`src/domain/recurrence/onceOccurrence.ts` + `index.ts` 出口
- **测试**：新增 `src/domain/recurrence/__tests__/onceOccurrence.test.ts`、`src/notifications/__tests__/{networkTimers,WebhookChannel,AppriseChannel,channelFactory}.test.ts`、夹具 `channelTestSupport.ts`；扩展 `src/notifications/__tests__/ReminderScheduler.test.ts`（+10 用例）
- **文档**：docs/contracts/notifications.md（v0.16 阶段 2 节）、本文件

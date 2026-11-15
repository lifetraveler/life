# 切片 22 收尾移交（closeout）：闪电录入结果卡片化、快捷推迟与「修改成X点」编辑窄规则

## 0. 交付概览

- **阶段状态**：Phase 1–4 全部完成（本切片经历一次暂停移交：Phase 1–2 完成后写 `tasks/slice-22-phase1-2-feedback.md`；下午续作 Phase 3 并同场完成 Phase 4 真机验收）。
- **提交序列**（分支 `task/slice-22`，基点 main @ `076d291`）：
  | 提交 | 内容 |
  | --- | --- |
  | `78f02c0` | docs(s22)：任务卡 + AGENTS.md §7.34 成文（v0.24） |
  | `02444a0` | 阶段 1：ChatMessage 扩展 kind/cardPayload + buildFlashCardPayload（ai.md v0.18） |
  | `88fa7b2` | 阶段 2：FlashResultCard 卡片 UI + flash.tsx 渲染/跳转 |
  | `569ff17` | 阶段反馈文件（Phase 1–2 暂停移交） |
  | `4f710f0` | 版本号 0.22.0 / versionCode 3（MuMu 误装旧包排查后提升） |
  | `19e8f11` | 反馈文件补 APK 版本行 |
  | `61cc489` | fix：卡片在聊天流中塌缩（去 cardRow wrapper） |
  | `be9a2a0` | 反馈文件补 MuMu 实测与教训 |
  | `59876aa` | 阶段 3 纯函数层：postpone.ts + editIntent.ts + 任务卡范围注记 |
  | `8461034` | 阶段 3 接线：postponeCard（onceAt 联动）+ send() 编辑路径 + onPostpone |
  | 本提交 | closeout + AGENTS.md §8 + 反馈文件终态（Phase 1–3/共 4，实测记录齐） |
- **验收**：`npx tsc --noEmit` 0 错；`npx jest --runInBand` 74 套件 / 973 用例全过（切片前基线 71 / 926，净增 3 套件 47 用例）；`npx expo-doctor` 16/18（2 项预存基线失败，无新增）；MuMu（0.22.0 / versionCode 3）实测出卡、点卡跳详情、塌缩修复复验、推迟 chips（startAt+onceAt 联动原地刷新）、「修改成7点半吧」编辑路径、详情页 DB 真值全部通过。
- **禁止区核查**：`src/notifications/` 零 diff；`src/domain/recurrence/` 零 diff（civilAddDays 以 addOneDay 逐日循环实现于 editIntent.ts 内）；无新依赖；无 `as any`。

## 1. 环境事实（承接 slice-21，均复验）

- 开发机 Windows 11；模拟器 MuMu（`adb -s 127.0.0.1:16384`，Android 15，com.vibecoding.life，密度 320 → 450×800dp，font_scale 1.0，时区 Asia/Shanghai 正确，getDeviceTzid（slice-11 改 expo-localization）无 UTC 伪影）。
- release 构建：`cmd /c "set JAVA_HOME=D:\enviroment\java\jdk\oracle-jdk-17.0.10&& gradlew.bat assembleRelease --console=plain"`（workdir `android/`，必须 `gradlew.bat`，POSIX `./gradlew` 会 cygpath 127）；装机 `adb install -r` → force-stop → monkey LAUNCHER 冷启动。
- a11y 驱动：`uiautomator dump` → pull → `grep -o 'text="…"'` + `paste` 提取（python -c 管道在本环境段错误 exit 139 不可用）；`adb shell input text` 直接过中文（见教训 5）。
- **origin 网络曾不可达**：收尾时 `git fetch`/`git push` 报 `Recv failure: Connection was reset`（github.com/lifetraveler/life.git），网络恢复后已补完 push/merge，见遗留披露 5。

## 2. 数据库/构建事实

- **本切片无 schema 变更**（无 migration、无新表新列）；不触发 §5 新增表验收流程。
- APK 0.22.0 / versionCode 3（`android/app/build.gradle` L95-96 + `app.json` L5，commit `4f710f0`）；Phase 3 后重打装机版本号未升（开发验证包，见遗留披露 6）。
- 数据访问全部复用冻结签名：`updateItemTime`（§4.24）/ `updateReminder`（patch 内 onceAt）/ `createReminder` / `listRemindersByItem`；data 层零改动。
- 详情页数据为 WatermelonDB 响应式查询——推迟/编辑落库后详情页自动反映，未加任何手动刷新或轮询。

## 3. 代码地图

### 准备（commit 78f02c0）
- `tasks/slice-22.md`：任务卡（含阶段 3 范围注记、允许清单扩充、验收 2 扩充——59876aa 二次修订）。
- `AGENTS.md`：§7.34 成文（v0.24）；closeout 时 §8 更新为切片 22（本提交）。

### 阶段 1（commit 02444a0）
- `src/domain/ai/types.ts`：`FlashCardCategorySnapshot` / `FlashCardReminderSnapshot` / `FlashCardPayload`；`ChatMessage` 加可选 `kind?: 'text'|'card'` + `cardPayload?`（**非判别联合**——既有构造点 chat.ts historyAppend 零改动）。
- `src/domain/ai/cardPayload.ts`（新）：`buildFlashCardPayload(created, timePatch, reminder, categories)` 纯函数；startAt/endAt/allDay 取 `plan.timePatch` 落库终值（含切片 19 delay 锚定）；weekdays/onceAt 防御性拷贝；categoryId 未命中 → category null。
- `src/ui/useFlashChat.ts`：`FlashChatMessage.kind` 必填（push 默认 'text'）；`pushCard`；categoriesRef 镜像 + 空时兜底重读（失败 warn 回退空数组）；confirmSave 捕获 `createdReminder`、保存成功出卡片消息 + reminderNotice≠null 补纯文本（Alert 行为不变）。
- `docs/contracts/ai.md`：v0.18 变更记录（兑现 v0.15.1「在此契约补充」）。
- `src/domain/ai/__tests__/cardPayload.test.ts`（新，6 用例）。

### 阶段 2（commit 88fa7b2）与塌缩修复（61cc489）
- `src/ui/FlashResultCard.tsx`（新）：Pressable 白卡 radius16 + 左 4px 分类色条（null→#9E9E9E）+ 分类行（emoji+名）+ 标题 17/700 两行 + 📅 日期行（describeCardDate/describeCardTimeLine 纯函数导出）+ 🔔 提醒行（formatReminderRuleSummary 现算）+ 推迟 chips（flexWrap，onPostpone 未传禁用占位）；maxWidth 320。
- `src/app/(tabs)/flash.tsx`：renderMessage 按 `kind==='card' && cardPayload!==undefined` 分支（payload 捕获窄化）；useRouter 点卡跳 `/item/[id]`。61cc489 去掉 cardRow wrapper（教训 2）。

### 阶段 3（commits 59876aa / 8461034）
- `src/domain/ai/postpone.ts`（新）：`computePostponedStartAt`（绝对毫秒平移，天然 DST 安全）；`computePostponedOnceAt`（onceAt+tzid → resolveCivilTimeToInstant → +Δ → getZonedParts 归民用；解析失败返 null 由调用方跳过联动）。
- `src/domain/ai/editIntent.ts`（新）：`EDIT_VERB_PATTERN`（改成/改到/改为/改至/调成/调到/调为/换到/换成/换为/修改成/修改为/修改到/修改至/修改时间(?:为|成|到|至)/调整(?:成|为|到|至)/更改(?:成|为|到|至)，刻意不含裸「修改」「调整」）；`TIME_TOKEN_START_PATTERN`（动词后紧跟时间 token 才判定，防误伤「修改简历下午3点」「调整说明到下午3点」）；`parseEditTimeRequest`（dayShift 大后天3>后天2>明天/明早/明晚1>今天/今晚/今早0；半→30；午别映射；全角归一；非法时刻→null）；`resolveEditStartAt`（dayShift 相对**今天**经 civilAddDays 逐日推进；时刻缺省保目标时刻、日期缺省保目标日期；gap→null）。
- `src/ui/useFlashChat.ts`：`postponeCard(itemId, minutes)`（busy 守卫 → updateItemTime(startAt+Δ，endAt 有值同 Δ 保时长) → shiftOnceReminders（once 提醒 updateReminder({onceAt})，Map 收集实际顺延）→ reconcile catch warn → updateCard 原地刷新含 reminder 快照 onceAt）；`send()` 开头编辑路径（draftRef 非 null → 改草稿；否则 getLastCardPayload → updateItemTime+shiftOnceReminders+updateCard + push「已改为 …」；失败/不适用推引导文案，不落回解析流程）；messagesRef 镜像 + updateCard + getLastCardPayload + patchReminderSnapshot。
- `src/app/(tabs)/flash.tsx`：卡片分支传 `onPostpone`。
- 单测（新）：`postpone.test.ts` 8 用例；`editIntent.test.ts` 33 用例（意图识别含 7 条防误伤 / 半点·午别·冒号·全角 / 目标日期时刻缺省保留 / America/New_York 春季缺口民用日不漂移与 gap→null）。

## 4. 踩坑教训

1. **Reminder.startAt 为 `number` 非可空**：once 提醒以 fireInstant 落库（savePlan 语义），测试夹具初版写 `null` 触发 TS2322。
2. **row 容器内 flex:1 塌缩**：卡片曾包进 `flexDirection:'row'` wrapper——row 主轴按内容测宽，`flex:1`（flexBasis 0%）body 贡献 0 宽，整卡塌缩只剩 4px 色条且不进 a11y 树；FlashPreviewCard 正常因其父容器为默认 column。推论：**聊天流里的 maxWidth 卡片根布局不要套水平方向容器**，直接作 FlatList 单元渲染。
3. **dayShift 语义是「相对今天」的民用日偏移**，不是相对目标条目日期——「明天/后天」相对说话时刻；首版测试按「目标+1 天」写期望两次跑挂。实现语义正确、测试语义错。
4. **DST gap 用例的目标日必须真正落进缺口日**：dayShift:null 取目标条目民用日（03-07，该日 02:30 存在）不会命中缺口；须 dayShift:1 推进到 03-08。
5. **`adb shell input text` 的 `%s` 空格转义在 MuMu 不可靠**（按字面入库）；验证驱动用无空格中文串「明天下午3点开周会提前10分钟提醒」，本地降级解析靠正则不依赖空格。
6. **python -c 管道在本会话 bash 环境段错误（exit 139）**：a11y 断言提取用 `grep -o` + `paste` 组合替代。

## 5. 遗留披露

1. **真机清单 3/4/5 留用户手验**：allDay 卡「全天」无 chips、无时间待办无日期行无 chips、保存链失败纯文本不出卡——三者均有单测覆盖，真机未逐一驱动。
2. **once 提醒实际触发留观察**：MuMu 库现存两条测试条目「开周会」（11-16 07:20 与 11-16 14:50 once 提醒，兼作触发验证素材）；通知触发属既有链路（本切片未改 `src/notifications/`），前台/后台送达表现不在本切片验收范围。
3. **问题 1（用户验收反馈 2026-11-15，计入本 closeout）——「明天上午8点叫我起床」只建立事项、无提醒**：降级解析层只认显式「提前X分钟提醒」，无提醒渠道建议与询问交互。用户期望：这类场景推荐用闹钟渠道，闪电添加可由 AI 判断哪种提醒方式更合适，并主动询问用户（例：「我将添加 8 点的闹钟，你是否还需要其他提醒方式？」）。不在本切片修复；紧随本切片立「闪电录入解析澄清与渠道建议」切片提案（AI 判断提醒方式建议 + 询问交互 + 远端路径编辑意图；含 ai.md 契约变更，用户已确认排期）。
   - 附：问题 2（紧随其后的「修改成7点半」被建成新事项而非改上一条）已在本切片阶段 3 修复（editIntent 编辑窄规则，MuMu 实测通过，见 §3 阶段 3）。
   - 另：创建流「7点半」半点解析仍是已知限制（localFallback 只认整点），将并入上述提案评估。
4. **编辑窄规则仅降级层语义**：远端 AI Key 路径（AiParser 远端实现）不经此规则；编辑意图在远端路径的表现待后续切片/提示词工作覆盖。
5. **push/merge 收尾已完成（本文档补记时修正）**：closeout 提交时网络尚不可达（`Recv failure: Connection was reset`），后恢复并已按 §7.9 补齐——`git push -u origin task/slice-22` → 切 main `git merge --no-ff task/slice-22`（merge commit `7a47187`）→ `git push origin main`（076d291..7a47187）。分支 task/slice-22 按惯例保留追溯。
6. **版本号在 Phase 3 后未升**：0.22.0 / versionCode 3 覆盖安装（开发验证包不逐阶段升版本号）；如需区分构建可后续升 versionCode 4。

## 6. 后续切片候选（承接 slice-21 排期，加问题 1 插队）

- **紧随本切片**：闪电录入解析澄清与渠道建议切片提案（用户 2026-11-15 确认排期；AI 判断提醒方式并询问用户 + 编辑意图远端路径；含 ai.md 契约变更）。
- slice-23 夜间模式 → slice-24 数据备份 JSON+WebDAV【提案先行】；变更B 网络渠道后台送达为插队候选（确认前不修改 `src/notifications/` 实现文件）。

# 切片 33 收尾移交 — deepseek-flash 解析适配（尾部平衡 JSON 提取 + history 序列化民用化/键名对齐）

- 日期：2026-11-20
- 分支：`task/slice-33`（基点 main @ `00b5ce1`）
- 提案：`docs/proposals/slice-33-deepseek-flash-parsing-adaptation.md`
- 任务卡：`tasks/slice-33.md`
- 状态：两阶段完成（阶段 2 含两处经用户批准的追加修正：B 方案键名对齐 / A 方案播种与回写接线）；真机矩阵 7/7 全过；L8 关闭；切片 32 矩阵③半项补验关闭

## 一、交付清单

| 阶段 | 提交 | 内容 |
| --- | --- | --- |
| 阶段 1 域层+契约 | `736d136` | `extractLastBalancedJson` 尾部平衡提取 + 解析链插入 / `serializeDraftForHistory` + chat 两处 historyAppend 接线 / briefing 双形状兼容 / prompt :108 毫秒措辞改写 / ai.md v0.24 / 提案+任务卡+AGENTS v0.37 随阶段 1 / 三测试文件 +17 用例 |
| 阶段 2 键名修正（B 方案） | `2751555` | `serializeDraftForHistory` 时间键输出 wire 键名 `start`/`end`（矩阵 #3 轮 3 定性 L8 复发根因=history few-shot 键名 startAt 与 wire 必填键冲突）；`tryParseBriefingDraft` 三形状兼容（number=legacy 毫秒 / startAt 键首版民用 / start 键现产物）；测试断言改写 + ai.md/任务卡/AGENTS §7.45 注记 |
| 阶段 2 播种/回写接线（A 方案） | `822d65d` | `useFlashChat.ts` 保存播种（handleConfirmSave）与本地编辑回写（applyEditToDraft）接入 `serializeDraftForHistory`（矩阵 #6 调试弹层发现播种路径毫秒残留）——history assistant 条目四个写入点全部归一；任务卡/ai.md/AGENTS §7.45 注记 |
| 收尾 | 本提交 | closeout / AGENTS §8 终态 / backlog 划项（L8 关闭 + §2 deepseek-flash 候选关闭 + 切片 32 矩阵③补验关闭） |

## 二、环境与构建事实

- 无新依赖（§7.3 合规）；schema 停留 v16 零迁移；冻结区（src/notifications/、src/domain/recurrence/、src/domain/export.ts）零改动；AiParser.parse 冻结签名不变；RemoteDraftWire 键纪律与 12 必填键清单零改动；localFallback/lastDebug/lastUsage 零改动。
- 构建命令：`cd android && JAVA_HOME='F:/code/tools/jdk17/jdk-17.0.21+9' ./gradlew assembleRelease`。APK 覆盖工作区根 `life-0.23.0-v10-s33.apk`（**永不提交**；初版 108565982 → B 方案后 108566130 → A 方案后最终 108566154 字节；版本 0.23.0/versionCode 10），`adb install -r` Success ×3。
- 真机：MuMu 猴王 `127.0.0.1:16384`（SM-S9260；猜猜 `127.0.0.1:16416` 勿用）。AI 配置：DeepSeek 平台/deepseek-flash 档/调试查看输入+输出两开关开；AI 服务重试档位实为 **「3 次（默认）」**——立项记录「0 次（关闭）」系 radio 未选中态误读（见 §五.6），行为正确非缺陷。
- 验证终态：`npx tsc --noEmit` 0 错；`npx jest --runInBand` **98 套件 / 1426 用例全绿**（基线 98/1408，+18 只增不减）；`npx expo-doctor` 2 项预存失败无新增（CNG sync + RN Directory metadata）。

## 三、代码地图（阶段 1+2 全量）

| 文件 | 修改 |
| --- | --- |
| `src/domain/ai/openAiCompatible.ts` | 导出 `extractLastBalancedJson` + 私有 `scanBalancedObjectBackward`（从末尾向前扫描配平 `{}`/`[]`，字符串字面量感知，`"` 边界判定=紧邻其前连续反斜杠数偶数；无配平块原样返回走既有失败路径；纯 JSON 输入零回归）；解析链 extractContent → stripCodeFence → extractLastBalancedJson → JSON.parse；头注释同步 |
| `src/domain/ai/prompt.ts` | 导出 `serializeDraftForHistory(draft, tzid)`：startAt/endAt epoch→民用 `{date,time}\|null`（allDay→time null）、reminders epoch[]→`[{date,time}]`、**时间键输出 wire 键名 `start`/`end`（B 方案）**、其余字段照抄；`BriefingDraftShape` 三形状兼容 + `tryParseBriefingDraft`（start 优先回退 startAt，end 同理；两键皆无才拒绝）；`renderBriefing`/`describeBriefingTime` 双形状渲染（legacy 毫秒换算 + 民用直接）；`AI_SYSTEM_PROMPT` :108 措辞改写（history 一律民用、摘要块唯一民用时间基准、严禁输出毫秒） |
| `src/domain/ai/chat.ts` | fallbackTurn / runFlashTurn 两处 `historyAppend` 接线 `serializeDraftForHistory(draft, deps.tzid)` |
| `src/ui/useFlashChat.ts` | handleConfirmSave 保存播种（`historyRef.current = [{ role:'assistant', text: serializeDraftForHistory(current, tzid) }]`，替代 `[]` 清空）与 applyEditToDraft 本地编辑成功回写（appendEditHistory 第三参传序列化产物）接入同一序列化器（A 方案） |
| `src/domain/ai/__tests__/openAiCompatible.test.ts` | 提取矩阵 7 场景（纯 JSON 零回归/代码围栏+CoT 前缀/多对象取最靠后/字符串内花括号/转义引号/嵌套数组/无配平原样）+ 端到端 CoT 拼 content 成功轮 |
| `src/domain/ai/__tests__/prompt.test.ts` | 序列化民用形状 + **键名对齐 wire（含 start/end、不含 startAt/endAt）** + briefing 三形状渲染一致性 + 毫秒禁令措辞断言改写 |
| `src/domain/ai/__tests__/chat.test.ts` | 无 Key 降级与远端成功轮 history 民用断言（start/end 键、startAt/endAt 键不存在） |
| `docs/contracts/ai.md` | v0.24 变更记录：history 格式演进（民用化+键名对齐+三形状兼容）+ 解析链尾部平衡提取 + 四写入点归一；wire 键纪律零改动 |
| `tasks/slice-33.md` / `AGENTS.md` | 任务卡两处阶段 2 修正注记；AGENTS §7.45 三 bullets 演进 + §8 终态 |

## 四、真机矩阵（7/7，任务卡 §3）

| # | 场景 | 结果 |
| --- | --- | --- |
| ① | F1 原句「明天8点、10点提醒我吃药」 | ✅ 远端成功无降级；两条绝对时刻 once 落库（闹钟·11-21 08:00/10:00），无「提醒时刻已过去」误报；调试弹层 request 含新措辞条款、response content 纯民用 JSON（reminders [{date,time}] 无毫秒） |
| ② | 编辑轮改时间保 reminders（切片 32 矩阵③补验） | ✅ 远端成功 16:00 + reminders 08:00/10:00 保留；「改成…」先被本地窄规则拦截属既有行为非缺陷（上卡无具体时间无从平移） |
| ③ | 多轮编辑链（新建→改时间→改内容） | ✅ B 方案后复测三轮全远端成功零降级；轮 3 调试弹层一图三验：history assistant 民用 `"start":{date,time},"end":null` → 模型输出同形状 → wire 守卫过（上版此处 schema-mismatch，L8 复发实证修复） |
| ④ | 普通新建 + 放弃卡边界 | ✅ 远端成功落库；放弃卡置灰+角标、字段未复用（§7.36/§7.37 边界正确） |
| ⑤ | 长 CoT 混合提醒语义「提前10分钟和30分钟后各提醒我一次」 | ✅ 远端成功；offset（18:00−10min→17:50）+ 绝对（18:30）双计划各自落库，渠道走默认（非强提醒场景） |
| ⑥ | 传输失败降级路径（改坏 BaseURL 法，测后已恢复） | ✅ 「AI 服务暂不可用（网络错误），已用本地解析（已重试 3 次）」+ 本地解析正确（周三=11-25 日期对）+ 失败轮调试可查；本轮发现播种路径毫秒残留 → A 方案修复后补测 ⑦ |
| ⑦ | 调试弹层 response 观察 | ✅ CoT/JSON 原文可见，lastDebug 成功/失败轮保留行为符合预期 |
| ⑧ | 追加：保存→继续编辑（A 方案补测） | ✅ 保存后下轮「地点3楼会议室」远端成功无降级；调试弹层一图四验：播种条目民用 start/end → 摘要块民用 → 模型输出同形状 → 卡片域内毫秒正常（四写入点归一链路闭环） |

## 五、踩坑与遗留披露

**踩坑（复现防护）**：
1. **history few-shot 同化源的演化：毫秒 → 键名**。`serializeDraftForHistory` 首版沿用草稿键名 `startAt`/`endAt`，模型编辑轮照抄输出 startAt 民用对象与 wire 必填键 `start`/`end` 冲突 → schema-mismatch（矩阵 #3 轮 3 复现，模型 reasoning 自述「前面的示例用了 startAt…应该用 start/end」——自我纠正成功轮与失败轮并存，行为不稳定）。教训：**序列化器产物键名必须与 wire 契约键名一致；prompt 措辞压不过 few-shot 同化**。B 方案后复测零降级。
2. **「写入格式」类缺陷修复前先全量盘点写入点**。history assistant JSON 写入点共四处：chat.ts 两处 historyAppend、useFlashChat 保存播种、useFlashChat 本地编辑回写；阶段 1 只接了前两处，矩阵 ⑥ 调试弹层才发现播种路径毫秒残留。漏一处即残留一个同化源。
3. **MuMu 黑帧事故（本片复现两次）**：连续 swipe 后 screencap 恒回 5704 字节全黑帧（guest `screencap -d 0` 报 Status: -2）；wake keyevent/adb kill-server/guest `adb shell reboot`/`mumu-cli control --vmindex 0 launch` 全部无效，**唯一有效恢复 = `mumu-cli control --vmindex 0 restart`（真重启 VM，~70s，数据无损）**。重启后聊天流清空（内存态设计），需重测当前轮。
4. **adb input text 半角空格截断**：空格后内容被设备端丢弃（受控实验 `'QQQ WWW EEE'`→输入框仅「QQQ」实锤）。中文输入文本严禁半角空格（用全角逗号或无空格写法）；#3 轮 2 首测「提醒保留, 」即此根因——模型收到半截文本按摘要照抄，模型行为正确，非本片缺陷。
5. uiautomator dump 对 RN Modal 嵌套 Text 拿不到 text 属性，不能用于读调试弹层全文；受控实验可读 EditText text 属性。
6. **设置值核实要看 radio 实心**：未选中态≠当前值——重试档位立项记录误读为 0 次，实为「3 次（默认）」（我的页重试区截图核实）。
7. 保存→继续编辑场景验证法：调试弹层一图四验（播种条目→摘要块→模型输出→卡片域内毫秒），一步闭环确认全链路。

**遗留披露（非本片范围）**：
1. `reasoning_content` 字段不消费（§7.45 边界，多渠道 reasoning 形状探测不做）。两形态（CoT 散文拼 content / reasoning 独立信封字段）本修复均兼容：前者靠 extractLastBalancedJson 剥离，后者 extractContent 天然只取 content。
2. 传输失败轮调试弹层 response 节显示「本轮未采集到响应」占位文案——lastDebug 冻结语义为「失败轮错误响应文本」，传输层无响应体时无内容可采，既有设计非缺陷。
3. 模型输出稳定性仍属远端侧行为：本修复兼容两形态并经 7/7 矩阵验证，但同模型偶发输出波动依旧存在（切片 32 矩阵①已定性），不属本片修复范围。
4. 猴王设备态还原：BaseURL 已恢复 `https://api.deepseek.com` 并保存；重试档位保持用户原值「3 次（默认）」；调试两开关保持打开（用户排障用，schema 默认关不受影响）。
5. F2（已保存条目再保存=新建重复，存量候选）未回归，不在本片。

## 六、验证命令与结果汇总

- `npx tsc --noEmit` → 0 错（阶段 1 / B 方案 / A 方案三轮均过）
- `npx jest --runInBand` → 98 套件 / 1426 用例全绿（基线 98/1408 → +18）
- `npx expo-doctor` → 2 项预存失败（CNG sync / RN Directory metadata），无新增
- 真机：assembleRelease + install -r + 矩阵 7 项全过（§四）

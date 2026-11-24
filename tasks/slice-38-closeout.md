# 切片 38 closeout — 闪电对话持久化（跨重启 DB 表 + 跨重装快照块）

- 日期：2026-11-25
- 分支：`task/slice-38`（基点 main @ `f92997c`）
- 提案：`docs/proposals/slice-38-chat-persistence.md`（用户 2026-11-25 四问定案）
- 任务卡：`tasks/slice-38.md`（D1–D7 / 矩阵 §3 十条）
- 状态：**切片 38 全部完成**（阶段 1 提交 `20ae3d9`；阶段 2 提交 `28e4ef2`；阶段 3 真机矩阵 10/10 全过 + APK bump 0.38.0/v38 + 收尾，随本提交）

## 〇、交付清单

- 阶段 1（`20ae3d9`，34 文件 +1912/−64）：schema v20 新表 flash_chat_messages（seq isIndexed 业务键/role/text/kind/card_payload_json?/seed_json?/created_at）+ ChatMessageModel（联合类型字段声明）+ migrations toVersion 20（单条 createTable，数组形态）+ database.ts 注册 + ChatMessageRepository 独立端口（PersistedChatMessage/CHAT_MESSAGE_PERSIST_LIMIT=200/replaceTail+listOrdered 文档含空输入 no-op 与守卫语义）+ WatermelonChatMessageRepository 实现（replaceTail 全量 upsert by seq：新 insert/已有 5 字段写穿无变化跳过/未入选 kept prepareDestroyPermanently；空输入 no-op；seq 重复抛错；listOrdered 升序尾窗口）+ `src/ui/chatPersistence.ts` 纯函数映射层（toPersistedChatMessages 过滤 confirm/debugPayload；parseCardPayload 严格顶层守卫；fromPersistedChatRows 平铺+seedText=升序遍历最后一条带 seed 的 card）+ dataSnapshot 可选块 chatMessages（DataSnapshotChatMessage/isDataSnapshotChatMessageEntry 谓词/toDataSnapshotChatMessage 结构化内联组装，域层不反向依赖 data 层）+ WatermelonItemRepository 快照扩展（createDataSnapshot 第十路直查组包 slice(-200)；applyDataSnapshot 聊天段 upsert by seq 命中覆盖/未命中 prepareCreateFromDirtyRaw id=`chat-<seq>` 派生+created_at _raw 保真/本地独有保留/重复 first-wins/形状不符 skipped/恢复侧不二次裁剪）+ ItemRepository 端口注释 + repository.md v0.44 注记节（三节：表列语义+端口+快照可选块+边界冻结）+ 5 新测试套件（migrationsV20/ChatMessageRepository/chatPersistence/dataSnapshot 聊天段/dataSnapshotChatBlock）+ 10 个历史 schema 套件例行刷新（toBe(19)→toBe(20)+链数组+三 spark 时代套件 MODEL_CLASSES 注册 ChatMessageModel）+ AGENTS v0.44/提案/任务卡。
- 阶段 2（`28e4ef2`，2 文件 +279/−14）：useFlashChat 接线（import chatMessageRepository/CHAT_MESSAGE_PERSIST_LIMIT/toPersistedChatMessages/fromPersistedChatRows；refs 区 restoredRef/hydrationRef/hydrated state；hydration effect 守卫防 StrictMode 双跑 listOrdered→fromPersistedChatRows→nextIdRef=maxSeq+1→setMessages→seedText→historyRef 单条→catch warn 按空对话启动→finally restoredRef=true；hydrated 联动 reconcileDeletedCards（声明序在 messagesRef 同步 effect 后）；persist effect ([messages]) restoredRef 闸门 replaceTail fire-and-forget catch warn；send 顶部 await hydrationRef；pushCard 第三参 seedJson；保存链 seedJson 变量提出→historyRef→pushCard）+ FlashChatMessage.seedJson?: string + useFlashChat.test.ts 5 新用例（恢复平铺 id 延续/恢复失败空对话/persist 过滤 confirm/replaceTail reject 不阻断/坏 payload 降级 text+seed 进远端）。
- 阶段 3（本提交）：版本 bump 0.38.0/versionCode 38 + gradlew assembleRelease + 真机矩阵 10/10 全过（含 v19→v20 升级 migration、200 条裁剪三处对齐真机验证、卸载重装恢复、旧格式快照回归、深浅色）+ closeout + backlog 划项 + AGENTS §8 刷新。

## 一、环境事实

- 构建环境：Windows 本机 gradlew assembleRelease；APK 产物 `life-0.38.0-v38`（112225353B，版本 0.38.0 / versionCode 38——§5 随片对齐第三片）。
- 版本 bump 三处：app.json `version: 0.38.0` + android/app/build.gradle `versionCode 38` / `versionName "0.38.0"`。
- 模拟器：MuMu「猴王」emulator-5554（切片 36/37 同机，900×1600）；另有同 VM 双实例 127.0.0.1:16384/16416 在线未用。
- WebDAV 测试服务器：`node .tmp-s35/webdav-server.mjs`（127.0.0.1:5280，root `.tmp-s35/webdav-root/`，auth life/life-pass）+ `adb reverse tcp:5280`；**AI mock 服务器 `node .tmp-s38/ai-mock.mjs`（0.0.0.0:5281，OpenAI 兼容 /chat/completions）+ `adb reverse tcp:5281`**——设备无 AI Key（切片 37 卸载重装遗留），矩阵④编辑轮必须远端路径（本地降级不做编辑意图兜底改写 §7.40），mock 扫描 history 中带 itemId 的 assistant JSON（serializeDraftForHistory 形状）返回 targetItemId 编辑 wire 或新建 wire，日志落 `.tmp-s38/ai-mock.log`（user/hasSeed/seedItemId 逐轮）。
- 升级安装：v19 库存量 → `adb install -r` 0.38.0 APK → v20 迁移验收；矩阵另做卸载重装全新库恢复链路。
- 设备 AI 配置：自定义平台 BaseURL `http://127.0.0.1:5281/v1` + mock-key + mock-model（SecureStore，不进快照）；开关态：认真模式/对话式查询/调试输入/调试输出全开、AI 用量展示关。

## 二、数据库/构建事实

- schema v19→v20：单条 createTable（flash_chat_messages 七列：seq number+isIndexed / role / text / kind / card_payload_json isOptional / seed_json isOptional / created_at），零 unsafeExecuteSql；v2–v19 step 零改动；migrations.ts 头注释补 v19+v20 两行（v19 行原缺失）。
- 升级安装验收（行为级）：install -r 后启动无崩溃、计划存量数据完整（开会 16:00/写周报/健身/去超市买东西/写本周周报/吃药/取快递等原样）；闪电页 persist 写入成功+listOrdered 读取成功本身即 v20 表可写的运行时证据。**logcat「Migrating from version 19 to 20」日志未采集**（切片 37 惯例用了 logcat 实证，本片疏漏，以行为级验收代替——见 §六 遗留披露 1）。
- ChatMessageModel 字段按联合类型声明（`kind!: 'text' | 'card'`，SparkAttachmentModel.kind 先例）消除 as 强转；prepareDestroyPermanently 返回 Model 非 Promise（db.batch 签名 `$ReadOnlyArray<Model | Model[] | null | void | false>` 不收 Promise——阶段 1 曾误用 Array<Promise<unknown>> 报错）。
- 行 id 派生：快照恢复未命中行 id=`chat-<seq>`（行 id 无语义、seq 唯一→行 id 唯一）；created_at 经 _raw 保真（_status:'created',_changed:''）；App 内 replaceTail 新 insert 走 db.create 自动行 id。
- expo-doctor：2 项预存失败无新增（@nozbe/watermelondb New Architecture 未测 + RN Directory metadata 缺失 battery-optimization/widget-snapshot-store/@nozbe/simdjson）。
- 测试基线：**123 套件/1750 用例全绿**（基线 119/1707 只增不减，+4 套件 +43 用例）；`npx tsc --noEmit` 0 错。新套件 5：migrationsV20/ChatMessageRepository（10）/chatPersistence（12）/dataSnapshot 聊天段（扩展现文件）/dataSnapshotChatBlock（8）；useFlashChat 40→45。

## 三、代码地图（新增/修改）

新增：
- `src/db/models/ChatMessageModel.ts` — static table='flash_chat_messages' + @field('seq') + @text role/kind（联合类型）+ cardPayloadJson/seedJson string|null + @readonly @date createdAt；无 associations。
- `src/data/ChatMessageRepository.ts` — 端口：PersistedChatMessage{seq,role,text,kind,cardPayloadJson,seedJson}；CHAT_MESSAGE_PERSIST_LIMIT=200（persist 裁剪/快照组包/恢复上限三处对齐的唯一常量）；replaceTail(messages)（空输入 no-op 防启动恢复竞态清库；seq 重复抛 'duplicate seq'；role/kind 枚举守卫；kept=升序尾 200；命中覆盖 5 字段无变化跳过 prepareUpdate；未入选 prepareDestroyPermanently 含 remove 模式 ghost 行清理）；listOrdered(limit)（Q.sortBy seq asc 全读 slice(-limit)；limit 非正整数抛错；读路径 role/kind 非法抛错）。
- `src/data/WatermelonChatMessageRepository.ts` — 实现（单 db.write 全表读→同步收集 operations→单次 db.batch 两遍法）。
- `src/ui/chatPersistence.ts` — 纯函数层（不依赖 RN）：parseCardPayload（JSON.parse try/catch + 严格顶层守卫：itemId 非空串/title/content 串/type 枚举/startAt,endAt isFiniteNumber|null/allDay boolean/category null|{id,name,color,emoji}/reminders 数组+isReminderSnapshotLike（id/frequency 枚举/localTimeHour,Minute isInteger 0-23,0-59/weekdays number[]/dayOfMonth 整数/onceAt null|{year,month,day,hour,minute} 整数——月历有效性不在守卫层、由落库层判定/tzid 串/channels 串数组））；toPersistedChatMessages（过滤 kind==='confirm' 与 debugPayload!==undefined；seq=id；cardPayload JSON.stringify；seedJson 直传）；fromPersistedChatRows→RestoredChatState{messages,seedText}（id=seq 平铺；card 行 payload parse 失败降级 kind:'text' 不炸列表；seedText=升序遍历最后一条带 seedJson 的 card 行=从尾向前第一条，payload 降级不影响 seed 可用性）。自写 isFiniteNumber/isInteger type predicate（Number.isInteger 非 type predicate，比较 unknown 报 TS18046）。

修改：
- `src/db/schema.ts`（SCHEMA_VERSION=20+表定义详注）/ `src/db/migrations.ts`（toVersion 20+头注释）/ `src/db/database.ts`（注册）。
- `src/domain/dataSnapshot.ts` — DataSnapshot 追加可选 chatMessages?（version 1/kind 不变双向兼容，切片 37 可选块模式同构）+ DataSnapshotChatMessage 接口 + CHAT_MESSAGE_ROLES/KINDS 常量 + isDataSnapshotChatMessageEntry 谓词（seq isIntInRange(1,MAX_SAFE_INTEGER)/role/kind 枚举/text 串/两 JSON 列 isNullableString/createdAt isFiniteNumber；payload/seed JSON 可解析性不在谓词层）+ toDataSnapshotChatMessage(Omit<…,'createdAt'>, createdAt)（结构化内联入参，不反向依赖 data 层）+ DataSnapshotApplyResult.applied 注释补聊天块口径。
- `src/data/WatermelonItemRepository.ts` — FLASH_CHAT_MESSAGES_TABLE 常量；createDataSnapshot 十路 Promise.all（第十路 Q.sortBy seq asc 直查表不经 chatMessageRepository）+ chatMessages slice(-200).map(toDataSnapshotChatMessage)（新快照恒携带键可为空数组）；applyDataSnapshot 读相位 chatModels 全读+chatBySeq Map+聊天段（upsert by seq：命中 5 字段无变化幂等不写不计/有变化 prepareUpdate 计 applied/未命中 dirtyRaw 创建计 applied/重复 seq first-wins skipped/形状不符 skipped/缺 chatMessages 键整段跳过/恢复侧不二次裁剪）。
- `src/data/ItemRepository.ts` — 端口 createDataSnapshot/applyDataSnapshot doc 补 §7.50 D3 聊天块语义段。
- `src/data/index.ts` — chatMessageRepository 单例装配 + export type ChatMessageRepository/PersistedChatMessage + export CHAT_MESSAGE_PERSIST_LIMIT。
- `src/ui/useFlashChat.ts` — 见交付清单阶段 2（FlashChatMessage.seedJson?: string 是接口唯一新增；kind 枚举不动；AI 域零改动）。
- `docs/contracts/repository.md` — 尾部追加「闪电对话持久化接口（v0.44，切片 38 阶段 1 落地）」注记节（表列语义/端口语义/快照可选块语义/边界冻结四段；data-model.md 零改动——其止于 v0.19，v12+ 惯例在 repository.md 注记节）。
- `app.json` / `android/app/build.gradle` — 版本 bump。

测试（新增 5 套件 + 扩 2 + 例行刷新 13 文件）：`src/db/__tests__/migrationsV20.test.ts`（SCHEMA_VERSION/maxVersion/链 [2..20]/v20 create_table 列字典逐字段/全新安装一致性/legacy 无本表/行为级 LokiJS 建库建行）；`src/data/__tests__/ChatMessageRepository.test.ts`（10 用例：insert/覆盖保 created_at/幂等/210→200 裁剪 seq 11 起/ghost 行删除/空输入 no-op/duplicate seq/守卫 4 抛错/listOrdered 升序+尾窗口/limit 抛错）；`src/ui/__tests__/chatPersistence.test.ts`（12 用例：过滤 confirm/debug/cardPayload 序列化/seed 直传/恢复平铺/降级 text/seed 不受 payload 影响/守卫逐字段）；`src/domain/__tests__/dataSnapshot.test.ts` 扩聊天谓词与投影；`src/data/__tests__/dataSnapshotChatBlock.test.ts`（8 用例：组包升序/空表空数组/210→200 裁剪/serialize 往返 isDataSnapshotWire/恢复未命中创建 id=chat-<seq> created_at 保真/命中覆盖保本地 created_at/幂等 applied 0/本地独有保留/first-wins skipped+形状不符 skipped/缺键整段跳过）；`src/ui/__tests__/useFlashChat.test.ts` 5 新用例（jest.mock('../../data') 工厂补 CHAT_MESSAGE_PERSIST_LIMIT+chatMessageRepository mock）；10 个历史 migration 套件例行刷新（toBe(19)→toBe(20)+链数组+测试名）+ dataSnapshotSparkBlocks/dataSnapshotRepository/WatermelonSparkRepository 三套件 MODEL_CLASSES 注册 ChatMessageModel（缺它 createDataSnapshot 十路查询炸 db.get null）。

## 四、真机验收矩阵（MuMu 猴王 emulator-5554；2026-11-25 执行，10/10 全过）

0. **（前置）v19→v20 升级 migration**：`adb install -r` 0.38.0 → 启动无崩溃、计划存量数据完整；后续 persist/listOrdered 全链成功即 v20 表运行时可写。
1. **文本轮重启恢复 ✓**：send 'buymilktomorrowatten'（远端轮，mock 新建 wire）→ user+assistant（已解析，请核对卡片）落库 → force-stop → relaunch → 闪电 tab 原序恢复；调试入口消息（切片 32，会话内可见）**重启后不出现**；草稿面板（瞬态）不恢复。
2. **结果卡重启恢复 ✓**：确认添加 → 结果卡（工作/模拟事项/📅11月26日周四 09:00/+15分钟+1小时 chips）→ 重启 → 卡片完整恢复渲染；**点击卡主体跳 item/[id] 详情页 ✓**（另造存活卡验证；「已更新《title》」为消息对象措辞，卡片视觉层只渲染结构化字段——useFlashChat.ts:1200-1203 分支）。
3. **已删除卡联动 ✓**：详情页删除条目（删除本地副本弹窗→删除）→ 重启 → 恢复卡显示「已删除」角标+整卡置灰（深浅两态截图实证）+ 点击不跳转（禁用）；chips 隐藏。切片 30 useFocusEffect 批量查询对恢复卡零改动生效；跨重装恢复卡同样自动生效（见 8）。
4. **末卡播种跨重启 ✓**：重启后直接 send 'editlastone' → mock 日志 `hasSeed=true seedItemId=i6kaTj0L7MfSHQZZ`（恢复 seed 进远端轮）→ 编辑 wire（targetItemId 回填）→ 草稿内容（已按对话修改）→ 确认添加 → 详情页证实内容已更新（update 链写穿）→ 计划页「明天」分组 1 条（**不新建**）；备份 JSON items 中 模拟事项 count=1（库级权威证据）。
5. **confirm/debug 不落库 ✓**：认真模式开 + 有展示中草稿时 send 内容修改轮 → 「修改需要确认」confirm 消息（内容 diff+应用修改/放弃修改）出现、旧预览卡保持 → 重启 → confirm 0 条恢复；调试入口消息 0 条恢复；text 轮 user/assistant 全保留。
6. **200 条裁剪 ✓（三处对齐真机验证）**：craft 快照 210 chat 行 PUT 服务器 → 应用恢复（已应用 290 项）→ 重启恢复尾 200 条（**聊天顶部首条=bulk-row-11**，seq 1-10 已裁）→ 立即备份数据 → 新快照 chatMessages **count=200、first seq=11、last=210、单调**（快照组包 slice(-200) ✓；persist 侧 replaceTail 裁剪在 DB 态即证）。
7. **数据备份含聊天块 ✓**：立即备份数据 → 服务器 GET 新 life-data-*.json → `chatMessages` 块 14 行（seq 1..19 缺口=过滤行）+3 卡（cardPayloadJson+seedJson 齐备）+ last card payload itemId=当前基线卡 + items 20 条模拟事项 1 张 + kind:'data' version:1 不变。
8. **卸载重装恢复含聊天 ✓**：uninstall → install 0.38.0 → 通知权限 → 重配 WebDAV 连接（SecureStore 随卸载清空）→ 保存连接 → 恢复含聊天块快照（已应用 94 项）→ 重启 → 闪电页聊天完整恢复含结果卡；**已删除联动对恢复卡自动生效**（对应条目不在快照 items → 恢复卡直接标已删除）。
9. **旧格式快照回归 ✓**：恢复切片 31 期六块快照 life-data-20261122-200821.json（无 chatMessages 无 sparks 块）→ 恢复完成（已应用 61 项）无异常 → 重启 → 六块 items 正常替换、**聊天块零改动**（14 行原样，缺块整段跳过）。
10. **深浅色 ✓**：`cmd uimode night yes/no` 截图（.tmp-s38/m10-dark.png / m10-light.png）：恢复消息与结果卡两态渲染正常；已删除卡置灰+角标两态清晰；历史卡降透明度正常；StatusBar 跟随主题。

## 五、踩坑教训

1. **认真模式拦截轮的真机复现前置条件**：§7.37 守卫谓词要求 `turnStartDraft !== null`（「有草稿改草稿」才拦）——保存后草稿清空，直接发编辑轮**不拦**（无草稿改最近一张流程）；需先发一轮编辑出预览草稿，再发内容修改轮才触发拦截。且 mock 第一版 content 追加恒定串，相邻两轮解析结果 diff 无变化（contentChanged=false）也不拦——mock 改为轮次计数产生递增内容差异。
2. **Windows bash 多行 python -c 会炸**（`|| goto :error` 包装器吃换行报 IndentationError）——多行脚本用 `python - <<'EOF'` heredoc 或落盘 .py 文件（.tmp-s38/parse_*.py 系列）执行；单行 -c 可用。PYTHONIOENCODING=utf-8 防 GBK 编码炸（• 等字符）。
3. **MuMu uiautomator dump 坐标漂移与坏 bounds**：滚动后立即 dump 会拿到陈旧坐标（tap 打到错行）；dump 出现 y1>y2 坏 bounds 时以 screencap 截图核对真实视口为准，滚动后 sleep ≥1.2s 再 dump。
4. **备份页 WebDAV 表单 http 明文警告行动态插入**：BaseURL 填入后下方字段整体下移 52px——逐字段填写必须每字段填完重新 dump 定位（切片 36「五步序列」教训的动态布局变体）。
5. **搜狗 IME 中文不可输**（adb input text）：矩阵交互词全部改 ASCII（buymilktomorrowatten/editlastone/editthetitle 等）+ mock 正则扩展 `|edit`；输入串严禁空格（切片 34 教训延续）。
6. **db.batch 不收 Promise**：prepare* 系列全返回 Model（同步），operations 类型 `Model[]`；误用 Array<Promise<unknown>> 直接报错。
7. **历史测试例行维护**：10 个 migration 套件版本断言（toBe(19)+链数组）每片升版必须同步滚新；三 spark 时代 data 套件 MODEL_CLASSES 数组需注册新 Model（否则 createDataSnapshot 多路查询炸 db.get null）——两种缩进形态（2 空格顶层/6 空格嵌套）sed 替换策略不同。
8. **type predicate 手写**：Number.isInteger 非 type predicate，unknown 收窄需自写 isInteger/isFiniteNumber 谓词（TS18046）。
9. **onceAt 守卫刻意只校验整数性**：月历有效性（02-30 类）由落库层判定——测试写 month:13 拒绝断言是错的，非整数（year:'x'/minute:0.5）才拒绝（实现注释已声明口径）。

## 六、遗留披露

1. **logcat migration 日志未采集**：v19→v20 升级验收为行为级（存量数据完整+新表读写成功），未按切片 37 惯例抓「Migrating from version 19 to 20」日志——下次升级安装切片恢复 logcat 实证惯例。
2. **升级安装用户聊天从零积累**：v19 期对话为内存态本已丢失（升级用户 flash_chat_messages 为空表属预期），非本片缺陷。
3. **persist fire-and-forget 窗口**：replaceTail 不 await（不阻塞输入），进程被杀瞬间的最后 1–2 条消息可能未落库——重启恢复到最后落库态，接受。
4. **测试设备残留**：矩阵⑥ craft-210 实验与 mock 对话在 emulator-5554 DB 留下测试数据（最终设备态=M9 恢复的旧快照 items+14 行聊天）；`.tmp-s38/`（mock 服务器/craft 快照/解析脚本/截图）与 `life-0.38.0-v38.apk` 不提交（惯例延续）。
5. **不做清单重申**：sync 快照不含聊天块（多设备对话同步留候选）；对话编辑/删除 UI/分页/搜索/多会话/加密不做；AI 域零改动；无新依赖；app_settings 零迁移零设置面（隐私=与 items 全量明文上云同级别知情）。
6. backlog 候选不受影响：F5 时间解析消歧/F3 闹钟可见性/theme_mode/系统日历写回/变更 B 等维持原序（见 `tasks/backlog.md`）。

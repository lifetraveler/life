# 切片 17 · 阶段 1 反馈总结（数据与模型层扩展）

- 日期：2026-11-12
- 阶段：Phase 1 / 3（数据与模型层扩展，纯逻辑不碰 UI）
- 分支：`task/slice-17`（基点 main @ aeedbea）
- 阶段提交：`8b88a3a feat(s17): 阶段1数据与模型层扩展——schema v9 渠道预设表 + Webhook 载荷模板(mode json/form/text)与守卫 + generateIcsPreview 导入预览接口 + 5 个新单测文件(51 用例)与契约 v0.17 节`（21 文件，+1817/-35；另有 d270a52 立项提交在先）
- 状态：✅ 完成（纯逻辑阶段，真机升级验收留切片收尾统一做），已暂停等待阶段 2

## 一、成果定性：达标，可进入阶段 2

| 维度 | 结果 |
| --- | --- |
| 类型安全 | `npx tsc --noEmit` 0 error |
| 测试 | `npx jest --runInBand` 64 套件 / 796 用例全过（基线 59/745），新增 5 个测试文件共 51 用例 |
| expo-doctor | 与基线一致（2 失败预存：non-CNG app config sync 提示 + WatermelonDB/simdjson 元数据） |
| 提交 | `8b88a3a`，21 文件 +1817/-35，v2–v8 历史 migration step 未动一行 |

实施计划三决策点（m00072，用户已确认）全部落地：

1. **channel_presets 追加 created_at 列**——WatermelonDB create 自动写入（`@readonly @date('created_at')`），输入不提供。
2. **未知占位符保留原文**——配置写错时在消息内容里可见，便于排障，不静默清空。
3. **旧纯 URL channel_config 兼容读、不做数据迁移**——等价 `{url, mode:'json'}`，切片 16 存量提醒零行为变化（旧 6 用例回归锚点原样通过）。

## 二、关键设计落点（阶段 2/3 的消费面）

1. **渠道预设数据面**（AGENTS §7.27）：`src/domain/channelPreset.ts` 类型（`ChannelPresetType='webhook'|'apprise'`、`isChannelPresetType`、`ChannelPreset{id,name,type,configJson,createdAt}`、Create/Update 输入 patch 合并、**type 创建后不可变**）+ Repository 5 方法：`listChannelPresets()`（created_at 降序）、`createChannelPreset`、`updateChannelPreset`（空 patch 抛错；configJson 按既有 type 重过守卫）、`deleteChannelPreset`（删除不影响既有提醒——复制值语义，无外键）、`generateIcsPreview`。
2. **Webhook 配置面**：`src/notifications/channels/webhookConfig.ts` 判别联合 `WebhookChannelConfig`（json/form/text；form 必填扁平 `payloadTemplate`、text 必填 string、json 的 `payloadTemplate` 可缺省=切片 16 固定 payload）+ `parseWebhookChannelConfig` 手写守卫（错误前缀 `WebhookChannel: `）。
3. **模板面**：`src/notifications/channels/webhookTemplate.ts` 纯函数——`renderWebhookTemplateValue`（8 变量 `{title}{body}{content}{occurrenceKey}{reminderId}{itemId}{fireAt}{sentAt}`，fireAt/sentAt 为毫秒字符串）、`renderWebhookJsonTemplate`（递归，仅 string 叶子替换，number/boolean/null 透传）、`renderWebhookFormTemplate`（值渲染→URLSearchParams，键不渲染）。
4. **预览面**（AGENTS §7.28 数据层）：`generateIcsPreview(icsText, deviceTzid)` → `{entries:{input,floating,isDuplicate,existingItemId}[], failures, sameFileDuplicates, duplicateCount}`，纯读不落库；去重键与 `importItemsInBatches` skippedDuplicate 完全同键（「预览标记 = 实际落库行为」承诺）。
5. **守卫写路径承诺**：`assertValidChannelPresetConfig` 保证「存进预设的配置必然能被渠道投递解析」——阶段 2 UI 落库前无需重复校验，守卫错误消息已带前缀可直接透出。

## 三、做得好的三点

1. **兼容回归锚点策略**：旧 WebhookChannel.test 6 用例（legacy URL + 固定 payload 逐字段）原样保留并新增载荷适配 describe（headers 合并顺序=mode 默认头在前 config 覆盖、mode 非法→failed 不 fetch、legacy/modern 混用零回归）。
2. **升级/全新安装同源断言**：migrationsV9.test 同时断言 migration 链（v9 仅 1 个 create_table step、v2–v8 无 channel_presets）与 schema.ts 列声明（`columnArray` 逐字段 toEqual），加 seedPreset/migrationsV8 结构测试同步升 v9——三处任一漂移即红。
3. **类型纪律零妥协**：测试构造契约外值沿用 `JSON.parse('"bogus"')` 赋给类型化变量，无一处 `as`；mode 枚举用 `isWebhookPayloadMode` 手写守卫收窄而非 `as`；data 层导入 notifications/channels 的纯 TS 守卫无循环（守卫文件零依赖 data）。

## 四、过程中暴露的问题（均已修复，留作教训）

1. **WatermelonDB created_at 自动写入条件**：需 model 有 `createdAt` 属性（`node_modules/@nozbe/watermelondb/Model/helpers.js:11-15` createTimestampsFor 判定 `'createdAt' in model`）——`@field` number 不触发，必须 `@readonly @date`（与 tags 表先例一致）。
2. **`createTable()` 产出的 `schema.columns` 是 TableMap**（按列名索引），数组投影用 `columnArray`——结构断言别直接 toEqual 数组。
3. **URLSearchParams.toString() 空格编码为 `+`** 而非 `%20`；模板 `{{{title}}}` 渲染为 `{会议提醒}`（regex 吃掉内层合法占位符，外层杂散 `{` 与尾 `}` 保留）——写编码/模板断言前先想清语义。
4. **JSON 合法但非对象的 config 按原文整串判 URL → 抛错**（如 `"https://x"` 带引号——引号破坏 URL 形态）；兼容路径只收非 JSON 纯文本 URL。守卫实现用 `raw.trim()` 原文而非 JSON.parse 结果，测试预期曾写反。
5. **版本钉死断言连带更新**：升 v9 后 migrationsV8.test/seedPreset.test 的版本断言例行更新（8→9，链数组补 9）。
6. **FakeRepository 补 5 个新接口 stub**（ReminderScheduler.test.ts，§7.13 编译必需，返回值型空实现）。

## 五、契约合规与遗留风险（按优先级）

1. 任务卡阶段 1 验收 1、2 **全部闭环**：tsc/jest 全过；Zulip form payload（`type=stream&to=…&content=…`）渲染有专测。
2. **契约文档已随阶段提交**：repository.md「渠道预设与 ICS 导入预览接口（v0.17）」节（5 方法签名 + 同键承诺 + 删除不影响提醒）、notifications.md「Webhook 载荷模板（v0.17）」节（双形态 + 变量集 + 渲染规则）。
3. **真机升级路径（user_version=8→9）未验**——留切片收尾（LokiJS 忽略 sql 步骤的老规矩，行为级只能真机；拉库三件套 + WAL 重放方法沿用 slice-16 反馈 §六）。
4. channel_presets **无 seed 无回填**（空表起步，UI 空态需引导创建）；type 不可变=改类型走删除重建。
5. 导出 JSON 零变化（`toReminderSummary` 白名单未动）；§7.17 四文件（ReminderScheduler/reconcileDiff/computeMissed/polyfill）未触碰。
6. 分支未 push（§7.9 收尾统一做；需代理：`git -c http.proxy=http://172.16.100.254:7893 -c http.version=HTTP/1.1 push`）。

## 六、给阶段 2 的一句话建议

设置页/详情页直接消费 Repository 5 方法与守卫/模板纯函数，无需再造校验；改造 `src/ui/reminderForm.ts` 的 `buildChannelFields`（现状：webhook→`URL.trim()`、apprise→`JSON.stringify({baseUrl,key})`，webhook 落库改为预设 configJson 复制或模板模式组装后过 `parseWebhookChannelConfig`）；once Picker 若引入 `@react-native-community/datetimepicker` 需 rebuild dev client（MuMu emulator-5554，dev build com.vibecoding.life，`./gradlew.bat installDebug` + Metro 8081 + adb reverse）。

## 附：阶段 1 修改文件清单

- **核心实现**：`src/db/schema.ts`（v9 channel_presets）、`src/db/migrations.ts`（v9 步骤末尾追加，历史 step 未动）、`src/db/models/ChannelPresetModel.ts`（新）、`src/db/database.ts`（注册 model）、`src/domain/channelPreset.ts`（新）、`src/notifications/channels/webhookConfig.ts`（新）、`src/notifications/channels/webhookTemplate.ts`（新）、`src/notifications/channels/WebhookChannel.ts`（send 模式化重写）、`src/data/ItemRepository.ts`（接口 5 方法 + IcsPreview 类型）、`src/data/WatermelonItemRepository.ts`（5 方法实现 + toDomainChannelPreset + assertValidChannelPresetConfig）
- **测试**：新增 `src/notifications/__tests__/webhookConfig.test.ts`、`src/notifications/__tests__/webhookTemplate.test.ts`、`src/db/__tests__/migrationsV9.test.ts`、`src/data/__tests__/channelPresetRepository.test.ts`、`src/data/__tests__/icsPreview.test.ts`；扩展 `src/notifications/__tests__/WebhookChannel.test.ts`（载荷适配 6 用例）；夹具/结构测试同步 `src/notifications/__tests__/ReminderScheduler.test.ts`（FakeRepository 5 stub）、`src/db/__tests__/migrationsV8.test.ts`、`src/db/__tests__/seedPreset.test.ts`（版本断言 8→9）
- **文档**：docs/contracts/repository.md（渠道预设与 ICS 导入预览接口节）、docs/contracts/notifications.md（Webhook 载荷模板节）、本文件

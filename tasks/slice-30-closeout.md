# 切片 30 收尾移交（closeout）

> 切片 30：闪电录入草稿放弃、已删除卡联动与 AI 重试。分支 `task/slice-30`（基点 main @ `16d33a3`）。
> 五阶段一口气连续完成（§7.33 惯例 1：不写 phaseM-feedback，阶段粒度由本 closeout 承载）。
> 用户提案三效果 + 四项定案：放弃=原地置灰+「已放弃」角标 / 删除显示默认 mark、remove 做成配置 / 重试默认 3、档位 0/1/3/5 / 编号 30 插队优先于 28。

## §0 交付清单

| 阶段 | 提交 | 内容 | 规模 |
| --- | --- | --- | --- |
| 阶段 1 | `15449cb` | schema v15（`ai_retry_max` number isOptional + `flash_deleted_card_display` string isOptional）+ settings/repository 读写 + profile 设置 UI（重试档位与已删除卡显示两组 radio）+ 任务卡 + AGENTS.md v0.33（§7.41/§8）+ backlog 登记 + 版本涟漪夹具 | 20 文件 +592/-49 |
| 阶段 2 | `9aa4f8d` | AI 重试：openAiCompatible 重试循环（isRetryableParseError/固定 1000ms/耗尽披露）+ chat.ts 直通与降级注记 + useFlashChat retryNotice + flash.tsx 重试提示行 | 6 文件 +410/-16 |
| 阶段 3 | `833fa4f` | 草稿放弃：useFlashChat `dismissedDraft`/`dismissDraft`（纯本地，不落库不播种）+ FlashPreviewCard dismissed 态 + flash.tsx「放弃」按钮与弃置卡分支 | 4 文件 +191/-2 |
| 阶段 4 | `e8a9cc8` | 已删除卡联动：Repository 端口+实现 `filterExistingItemIds` + useFlashChat `reconcileDeletedCards`（mark/remove）+ flash.tsx useFocusEffect 接线 + FlashResultCard deleted 态 | 8 文件 +317/-7 |

反馈文件核对：五阶段一口气完成 → 按 §7.33 惯例 1 不写 phaseM-feedback，本 closeout §四 承载验收结论。

## §一 环境事实

- 模拟器：MuMu（`127.0.0.1:7555`）；adb 全路径 `/c/software/platform-tools/adb.exe`；Metro `npx expo start --dev-client --port 8081` 后台常驻 + `adb reverse tcp:8081 tcp:8081`；App force-stop 重启加载新 bundle（v15 迁移执行无错，计划页数据完好）。
- App 配置态：DeepSeek 槽「使用中」，Key 已配（全程掩码未触碰）；认真模式 ON；AI 用量展示 ON。
- 失败注入方式（未碰飞行模式、未碰 Key）：矩阵 7 用 BaseURL `http://127.0.0.1:1/v1`（guest loopback:1 快速拒连=网络错误重试路径）；矩阵 9 用宿主机临时 401 服务器 `0.0.0.0:18081`（guest 经 `10.0.2.2` 访问）——验收后已关。
- 设备收尾态：深色模式；配置已还原（重试=3 次（默认）、删除显示=标记已删除、BaseURL=`https://api.deepseek.com`）；DB 测试产物留存（回归测试会 11-18 16:00、团建聚餐已删、开会 11-18 全天等）。

## §二 数据库 / 构建事实

- **schema v14→v15**：单条 addColumns 两列（`ai_retry_max` number isOptional、`flash_deleted_card_display` string isOptional），零 `unsafeExecuteSql`/UPDATE、零 seed 改动（v12+ 列均靠读层归一）。**设计要点：非可选 number 迁移会回填 0，与「0=关闭重试」语义冲突，故用 isOptional null + 读层回退默认 3**。
- `npx tsc --noEmit`：0 错（每阶段提交前均过）。
- `npx jest --runInBand`：**90 套件 / 1241 用例全过**（收尾全量复跑；基线 87/1209 → 只增不减）。
- `npx expo-doctor`：2 项预存失败（app config 非 CNG、RN Directory 元数据）无新增。
- 零新依赖；AiParser.parse 冻结签名不动、ChatMessage kind 不新增、ai.md 契约正文零改动（重试在 remote provider 传输层 fetch 包装，对上层透明）。

## §三 代码地图

| 文件 | 改动 | 对应验收 |
| --- | --- | --- |
| `src/db/schema.ts` | SCHEMA_VERSION 15 + app_settings 两列（isOptional） | 迁移执行 |
| `src/db/migrations.ts` | toVersion 15 单条 addColumns 两列 | 迁移执行 |
| `src/db/models/AppSettingsModel.ts` | `@field('ai_retry_max') aiRetryMax!: number \| null` + `@text('flash_deleted_card_display')` | — |
| `src/domain/settings.ts` | `FLASH_DELETED_CARD_DISPLAYS`/`isFlashDeletedCardDisplay`/`parseAiRetryMax`（越界回默认 3）/`validateAiRetryMax`（0–5 整数抛错）/常量 `AI_RETRY_MIN=0`/`AI_RETRY_MAX_LIMIT=5`/`DEFAULT_AI_RETRY_MAX=3` + AppSettings/DEFAULT 扩字段 | — |
| `src/data/WatermelonItemRepository.ts` | toDomainSettings 归一映射 + getSettings 补插默认行自描述 + updateSettings 校验/兜底/draft（`validateAiRetryMax`/枚举守卫） | 矩阵 6 |
| `src/data/ItemRepository.ts` | 端口新增 `filterExistingItemIds(ids): Promise<Set<string>>`（契约外显式只读扩展，先例 getCalendars color） | 矩阵 4 |
| `src/data/WatermelonItemRepository.ts` | 实现：unique 去重→空短路→`Q.oneOf` 批量单查（无 N+1） | 矩阵 4/5 |
| `src/app/(tabs)/profile.tsx` | AI 区块两组 radio（`AI_RETRY_TIER_OPTIONS` 0/1/3/5、`FLASH_DELETED_DISPLAY_OPTIONS` mark/remove 含 hint）+ handler 乐观更新共用 `settingsSavingKey` 互斥 | 矩阵 5/6/8 |
| `src/domain/ai/openAiCompatible.ts` | `retryMax`/`onRetry` 配置 + `isRetryableParseError`（network/timeout/invalid-json 恒真、http-status ≥500‖429、schema-mismatch/empty-input 假）+ 重试循环（固定 1000ms、耗尽抛 `（已重试 N 次）`、lastUsage 重试期间 null=usage 只报成功轮）+ `requestParse` 单次尝试（每尝试独立 AbortController+timeout）+ 测试注入 `DelayLike` | 矩阵 7/8/9 |
| `src/domain/ai/chat.ts` | FlashTurnDeps `aiRetryMax`/`onRetry` + 降级注记拼 `（已重试 N 次）` 尾巴 | 矩阵 7/8 |
| `src/ui/useFlashChat.ts` | readTurnSettings 读 aiRetryMax（每轮恰一次）+ retryNotice 瞬态 state + `dismissedDraft`/`dismissDraft` + `deletedItemIds`/`reconcileDeletedCards`（getSettings+filter 并行→mark 并集/remove 滤消息/catch warn 保持原样） | 矩阵 1–5/7 |
| `src/app/(tabs)/flash.tsx` | retryNoticeRow（输入栏上方瞬态行）+ 草稿卡三按钮（放弃/修改字段/确认添加）+ 弃置卡分支 + `useFocusEffect(reconcileDeletedCards)` + card 分支 deleted 传参与 onPress 双保险 | 矩阵 1/4/5/7 |
| `src/ui/FlashPreviewCard.tsx` | `dismissed?: boolean`：opacity 0.55+disabled+「已放弃」角标+提示切换「草稿已放弃，重新输入可新建条目」 | 矩阵 1/3 |
| `src/ui/FlashResultCard.tsx` | `deleted?: boolean`：与 historical 共用降透明样式、disabled、「已删除」角标优先、chips 整行隐藏 | 矩阵 4/5 |
| 新测试 6 处 | `settingsAiRetry.test.ts`（parse/validate/守卫/DEFAULT）；`openAiCompatible.test.ts` 重试 9 例（耗尽消息/429·500/401·400 不重试/schema-mismatch 不重试/JSON 解析失败重试/retryMax=0/缺省 3/超时可重试）；`chat.test.ts` 重试披露 2 例；`FlashPreviewCard.test.tsx` 2 例；`FlashResultCard.test.tsx` deleted 3 例；`filterExistingItemIds.test.ts` 2 例 | — |
| 涟漪夹具 | migrationsV{8,9,11,12,13,14}.test 版本 pin 15、seedPreset/viewQueries/categorySettings 全等断言补字段、ReminderScheduler FakeRepository stub | — |
| `tasks/slice-30.md` / `AGENTS.md` v0.33 / `tasks/backlog.md` | 任务卡 / §7.41+§8 / 登记 30+28 顺延 | — |

## §四 真机验收矩阵（卡 §3，10 项全通过）

| # | 场景 | 结果 | 证据/备注 |
| --- | --- | --- | --- |
| 1 | 草稿放弃：置灰+角标+按钮消失、无 usage | ✅ | 「评审会 11-18 15:00」点放弃 → 原地置灰+「已放弃」角标+按钮行消失+提示切换，无新 usage 行（纯本地无 AI 轮次） |
| 2 | 放弃后新意图正常 | ✅ | 发「明天开会」全新意图出卡，弃置卡被新输入清除 |
| 3 | confirm 待确认时放弃同清 | ✅ | 认真模式确认卡出现后点草稿「放弃」→ confirm chips resolved+草稿转弃置态 |
| 4 | 删除条目→mark 态 | ✅ | 团建聚餐存卡→详情页删除→回闪电页：置灰+「已删除」角标+chips 消失；点击不导航（截图 sha256 字节级一致+topResumedActivity 不变） |
| 5 | remove 态消失 | ✅ | 切「从对话移除」→ card 消息整体消失、文本消息保留 |
| 6 | force-stop 配置保持 | ✅ | 重启后 radio 保持 remove；重试 radio 默认 3 选中（v15 迁移+默认值上机验证） |
| 7 | 不可达 BaseURL 重试提示→耗尽披露 | ✅ | BaseURL `127.0.0.1:1`：「🔄 AI 服务异常，正在重试（1/3）…」瞬态行不留历史 → 耗尽「AI 服务暂不可用（网络错误），已用本地解析（已重试 3 次）」+ 本地兜底草稿 |
| 8 | aiRetryMax=0 立即降级 | ✅ | 档位「0 次（关闭）」→ 2.5s 内降级、无计数尾巴、无重试行；原话写 content 被认真模式拦截兜住（既有边界） |
| 9 | 401 不重试无计数 | ✅ | 宿主机 401 服务器（10.0.2.2:18081）：「HTTP 401」单次即降级、无计数、无重试行——与矩阵 7 同屏对比成立 |
| 10 | 切片 29 回归 | ✅ | 「明天下午4点回归测试会」存卡→「还是30分钟后吧」：usage 2907/缓存 2688（播种进请求）、标题保留编辑不新建、时间 21:22=说话 20:53+30（D3）；唯一 card 当前卡正常渲染（无角标、chips 在） |

## §五 踩坑教训

1. **低分辨率截图预览会误读视觉细节**：900x1600 全图预览把卡片右上角圆角/背景反光误读成角标 pill——判视觉细节必须 PIL 高倍裁剪放大定案（本次两次裁剪证明无角标，修正误判）。
2. **失败注入选型**：MuMu 上避免飞行模式（切片 29 教训）；网络错误用 guest loopback 死端口（快速拒连），HTTP 状态码用宿主机临时 node 服务器（`10.0.2.2` 可达）——全程不碰 Key、可精确控制失败种类。
3. **schema 可空性语义坑**：WatermelonDB 非可选 number 列迁移会把旧行回填 0——当 0 有业务语义（关闭重试）时必须 isOptional + 读层回退默认，否则「关闭」与「未设置」混淆。
4. **RN Pressable disabled 转发**：onPress 会被转发到内层节点且不带 disabled（findAll 命中外层+内层两处）——断言锁定「同时携带 onPress 与 disabled 的外层节点」（`'disabled' in node.props`），不做全节点枚举。
5. **AI 配置页是推入页无底部 tab**：返回用 keyevent 4；我的页滚动位与 radio 坐标随滚动漂移，tap 前先截图定位。
6. **重试测试注入 DelayLike 零延迟**，避免真等 1000ms×N；与重试无关的既有降级语义测试显式 `aiRetryMax: 0`（默认 3 会真等 3s 且注记带计数尾巴污染断言）。

## §六 遗留披露

1. **固定 1000ms 无退避**（任务卡明文不做指数退避）：连续 429 限流场景固定间隔可能连续失败至耗尽——接受边界，如需退避另立候选。
2. **重试过程不进聊天历史**（按设计「不留历史」）：retryNotice 是输入栏上方瞬态行；重试尝试消耗的 tokens 无 usage 行（usage 只报成功轮，冻结于 §7.41）——失败轮观测只能走服务端。
3. **mark 态 deletedItemIds 只增不减**（会话内存态）：条目不可复活、语义自洽；remove 移除 card 消息同为内存态，重启后聊天清空无持久化需求（按设计不做聊天持久化）。
4. **reconcileDeletedCards 每次 focus 跑一次批量单查**（`Q.oneOf`，无 N+1、不轮询）——card 数量大时仍为单查询，性能边界记录。
5. 回归复核中修正一处视觉误判（矩阵 10 首判「历史角标」经高倍裁剪证伪）——矩阵 10 以裁剪证据+usage tokens 双重证据定案。
6. backlog U1–U4、L1–L13 状态不变；候选 28 解除顺延回到建议序、29b 编号顺延不变。

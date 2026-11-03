# 切片 7 收尾移交（tasks/slice-07-closeout.md）

切片：今日/本周视图（tasks/slice-07.md）。分支 task/slice-07，自 main@5020a12。

## 环境事实

- Windows 原生 bash（非 MSYS）；本会话 git status 首次调用再现 0xC0000142（exit 3221225794），提权重试成功——环境偶发，遇报即停不重试。
- git 推送沿用切片 6 结论：`https.proxy` 键失效，需 `-c http.proxy=...`；遇 reset 加 `-c http.version=HTTP/1.1`。
- npm 4 条 Unknown user config 警告（home / ELECTRON_MIRROR / electron_builder_binaries_mirror / msvs_version），无害。
- 未新增依赖；package.json / package-lock.json 无 diff。

## 数据库 / 构建事实

- 未新增 schema、migration、索引；SCHEMA_VERSION 仍 4，src/db/ 无 diff。覆盖安装不会触发 migration。
- `npx tsc --noEmit`：0 错误。
- `npx jest --runInBand`：16 套件 199 用例全过，进程自然退出（EXIT=0）。含本切片新增回归用例「observeScheduledItemsInRange：集合内 status 翻转（active→done）触发重发射」（见踩坑教训 7）。
- `npx expo-doctor`：2 条失败与切片 5/6 完全相同（@nozbe/watermelondb New Architecture 未测试、@nozbe/simdjson 无元数据），非本切片新增阻塞。
- 真机验收（任务卡 5–11 条）：见文末「真机验收记录」。

## 代码地图

- src/domain/views/ranges.ts：`ViewTimeRange{startMs,endMs}`；`getTodayRange(nowMs,tzid)` / `getWeekRange(nowMs,tzid)`（周一起点，用 ZonedParts.weekday）；私有 resolveDayStart 处理午夜 gap（如 America/Havana）回退当天最早存在整点；subtractOneDay/addDays/subtractDays 纯日历辅助。仅 import recurrence/civilTime 只读导出。
- src/domain/views/overlaps.ts：`overlapsRange(item,rangeStartMs,rangeEndMs)`——repository.md「视图查询接口（v0.7）」已安排条件的唯一实现（UI 与 Repository 共用一份）。
- src/domain/views/grouping.ts：`ViewKind`/`ViewGroupId`/`GroupItemsForViewInput`/`GroupedViewItems`；classifyItem 单项单组、优先级 过期>已安排>今日创建；组内排序（overdue endAt↑/scheduled done 末尾+startAt↑+createdAt↑/createdToday createdAt↓）；输入按 id 首见去重。周视图靠 viewKind 强制 createdToday 为空。
- src/domain/views/__tests__/：ranges（两时区+DST+跨月/跨年+Havana gap+TZ 翻转隔离）、overlaps（10 边界）、grouping（19 用例），共 49。
- src/data/ItemRepository.ts：+6 方法声明——3 个 list 为 repository.md 冻结签名；3 个 observe* 为契约外显式扩展（沿 observeItemsWithTags 先例，onNext 末参、返回退订函数）。
- src/data/WatermelonItemRepository.ts：+3 私有查询构建器（list/observe 共用同一份 WatermelonDB 条件，非内存过滤）；+itemTagsJoinQuery()/allTagsQuery() 辅助（observeItemsWithTags 重构复用，行为不变）。三个 observe 的 item 查询源使用 `.observeWithColumns([...])` 而非 `.observe()`（scheduled=['status','start_at','end_at','all_day']、overdue=['status','end_at']、created=['status']）——原因见踩坑教训 7。
- src/data/__tests__/viewQueries.test.ts：LokiJS 内存适配器 16 用例（边界含不含/跨天/archived 排除/排序/observe 初次发射与退订/集合内 status 翻转重发射）。
- src/app/today.tsx / week.tsx：两页视图。范围与 now 挂载时用 getDeviceTzid()+领域纯函数定一次；三路订阅→groupItemsForView→分组渲染；全空 EmptyState（今日页带「去记录」入口）；快速完成=updateItem→成功后 fire-and-forget reconcile()（失败仅记日志），失败时响应式投影天然保持原状+页内错误提示；按钮 busy 期间置灰串行。
- src/app/_layout.tsx：Stack 注册 today「今日」/week「本周」；src/app/index.tsx：「已有记录」行右侧加「今日」链接（与「已归档」并排）。
- src/ui/ViewGroupSection.tsx：分组区块（空组不渲染=隐藏标题）+行（title/type/时间标签）+完成/取消完成按钮；done 置灰；点击行进 /item/[id]。
- src/notifications/__tests__/ReminderScheduler.test.ts：FakeRepository 补 6 个 stub（throw 未实现）——ItemRepository 接口扩展的机械结果，否则 tsc 不过（见检查清单披露）。

## 检查清单偏差披露（重要）

任务卡 76–77 行要求 `git diff -- src/domain/recurrence src/notifications 为空`。实际：src/notifications/__tests__/ReminderScheduler.test.ts 有 +25 行（FakeRepository stub）。任务卡 27 行的实质禁令是四个实现文件 ReminderScheduler / reconcileDiff / computeMissed / polyfill——这四个文件 diff 为空（已逐一核对）。测试夹具补 stub 是接口扩展的编译必需，不改变任何被测行为；未走变更提案（无契约语义变化）。后续切片若再扩展 Repository 接口，建议任务卡把清单字面改为「实现文件为空」。

## 踩坑教训

1. LokiJSAdapter 默认 autosave:true/autosaveInterval:500（lokiExtensions.js:98-99）——每个实例一个 setInterval，挂住 jest 进程不退出；必须 loki.close()。`adapter._driver` 由 setUp 异步赋值，构造后同步读是 undefined；afterAll 惰性解析，两条路径都兜：`adapter._driver.loki` 与 `adapter._dispatcher._worker._bridge.driver.loki`。
2. Loki 同步 worker（useWebWorker:false）下 observe 初次发射在 subscribe() 调用内同步到达；多流收集器必须用 FIFO waiters 队列，单 pending 槽位会被第二个 next() 覆盖丢失 resolver（假超时）。
3. WatermelonDB Q.or 组合同表 OR 条件可用（searchItems 先例）；SQL NULL 参与数值比较天然为假，`end_at > rs` 无需显式非空条件；eq null 经 encodeQuery 落 $aeq:null 匹配缺失字段——Loki 与 SQLite 语义对齐。
4. ItemModel.createdAt 是 @readonly @date：测试用 createItem 之间 await sleep(5) 制造 createdAt 差保证排序确定性；rs/re 从返回对象的 createdAt.getTime() 推导。
5. `return toDomainItem(updated);` 在 WatermelonItemRepository.ts 出现两次（updateItem / updateItemTime 末尾），edit 的 old_string 必须带上下文锚定。
6. EmptyState 是 default export，不是具名导出（新页面 import 时踩过一次 tsc 2614）。
7. **WatermelonDB `Query.observe()` 不发射「匹配中记录的字段变化」**：observation/processChangeSet.js 只在匹配集合成员变化（destroyed / currentlyMatching 增删）时发射，源码自注 "Changes to individual records are NOT observed"。快速完成把 status 在 active|done 间翻转，scheduled 查询（`Q.oneOf(['active','done'])`）下成员资格不变→今日页零重渲染（设备端 DB 已变而 UI 冻结）。修复=`.observeWithColumns([...])`（成员变化+所列字段变化都发射）；回归用例钉死该语义。overdue/created 查询天然因成员移出而发射，但为统一口径也显式列字段（防御性）。旧 observeItemsWithTags 同缺口，但索引页改动都是成员变化，历史上未暴露。
8. Metro（metro-file-map FallbackWatcher）在 Windows 下与编辑器原子写（`.<file>.<pid>.tmpdir`）存在 watch 竞态，报 `ENOENT: watch ...tmpdir` 并 exit 7；重启 Metro 即恢复。编辑源码后做设备验证前先确认 Metro job 存活。
9. App 进程存活时 `run-as sqlite3` 写库会等锁挂起（WatermelonDB 持连接）；外部修数先 `am force-stop` 再执行。外部 sqlite 写不触发 WatermelonDB 响应式（其信号来自自身写通道），改数后需重启 App 才能在 UI 看到。
10. MuMu 两条伪影（均非本切片缺陷）：screencap 可能返回冻结帧（连续多张字节相同），UI 断言用 uiautomator dump（文本树）更可靠；App 内 Intl/FormatJS polyfill 读不到模拟器系统时区、恒回退 UTC，切时区验收（任务卡第 8 条）只能验「同坐标系一致性」，边界切换需真机（单测 49 例已覆盖 NY DST 边界与 TZ 翻转隔离）。
11. adb shell 内嵌 grep 的 `\|` 交替与引号经两层转义易失真——闹钟计数用最朴素的 `grep -c com.vibecoding.life`（之前一条交替模式误报 0）。

## 契约缺陷上报（§7.12，未静默采信）

1. ui.md v0.7「已安排」条件（「endAt 为 null 时 startAt >= rangeStart」）与 repository.md 冻结条件（`startAt<rs && endAt≠null && endAt>rs`）在零时长 Item（startAt=re 或 startAt=rs 且无 endAt）上判定不一致；零时长 startAt=rs 时 repository.md 条件命中、ui.md 字面不含。实现以 repository.md 为准（overlapsRange 单元测试固化）。
2. ui.md v0.7「已安排和过期分组展示 status='active' 与 'done'」与 repository.md `listOverdueItems` 仅 active 冲突——过期组数据源拿不到 done 项，实现以 repository.md 为准（过期组仅 active；done 过期项会落已安排组，若 startAt 在范围内）。

## 遗留披露

1. 视图 now/范围在页面挂载时定一次：长时间停留时「过期」判定不随时间推进（契约「不轮询」的直接结果）；回前台 _layout 只触发 reconcile 不刷新视图坐标。用户下次进入页面时重算。
2. 快速完成失败提示为页内红字文本（非 Alert），无自动重试。
3. 今日空态「去记录」仅导航回主页（主页有内联快速添加），未在视图页复制输入组件。
4. 沿袭切片 6 披露未变：missed UI 推迟；Europe/London 详情页显示回退系统时区（仅显示层）；debug 页死代码 src/app/debug-reminders.tsx:123-131（用户确认不动）。
5. 无索引下视图查询为全表扫描（schema 未加索引是既定约束），数据量大时今日/本周查询代价线性增长；本切片未做性能测量。
6. 导航入口在主页「已有记录」行右侧（「今日」链接），未加首页顶部显眼入口——任务卡未指定位置，取舍已记录。
7. **【领域发现，非本切片引入】`am force-stop` 会清掉 AlarmManager 真实闹钟，而 expo 通知 store（SharedPreferencesNotificationsStore）仍记录已调度；启动对账按 occurrenceKey 幂等比对，判定「已调度」而不重排 → force-stop 后提醒静默丢失**。设备端实证：force-stop 后 dumpsys alarm=0 而 store 存 29 条 London 09:00；创建新提醒（store 无其 occurrenceKey）才能真实排钟。切片 5/6 语义：reconcile 的幂等基准是 store 而非 AlarmManager。后续切片若做「提醒可靠性」，需处理 force-stop/被杀后的重排（如启动时比对系统真实闹钟或引入重排策略）；本切片契约禁止动 notifications/*，仅披露。
8. allDay 编辑写路径疑似未归一化到设备时区当天 00:00（UI 建「今天allDay」落库 start=创建时刻而非午夜；数据模型契约要求 allDay=true→startAt=当天 00:00）。本次验收用 sqlite 修正为 00:00 后完成验收；写路径归一化属编辑页职责（切片 5 域），留给后续切片核实修复。
9. 快速完成成功后 reconcile 的30条 cancelled/scheduled 仅以 Metro 日志与 dumpsys alarm 佐证，App 内无对账结果入口（Dev 信息仅详情页启动/前台对账计数）。

## 真机验收记录

设备：MuMu 模拟器（Android，单实例双 adb 端点，用 127.0.0.1:16384），覆盖安装切片 6 development build（app-debug.apk，176,345,880 bytes，无 native 改动未重 build），新代码经 Metro（`npx expo start --dev-client --port 8081`）下发。验收由 AI 执行（用户授权），全程 uiautomator dump + dumpsys alarm + run-as sqlite3 佐证。

- 第 5 条 覆盖安装：`adb install -r` 成功；安装后 life.db md5 不变（b37d7c2d…），schema 仍 v4，数据未丢。PASS。
- 第 6 条 今日视图分组排序：三组固定序 过期→已安排→今日创建；已安排按 startAt↑=「今天allDay(全天)」→SeedItemA(全天)→「今天14:00(14:00)」→「今天done(08:00 置灰+取消完成)」（done 排同组末尾；种子预置全Day/时刻混合排序正确）；过期行「已过期 2026-11-02 17:10」；今日创建「创建于 2026-11-03 17:13」；无 startAt 的 SeedItemB 不出现。空组标题隐藏。PASS。
- 第 7 条 本周视图：过期+已安排两组、无今日创建组；页头「今日视图」互跳正常；范围内项出现、过期项进过期组。PASS。
- 第 8 条 时区：设备时区 Asia/Shanghai 下边界与显示正确；setprop America/New_York 后 force-stop 重启视图逐字节不变——MuMu 上 App 内 Intl 恒回退 UTC（伪影，见踩坑教训 10），同坐标系下分组逻辑一致性已验证；NY 边界/DST 由单测 49 例覆盖（ranges.test.ts TZ 翻转隔离+NY DST 2026-03-08/2026-11-01）。reminder tzid 不影响分组：SeedItemA 的 Europe/London 提醒不改变其分组。MuMu 受限通过（真机可完整复验）。
- 第 9 条 快速完成与通知联动：修复 observeWithColumns 后——点「完成」：UI 实时重排（行置灰、取消完成、排 done 区末尾 08:00<14:00）、DB status=done、dumpsys alarm 60→0、Metro 日志 30×`cancelled recurrence:v1|BaIcNogNZMgT3jHU|…|02:30|America/New_York`；点「取消完成」：UI 实时回排、DB=active、alarm 0→60、日志 30×scheduled。busy 期间按钮置灰串行。PASS（修复前 UI 不重渲染的缺陷已修，见踩坑教训 7）。
- 第 10 条 详情往返与空态：行点击进详情（开始 2026-11-03 14:00、提醒(1) 每天 02:30 America/New_York 已启用）→返回，状态保持 active/完成。sqlite 临时搬空今日范围数据后：空态「今天没有安排」+「去记录」，无分组标题；「去记录」回主页。验证后数据已逐字段还原。PASS。
- 第 11 条 Hermes 回归：NY daily 02:30 提醒 30 条 occurrenceKey 首条 origWhen=1793777400000=2026-11-04T07:30:00Z=NY 02:30 EST（DST 换算正确，未漂移）；分组与显示全程正常。提醒编辑页对白名单外 tz（Europe/London）显示「该时区暂不支持编辑（只读）」符合白名单契约。PASS。
- 验收过程动过的数据均已还原（5 条预置 + 删除行 reinsert + 新建的 NY 提醒 BaIcNogNZMgT3jHU 保留在库，可从详情页删除）。

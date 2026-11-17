# 切片 27 收尾移交（closeout）：系统日历 live 直读显示（方案 C，筛选面板日历显示区）

- 日期：2026-11-17（立项 2026-11-17，当日连续完成阶段 1→2→3，§7.33 情形 1：未写阶段反馈文件，阶段粒度由本 closeout 承载）
- 分支：`task/slice-27`（基点 main @ `7e43fee`）
- 状态：**全部完成**（阶段 1 数据层 + 阶段 2 live 管道与 UI + 阶段 3 真机验收/修补 + closeout）
- 提交索引（时间序）：

| Commit | 内容 |
| --- | --- |
| `c79fe3d` | feat(s27): 阶段1 schema v14 display_calendar_ids 全链路 + Reader D5 扩展（23 文件 +825/−53，含契约 ui.md/repository.md 新节 + 任务卡改写 + AGENTS.md v0.31 同批提交） |
| `97eb070` | feat(s27): 阶段2 系统日历 live 直读渲染（liveCalendar 纯函数 + hook + 面板日历显示区 + 四视图并入 + 只读弹层）（9 文件 +1826/−23） |
| `aeeed50` | fix(s27): 阶段3 真机反馈修补——权限请求 8s 超时兜底 + 拒绝态自愈 + 恢复联动 effect（3 文件 +107/−8） |
| （本次） | closeout + backlog 划项 + AGENTS §8 刷新 |

## 〇、交付清单

1. **schema v14**：app_settings 加 `display_calendar_ids_json`（string, isOptional；空/缺省=功能关闭，`[]` 为合法关闭态）；migrations toVersion 14 单条 addColumns，v2–v13 未动。
2. **settings 链路**：`AppSettings.displayCalendarIds: string[]`（默认 []）；parse（读防御不抛错）/validate（写严格抛错）/serialize 三件套；WatermelonItemRepository 读层归一 + 写层三处（getSettings 补插/updateSettings 建行/patch 直通，show_ai_usage 全链路先例）。
3. **D5 端口扩展**：`SystemCalendarInfo` 扩 `color`/`sourceName`（null 容忍）；`toDomainCalendarInfo` 映射（expo-calendar Calendar.color=`#RRGGBB`、source.name=ACCOUNT_NAME；非串/空→null）。不加 accountName（expo-calendar 无该字段，组头键=sourceName）。
4. **live 管道（阶段 2）**：`src/domain/views/liveCalendar.ts` 纯函数——filterEventsInRange（expandReaderWindow 外扩沿用）→ resolveSystemEventSourceUid → D2 去重（sourceUid+startAt 精确命中）→ 合成 `LiveCalendarEntry`（id=`live:<sourceUid>:<startAt>`、sourceReadOnly=true、tags=[]、category=null）。
5. **UI（阶段 2）**：`useSystemCalendarEvents`（300ms 防抖 + AppState 回前台 + useFocusEffect bypass 重读 + per(calendarIds,window) 内存缓存 + web 早退 + 端口注入）；`useSystemCalendarList`（权限只在面板打开或已选日历时申请）；`CalendarDisplaySection`（筛选面板内「日历显示」区：按 sourceName 分组缺失归「其他」+ 色点 + 眼睛开关 + 固定说明文案 + 权限态，web 返回 null）；`LiveCalendarModal` 只读弹层（不跳详情）；plan.tsx 四数据路径 filterItems 之后并入 + AgendaItemCard live 渲染（色条/🔒/副行）；FilterSheet 加 `calendarDisplay` 插槽（保持纯 UI）。
6. **阶段 3 修补**：`requestPermissionsWithTimeout` 8s 兜底（expo-calendar 15.0.8 挂起缺陷，见 §四）+ doFetch 拒绝态自愈 + plan.tsx 恢复联动 effect。
7. **文档**：repository.md「全局设置扩展（displayCalendarIds）与系统日历 live 直读」新节（v0.9 冻结节一字未动）；ui.md「筛选面板日历显示区」新节；AGENTS.md v0.31（§7.39 + §8）；任务卡 D8 改写为筛选面板方案（2026-11-17 用户决策：取消独立设置页）+ 矩阵增补。
8. **测试**（+5 套件 +54 用例，只增不减）：migrationsV14 / settingsDisplayCalendar / systemCalendarAdapterMapping / liveCalendar / useSystemCalendarEvents。

## 一、环境事实

- 真机：MuMu 12（emulator-5554），Android 15；Metro 主树 `npx expo start --dev-client`（8081，后台 job）；`adb reverse tcp:8081`。**勿在项目目录写临时文件**（Windows FallbackWatcher ENOENT 会带崩 Metro node）。
- adb 命令会挂起的（`adb start-server`/`devices`）一律后台跑；adb server wedged 时 `powershell Stop-Process -Name adb` 后重启恢复。
- `pm revoke` 会杀进程；**pm revoke 不重置 canAskAgain**（USER_SET|USER_FIXED 保留，12:11 拒绝后 revoke+重启不再弹框）。
- 日历造数：`content insert` 到 Events 表（列名 `calendar_id`；`calendar_timezone` 是 provider-only 不可写；rrule 含分号需内层双引号 `--bind rrule:s:"FREQ=WEEKLY;COUNT=4"`）；`content query --projection` 的逗号列名串会被整当一个列名。
- 系统日历终态：cal1=测试日历（account local-test、红）、cal2=工作日历；事件=今日下午同步会/明日站立会/每周例会（RRULE WEEKLY COUNT=4）；displayCalendarIds 终态 `[]`（功能关闭，还原干净）。

## 二、数据库/构建事实

- **真机迁移实测**：启动前 user_version=13 → v14 bundle 重启 → logcat `[🍉] [SQLite] Migrating from version 13 to 14... Migration successful`（11:56:16）→ user_version=14、app_settings 行保留。
- 验收（终态）：`npx tsc --noEmit` 0 错；`npx jest --runInBand` **86 套件 / 1199 用例全绿**（基线 81/1145 → +5/+54 只增不减）；`npx expo-doctor` 2 项失败与预存基线一致（non-CNG app config 未同步 + RN Directory 元数据 watermelondb/widget-snapshot-store/battery-optimization/simdjson），无新增。

## 三、真机验收矩阵（任务卡 §3）

| # | 项目 | 结果 | 证据 |
| --- | --- | --- | --- |
| 1 | v13→v14 迁移 | ✓ | logcat + PRAGMA user_version=14 + 行保留 |
| 2 | 面板分组/色点/开关/写库 | ✓ | local-test 组头 + 红点 + 眼睛；开工作日历 db `["2"]`、关 `[]` |
| 3 | agenda live 行 | ✓ | 🔒+红条+16:00-17:00+local-test 副行；组计数 3→4 |
| 4 | 只读弹层 | ✓ | 红条头+🔒+标题+时间+来源+「只读条目…不提供编辑」；不跳详情 |
| 5 | week/month/day live 行 | ✓ | week 周条+live 行；month 格 chips（11-17 3绿+1）；day 时间轴红条块 |
| 6 | 取消即时隐藏 | ✓ | 关工作日历 → db `[]` + 时间轴 16:00 清空 |
| 7 | 切页签/回前台 bypass 重读 | ✓ | 面板外插入事件 → 切页签回计划页立即出现 |
| 8 | 权限拒绝态 | ✓ | 弹框拒绝→「未获得日历读取权限」+重新授权+固定文案不崩溃；expo 挂起→8s 超时→「读取失败，请重试」；OS 恢复授权→重启 live 行回归 |
| 9 | D2 去重 | ✓ | 已导入 3 条显 📌 普通行（live 隐藏）；周三25/12-02 每周例会显 🔒 live 行（首实例命中、其余照常） |
| 10 | L10 复核定性 | ✓ | **缺陷坐实**（见 §四.1），记 closeout 不修 |
| 11 | 缓存命中不重读（矩阵5） | ✓ | 单测覆盖（切窗回跳 getEvents 计数不增）+ 真机行为一致 |
| 12 | 固定说明文案 | ✓ | 区底「选中的系统日历事件将实时显示…可能重复…首实例」全文可见 |
| 13 | 外部 CalDAV 日历 | 未验 | MuMu 无 CalDAV 服务端环境；装真机有订阅日历时补验（记 backlog） |

## 四、遗留披露

1. **L10 缺陷坐实（不修，另立提案）**：导入流程 6 条只落 3 条——每周例会 11-25/12-02/12-09 三实例被共享 event.id 的 findItemBySource 去重吞掉（sqlite：`SELECT title, datetime(start_at/1000,'unixepoch','localtime'), source_uid FROM items WHERE source_type='system-calendar' ORDER BY start_at;` 只见 source_uid=9/10/11 三条）。修复涉去重键语义（repository.md v0.9 冻结），须独立变更提案。live 直读不受影响（D2 按设计只精确命中首实例，其余实例正常显示）。
2. **expo-calendar 15.0.8 权限挂起缺陷（已兜底）**：MuMu Android 15 单次拒绝后 canAskAgain=false，后续 requestPermissions 由系统秒杀 GrantPermissionsActivity 自动拒绝（logcat result=2 + Force remove DESTROYING），**expo JS promise 永不落定**。三层恢复：① 8s 超时兜底按拒绝处理（不再永久卡 loading）；② doFetch 拒绝态自愈（OS 层改回授权后回页签/回前台自动恢复）；③ plan.tsx 联动 effect（清单恢复 ready 且 events 仍 no-permission → 补 retryPermissions）。OS 已授权时重启恢复完全（12:23/12:40 两轮复验）。
3. **全天事件 D2 去重不命中**：导入项 allDay startAt 归一到 tzid 当天 00:00（normalizeAllDayTimestamps），live 原始 startDate 不等 → 已导入全天事件同时开显示会重复。ui.md 固定文案「可能重复」覆盖；代码注释已记录；不修。
4. **D7 month 缓冲页无 live chip**：月历格 chips live 只并入锚点月窗口，前后缓冲页格内无 live（点开才加载该月窗口）；ui.md 已作已知边界披露。
5. **矩阵 13 CalDAV 未验**：MuMu 无 CalDAV 环境；非功能缺陷，补验项记 backlog。
6. 应用终态：displayCalendarIds=[]（功能关闭还原）；测试日历/事件留在系统 provider（模拟器造数，可 `content delete` 清理）；未新增 items/ reminders（导入验证用的 3 条 system-calendar 条目留在库，属 L10 定性证据）。

## 五、踩坑教训

- **视口假象（本次最大弯路）**：agenda live 组（周三25）在未滚动视口折叠线以下——12:31 重启后误判「live 行消失」排查 40 分钟，实为 12:23 验证截图带过下滑滚动、之后的截图从未滚动。**验证列表内容前先滚动到目标组**。
- jest-expo：`requireActual('react-native')` 触发 DevMenu TurboModule 崩溃，不可 mock 整个 RN——AppState 用 `jest.spyOn(AppState,'addEventListener')`；裸 async fn 不能 toHaveBeenCalledTimes（makeReader 用 jest.fn 包装）；`useFocusEffect` mock 后测试文件仍需 import 引用；renderer 类型用 `ReturnType<typeof TestRenderer.create>`（项目本地 ambient `src/types/react-test-renderer.d.ts` 已加 `update`）。
- Fast Refresh 保留 hook state：诊断日志注入 hook 后立即在真机生效（无需重启），`logcat | grep s27-diag` 三分钟定位卡点；**诊断日志必须全部移除后才能提交**（本次已移除干净）。
- MuMu input tap 偶发被吞（BACK/重试按钮/页签切换都有记录）——重按或换坐标；面板 fade-in 未完成时点芯片会穿透下层列表；筛选图标 x 随视图切换（agenda 727 / week 641 / month,day 724）。
- WatermelonDB writer 队列积压（408→171 缓慢排空）为反复 force-stop 的 reminder/widget 写积压，与本功能无关（本功能仅 toggle 时写 settings 一处）。
- 12:18 toast `Unable to activate keep awake` 是 expo-keep-awake dev 重启假象，与日历权限无关（先看完整错误再归因）。

## 六、代码地图（切片 27 终态）

**域层**
- `src/domain/views/liveCalendar.ts`（新建 ~150 行）：LiveCalendarEntry/isLiveCalendarEntry/buildLiveCalendarEntries（§〇.4）。
- `src/domain/systemCalendar/types.ts`：SystemCalendarInfo + color/sourceName。

**DB/数据层**
- `src/db/schema.ts`（v14）/ `src/db/migrations.ts`（toVersion 14）/ `src/db/models/AppSettingsModel.ts`（@text）/ `src/domain/settings.ts`（displayCalendarIds 三件套 + 默认值）/ `src/data/WatermelonItemRepository.ts`（读层 + 写层三处）/ `src/data/systemCalendarAdapters.ts`（toDomainCalendarInfo + D5）。

**UI 层**
- `src/ui/useSystemCalendarEvents.ts`（新建 ~330 行）：useSystemCalendarEvents + useSystemCalendarList + requestPermissionsWithTimeout（8s 兜底）。
- `src/ui/CalendarDisplaySection.tsx`（新建）：面板日历显示区（分组/色点/开关/固定文案/权限态/web null）。
- `src/ui/LiveCalendarModal.tsx`（新建）：只读弹层。
- `src/ui/FilterSheet.tsx`：calendarDisplay 插槽（「日历源」与「状态」之间）。
- `src/app/(tabs)/plan.tsx`：liveRange/hook 接线/build effect/四路径 concat/handleRowPress live 分流/AgendaItemCard live 渲染/Modal 挂载/恢复联动 effect。

**测试**：`src/db/__tests__/migrationsV14.test.ts`、`src/domain/__tests__/settingsDisplayCalendar.test.ts`、`src/data/__tests__/systemCalendarAdapterMapping.test.ts`、`src/domain/views/__tests__/liveCalendar.test.ts`、`src/ui/__tests__/useSystemCalendarEvents.test.ts`（含 AppState spy / expo-router mock / never-settling 权限超时用例）。

**文档**：`docs/contracts/repository.md`、`docs/contracts/ui.md` 新节；`AGENTS.md` v0.31；`tasks/slice-27.md`；`src/types/react-test-renderer.d.ts`（+update）。

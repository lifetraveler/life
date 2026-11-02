# 切片 4 收尾移交（Close-out Handoff）

> 生成于切片 4 正式关闭时。切片 5 新会话按 AGENTS.md §7.1 读 AGENTS.md（v0.4）、tasks/slice-05.md（待创建）与本文件；本文件补充环境事实与教训，不改变任何契约。
> 验收结论：切片 4 全部验收标准通过。证据：`tsc` 0 错误 + Jest 47/47 + expo-doctor 16/18（两项均为既有信息级基线）+ git 静态检查。

## 环境事实（实测，勿重查）

- 仓库：`F:\code\vibecoding\life`；remote `origin` = `https://github.com/lifetraveler/life.git`。
- 分支模型（本次写入 AGENTS.md §7.8–7.11）：每个切片从最新 `main` 新建 `task/slice-<编号>`；验收后 commit → push 分支 → `git merge --no-ff` 到 `main` → push `main`；closeout 随切片提交，切片分支保留。
- 本切片分支：`task/slice-04`；基线：`main@6602af8`（切片 1–3 合并提交）。
- 工具版本：Node 24.15.0、npm 11.12.1、git 2.42.0.windows.2、Windows。
- **本会话末尾 shell 故障**：所有 bash / PTY 命令返回 exit `3221225794`（`0xC0000142`，`STATUS_DLL_INIT_FAILED`），stdout/stderr 为空；`echo` 同样失败，说明是 shell 进程初始化问题，与 git/仓库无关。git 收尾操作改由 ego-browser 的 Node `child_process` 执行。下次会话先跑 `git status` 验证 shell 是否恢复，不要据此怀疑仓库。
- npm 全局 cache 在沙箱外，直接 `npx` 安装会 `EPERM`；本切片用 `npm install @date-fns/tz --cache .npm-cache --no-audit --no-fund`，装完删除 `.npm-cache`，未入 git。
- expo-doctor 直接 `npx expo-doctor` 在沙箱内无法执行（全局 cache 写入 EPERM + 子进程管道 `spawn EPERM`）。本次用缓存中的 expo-doctor 1.21.5，临时把 `USERPROFILE`/`HOME` 指向工作区（Expo CLI 需写 `~/.expo/native-modules-cache`），并用临时 stdio→文件桥接绕过命名管道限制；结果 16/18，与切片 3 基线一致。临时目录已删除。

## 验收命令与结果

| 命令 | 结果 |
|---|---|
| `npx tsc --noEmit` | 通过，0 错误 |
| `npx jest --runInBand` | 4 suites / 47 tests 全部通过 |
| `npx jest src/domain/recurrence --runInBand --verbose` | 3 suites / 32 tests 全部通过 |
| `npx expo-doctor` | 沙箱直接执行被阻断；等价方式 16/18，与切片 3 基线一致 |
| `git diff --check` | 无输出 |
| `git diff -- src/db src/data src/app src/ui` | 空 |
| `any` / 禁止 import / `rrule` 静态检查 | 均无匹配 |

expo-doctor 的 2 项既有信息级失败：

1. `Check for app config fields that may not be synced in a non-CNG project`：native 目录与 app.json 的 Prebuild 配置并存，既有基线。
2. `Validate packages against React Native Directory package metadata`：`@nozbe/watermelondb` 未标 New Architecture、`@nozbe/simdjson` 无元数据，既有基线。

## 依赖与构建事实

- 新增依赖：`@date-fns/tz@1.5.0`（package.json `^1.5.0`，lockfile 解析 1.5.0）。
- 选择理由：standalone、约 1.7 KB；`tzOffset` 符号明确（东正西负）；`TZDate(instant, tzid)` 可直接取指定 IANA 时区民用字段；不引入完整 date-fns，不引入 `rrule`。
- 未修改 `jest.config.*`；测试全部显式传 `tzid`，并有一条切换 `process.env.TZ` 后结果不变的隔离测试（`afterAll` + `finally` 还原）。
- 未新增 schema / migration；`src/db/schema.ts` 仍 `SCHEMA_VERSION = 2`，`src/db/migrations.ts` 仍只有 `toVersion: 2`。
- 本切片未触碰 DB、UI、通知；未启动 Metro、未安装 dev build、未做真机手动步骤（切片 4 任务卡无手动步骤）。
- 设备库仍为切片 3 收尾基线：5 items（全部 active）、2 tags（工作、生活）、2 joins、`user_version=2`。

## 代码地图（切片 5 起点）

- `src/domain/recurrence/types.ts`：`RecurrenceFrequency` / `LocalTime` / `RecurrenceRule` / `ExpandOccurrencesInput` / `Occurrence` / `BuildOccurrenceKeyInput`，规则类型按任务卡冻结。
- `src/domain/recurrence/civilTime.ts`：
  - `assertValidTimeZone(tzid)`：用运行时 Intl 校验 IANA，拒绝 `+08:00` 等固定偏移；
  - `getZonedParts(instant, tzid)`：`TZDate` 取本地年月日时分与 1=Mon…7=Sun 星期；
  - `resolveCivilTimeToInstant(tzid, y, m, d, h, min)`：gap 返回 `null`，fold 取较早瞬间；
  - `daysInMonth` / `addOneDay` / `getCivilWeekday` / `formatLocalDate` / `formatLocalTime` 纯日历工具。
- `src/domain/recurrence/occurrenceKey.ts`：`buildOccurrenceKey`，格式 `recurrence:v1|<encodeURIComponent(scheduleId)>|<YYYY-MM-DD>|<HH:mm>|<tzid>`；不含 UTC 时间戳。
- `src/domain/recurrence/expandOccurrences.ts`：校验、逐日展开、`count` 默认/上限、`startAt` 过滤、5 年防死循环上限。
- `src/domain/recurrence/index.ts`：对外导出类型、`expandOccurrences`、`buildOccurrenceKey`。
- `src/domain/recurrence/__tests__/expandOccurrences.test.ts`：daily / weekly / monthly 短月 / DST gap / DST fold / startAt / 边界 / 时区隔离。
- `src/domain/recurrence/__tests__/civilTime.test.ts`：gap/fold 解析、闰年、跨月跨年、补零、星期、zoned parts。
- `src/domain/recurrence/__tests__/occurrenceKey.test.ts`：key 格式、字段敏感性、编码、重复展开稳定性。

## 关键设计决定（切片 5 勿重复实现）

- **gap/fold 判定算法**：以 `Date.UTC` 构造 UTC 猜测值，采样 `guess - 24h / guess / guess + 24h` 的 `tzOffset`，生成候选瞬间，再用 `TZDate` 反查本地字段匹配目标民用时间；无候选 = gap 跳过，两个候选 = fold 取 `Math.min`（较早）。不依赖库对歧义时间的默认选择。
- **monthly 短月**：`effectiveDay = Math.min(dayOfMonth, daysInMonth(year, month))`，固定回退到月末，不跨月。
- **startAt**：只接受 `instant >= startAt`；同一天 localTime 已过则自然进入下一周期；`startAt` 恰好等于 occurrence 时包含。
- **count**：默认 30；负数/非整数抛错；`0` 返回 `[]`；`>30` 截断到 30（代码注释已说明）。
- **tzid**：必须是 IANA 名称；固定偏移会破坏 DST 民用时间模型，显式拒绝。
- **occurrenceKey**：只由 scheduleId / localDate / localTime / tzid 生成，禁止用 UTC 时间戳。

## 踩坑教训（切片 4 新增）

1. `@date-fns/tz` 的 `tzOffset` 返回东正西负（`Asia/Shanghai` = +480，`America/New_York` 冬季 = −300），不要套用 `Date.prototype.getTimezoneOffset` 的符号。
2. 候选瞬间不能只用“guess 的偏移 → t1 → t1 的偏移 → t2”两跳；某些时区的 fold 会只看到较晚偏移，漏掉较早瞬间。必须采样 `guess ± 24h` 再用本地字段反查。
3. `@date-fns/tz` 发布 CJS + ESM exports；Jest `jest-expo` 走 `require` 的 `index.cjs`，无需新增 `transformIgnorePatterns`。
4. `TZDate` 构造只接受真实 IANA / 偏移；本模块在入口用 `Intl.DateTimeFormat` 校验并拒绝固定偏移，避免后续 DST 行为静默退化。
5. Hermes 需要 FormatJS Intl polyfill 才能可靠使用 `@date-fns/tz`；本切片只跑 Node/Jest，切片 5 接入 RN 前必须先补 polyfill 并在真机验证（不要假设 Node 的 full ICU 行为等同 Hermes）。
6. 本机 shell 在会话末尾出现 `0xC0000142` 初始化失败；git 收尾改用 ego-browser 的 Node `child_process` 执行。若下次新会话 shell 仍失败，先修环境，不要重复尝试或改写仓库。
7. 沙箱内 npm 全局 cache 与 piped child_process 都会 EPERM；安装依赖用工作区 `--cache`，expo-doctor 需临时 home + stdio 文件桥接；临时目录装完即删，避免污染 `git status`。
8. 不要用 `npx expo-doctor` 的结果直接判断项目新增问题：先看两项既有基线（non-CNG、RN Directory），再对比切片 3 的 16/18。

## 遗留披露（原样带入切片 5）

- **Hermes polyfill 风险**：`@date-fns/tz` 在 RN Hermes 下需要 FormatJS `Intl` polyfill；切片 5 需在 app 入口补 polyfill 并真机验证，不能只在 Jest 通过。
- **运行时 IANA 依赖**：时区规则以运行环境 Intl 数据为准；旧设备/裁剪 ICU 环境需验证。不得硬编码 DST 日期。
- **expo-doctor 两项既有信息级基线**：non-CNG 配置、RN Directory metadata；本切片未新增阻塞项。
- **无真机验收**：切片 4 为纯逻辑模块，任务卡无手动步骤；未启动 Metro/未安装 build。
- **AGENTS.md 工作流约束**：本次新增 §7.8–7.11（切片分支、commit/push、merge、closeout）并更新 §8；切片 5 起必须按此执行。
- **分支状态**：本文件随 `task/slice-04` 提交；随后按 §7.9 push 分支、`--no-ff` 合并到 `main`、push `main`。若 push 因远端凭据失败，本地提交仍保留，需在凭据恢复后补推。

## 收尾事实（2026-11-02）

- 切片提交：`257660a`（`task/slice-04`，13 files changed，1188 insertions）。
- 合并提交：`cfe75cf`（`main`，`--no-ff`）。
- 远端已核对：`origin/main` 包含合并提交 `cfe75cf`，`origin/task/slice-04` = `257660a`。
- 推送异常与解法：默认 HTTPS 推送曾报 `Recv failure: Connection was reset`；使用
  `git -c http.proxy=http://172.16.100.254:7893 -c http.version=HTTP/1.1 push ...` 成功。
  本机全局 git 配置已有 `https.proxy=http://172.16.100.254:7893`，**HTTP/1.1 是本次成功的关键**；
  后续 push 再遇 reset 先加 `-c http.version=HTTP/1.1`。
- 收尾时工作区干净，`main` 与 `origin/main` 同步。

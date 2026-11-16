# 切片 25 · 阶段 1 反馈总结（schema v12 + 设置管道 + 域修复）

- 日期：2026-11-16
- 阶段：Phase 1 / 共 3（纯逻辑可单测；阶段 2 为 Chat 确认交互 + 设置页开关，阶段 3 真机验收矩阵）
- 分支：`task/slice-25`（基点 main @ 3685e52）
- 阶段提交：`0dc462c`（21 文件，+772/-33）——含任务卡 `tasks/slice-25.md` 与 AGENTS.md v0.27（§7.37 + §8 刷新）随阶段 1 提交
- 状态：⏸ 暂停等待阶段 2（无遗留缺陷；阶段 2 消费面见 §四）

## 一、成果定性：达标

| 维度 | 结果 |
| --- | --- |
| 类型安全 | `npx tsc --noEmit` 0 error |
| 测试 | `npx jest --runInBand` 79 套件 / 1073 用例全过（基线 77/1053 → +2 套件 +20 用例，只增不减） |
| expo-doctor | 16/18，2 失败均为预存基线（android/ CNG 同步提示 + RN Directory 元数据），无新增 |
| 真机 | 未做（阶段 3 场景矩阵） |

## 二、范围落点（阶段提交 0dc462c，21 文件）

| 文件 | 修补 | 解决的问题 |
| --- | --- | --- |
| `src/db/schema.ts` | SCHEMA_VERSION 11→12；app_settings 列加 `{ name: 'careful_mode', type: 'boolean' }`（非可选） | 任务卡阶段 1-1：认真模式开关存储列 |
| `src/db/migrations.ts` | 尾部追加 toVersion: 12 单条 addColumns（零 unsafeExecuteSql 零 UPDATE，v10/v11 惯例） | 旧数据 addColumns 自动回填 false（v10 is_default 先例），不清库不改已发布 step |
| `src/domain/settings.ts` | AppSettings 加 `carefulMode: boolean`；DEFAULT_APP_SETTINGS 加 `carefulMode: false` | 域层设置形状与默认值 |
| `src/db/models/AppSettingsModel.ts` | `@field('careful_mode') carefulMode!: boolean;` | model 映射（装饰器写法受 §5 保护，未改动其余字段） |
| `src/data/WatermelonItemRepository.ts` | toDomainSettings 读层防御归一（非 boolean 回退默认）；getSettings 兜底 create 与 updateSettings 写层（create 块 patch ?? 默认 / update 块 if-defined）支持 carefulMode | 任务卡阶段 1-4；任务卡写的「updateAppSettings」实为既有 `updateSettings` 方法（同一写层区域） |
| `src/domain/ai/chat.ts` | 标题保护块守卫扩为三支 `inheritTitle = inheritTags \|\| !parsed.expressed.has('startAt')`（:79 inheritTags 谓词同源） | 切片 24 closeout §5 遗留 1：全新意图（带新时刻）不再误留上一张卡标题（「起床」→「后天下午3点开会」回归用例钉死） |
| `src/domain/ai/prompt.ts` | 多轮上下文节追加反向边界注记（新意图不复用上一张卡标题，仅修改类输入以上一张卡为基准） | 任务卡阶段 1-5 远端路径：§7.37 域规则远端同语义 |
| `src/domain/ai/editDiff.ts`（新增） | `diffDraftChanges(previous, next): DraftFieldChanges` 纯函数：9 字段判定 + changedFields canonical 序；集合判等（tags/channels/recurrence weekdays 乱序等价、缺省与空数组等价） | 任务卡阶段 1-6：阶段 2 useFlashChat 认真模式守卫的 diff 消费面 |
| 测试 9 文件 | 新增 `migrationsV12.test.ts`（结构+行为级）、`editDiff.test.ts`（9 用例）、chat 三态守卫（3）、prompt 注记断言、categorySettings carefulMode 往返（2）；例行更新 migrationsV8/V9/V11 + seedPreset 版本守卫（11→12）、viewQueries/categorySettings 全量 toEqual 补 carefulMode、ReminderScheduler.test.ts stub 补字段（编译必需 +1 行） | 基线只增不减；schema 守卫按各切片「例行更新」惯例顺延 |

## 三、偏差披露（任务卡 vs 实现均已注释说明）

1. **守卫谓词 2 支 → 3 支**：任务卡阶段 1-5 原谓词仅 `matchesEditIntent ∨ needsClarification`，实施后既有测试「降级补充轮：标题沿用上一轮主题词」失败——ai.md :197「澄清续答轮与已有卡片后的补充轮同样 title 沿用上一轮主题词」契约钉死补充轮沿用。按 AGENTS §7.12 以契约正文为准，扩为三支（编辑词轮 ∨ 澄清续答 ∨ 本轮未表达新时刻的补充轮）；带新时刻又带新主题词 = 全新意图不沿用。依据链：fallbackSlots 的 expressed 集合中时间=startAt/endAt/allDay 三键同加，`expressed.has('startAt')` ⟺ 本轮表达了新时刻。
2. **残余边界（已披露，同遗留 1 家族收窄）**：不带时刻的全新意图（如「记一下体检报告指标」）仍沿用旧标题——补全该家族需区分「补充细节 vs 全新无时刻意图」，超出本切片范围，待 backlog 评估。
3. **`src/notifications/` 零 diff 说明**：任务卡验收 4 要求零 diff——实现文件零改动属实；`src/notifications/__tests__/ReminderScheduler.test.ts` 仅 stub 补 `carefulMode: false` 一行（AppSettings 新必填字段的编译必需，§7.13 测试夹具豁免惯例）。

## 四、关键设计落点（阶段 2/3 消费面）

- **设置读取**：阶段 2 useFlashChat 在既有 `getSettings()` 调用点取 `settings.carefulMode`（savePlan 已走同款 settings 传入路径，无需新查询）。
- **diff 守卫**：`diffDraftChanges(prevCard, nextDraft)` 取 `titleChanged || contentChanged` 决定拦截；time/reminders/tags 等其余字段不参与拦截判定（§7.37 拦截范围冻结）。title 与 content 同轮双改天然合并为一条 confirm（单次 diff 结果）。
- **开关写入**：`updateSettings({ carefulMode: boolean })` 即时生效；设置页 profile.tsx AI 配置区块 Switch 复用 widget 开关行样式。
- **迁移行为**：旧数据（v11 行升级）careful_mode 经 addColumns/sanitizedRaw 回填 false，读层另有防御归一双保险；schema v12 后续切片迁移顺延 v13（任务卡「明确不做」注记）。

## 五、真机验收清单（阶段 3 执行，本阶段预置）

- v12 迁移真机执行：重启后旧数据 careful_mode=false、设置开关可开可关且重启保持
- 场景矩阵 6 条见任务卡阶段 3（默认关回归 → 开启拦截/应用/放弃/新输入取消 → 域修复回归）

## 六、教训（closeout 时汇总）

- **既有测试是契约的活文档**：任务卡谓词写完先跑全量相关测试——chat.test.ts 一个红用例直接暴露任务卡与 ai.md 的语义冲突，避免把契约缺陷带进实现。
- **「例行更新」守卫测试是版本号迁移的固定账单**：SCHEMA_VERSION 每次递增牵动 4 个 db 测试套件 + 全量 settings toEqual 断言 + 通知测试 stub，阶段 1 一次性结清。

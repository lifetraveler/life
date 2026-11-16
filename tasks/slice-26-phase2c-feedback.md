# 切片 26 · 阶段 2c 反馈总结（每平台独立配置槽）

- 日期：2026-11-17
- 阶段范围：Phase 2c / 共 3（原计划 3 阶段 + 追加 2b/2c，本阶段=用户反馈驱动的追加阶段）
- 分支：`task/slice-26`（基点 main @ `91ed33d`）
- 提交：`52e6758` feat(s26): 阶段2c 每平台独立配置槽（8 文件 +308/−91；保存即激活 + 使用中徽标 + v1→v2 归一化迁移）
- 状态：✅ 完成，暂停等待阶段 3（真机验收矩阵）——无阻塞遗留

## 成果定性

| 项 | 结果 | 对照 |
| --- | --- | --- |
| `npx tsc --noEmit` | 0 错 | 基线 0 |
| `npx jest --runInBand` | **81 套件 / 1145 用例全绿**（+5） | 阶段 2b 后 81/1140 |
| `npx expo-doctor` | 2 项失败 = 预存基线（app config 同步检查 + RN Directory 元数据），无新增 | 预存 2 |
| 真机 | 设备全链路验证 5 步通过（见下） | MuMu 7555 |

## 范围落点

| 文件 | 修补 | 解决的问题 |
| --- | --- | --- |
| `src/domain/ai/configStore.ts` | `AiConfig` + `slots`/`activePlatform`；`createEmptyAiSlots()`；isAiConfig 归一化（v1 归槽 / v2 逐槽校验 + active 重算不变式） | 每平台独立保存；旧配置无感升级 |
| `src/app/settings/ai.tsx` | state 槽化 + `applySlotToForm` + 保存即激活 + 「· 使用中」徽标 + 保存按钮残态重置 | 切平台 Key 不再串槽；使用中平台可见 |
| `src/domain/ai/__tests__/configStore.test.ts` | isAiConfig describe 重写 8 条 | v1/v2/损坏四态/active 重算全覆盖 |
| `src/data/__tests__/SecureAiConfigStore.test.ts` | load 断言跟改（槽模型输出） | 归一化新形状 |
| `docs/contracts/ai.md` | v0.21→v0.22 + 七条非破坏性条目 | 槽模型契约化 |
| `AGENTS.md` | v0.29→v0.30 + §7.38 注记段 | 项目契约同步 |
| `docs/proposals/slice-26-ai-config-enhancement.md` | §9 v2 修订段 | 提案与实现一致 |
| `tasks/slice-26.md` | 阶段 2c 小节 | 任务卡追溯 |

## 设备全链路验证（MuMu 7555，截图 .tmp-s26/s36–s45）

1. **v1→v2 迁移实证**：设备存阶段 2b 单槽配置（active.platform=deepseek）→ 装载后 DeepSeek 槽自动归位 + 「· 使用中」徽标 + 表单回填（官方 URL/Key 圆点/flash/六价）。
2. **切编辑视图**：点自定义 chip → 空槽按预设初始化（BaseURL 默认/Key 空/Model 默认/两价区），DeepSeek「使用中」徽标保持，Key 不跟平台。
3. **保存即激活**：自定义槽填占位 Key 保存 → 「custom · 使用中」徽标切换。
4. **槽持久化**：force-stop 重进 → custom 槽内容回显 + 徽标保持。
5. **切回**：DeepSeek 保存 → 徽标回归 + 官方槽内容完整。

过程发现并当场修复：保存按钮「已保存」残态跨平台切换不清零 → handlePlatformPress 加 `setSavedTick(0)`。

## 关键设计落点（阶段 3 消费面）

- **active 不变式**：`active ≡ slots[activePlatform]`（isAiConfig 归一化按槽重算，传入值被忽略）——闪电录入消费面 `config.active` 零改动。
- **验收基线**：deepseek 槽=官方分层配置（URL/Key/flash/六价 0.04/0.02/2/1/8/4）为「使用中」；阶段 3 矩阵 1–6/10 的远端轮走此槽。

## 教训（详见 closeout §四）

1. adb 坐标点击对滚动位置敏感，必须 `uiautomator dump` 取 bounds 再点。
2. 「已保存」类瞬时 UI 状态跨视图切换需显式重置，否则截图冒烟时误导判读。
3. SecureStore XML 层为 AES 密文，槽内容验证以 UI 回显为准。
4. jest 首跑仅 1 失败（SecureAiConfigStore.load 断言），与「isAiConfig 归一化多键」预判完全吻合——守卫形状变更先 grep 消费测试可预判跟改面。

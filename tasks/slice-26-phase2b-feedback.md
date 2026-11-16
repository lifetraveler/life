# 切片 26 阶段 2b 反馈总结：AI 配置平台化 + DeepSeek 峰谷分层计价

> §7.33 情形 3（单阶段暂停移交）。阶段顺序：Phase 1 → Phase 2 → **Phase 2b（追加）** → Phase 3（真机验收）。

## 头部

- 日期：2026-11-17
- 阶段范围：Phase 2b / 共 3+2b——AI 配置页平台预设与 DeepSeek 峰谷分层计价（用户 2026-11-17 需求，提案 `docs/proposals/slice-26-ai-config-enhancement.md` 已确认并入）
- 分支：`task/slice-26`（基点 main @ `91ed33d`）
- 本阶段提交：`e532d4f` feat(s26): 阶段2b AI 配置平台化 + DeepSeek 峰谷分层计价（12 文件，+1110/−59）
- 状态：**代码完成、单测全绿；真机 UI 验收与依赖 Key 的验收 1–6/10 未开始**（等阶段 3 一并执行）

## 成果定性表

| 项 | 结果 | 对照 |
| --- | --- | --- |
| `npx tsc --noEmit` | 0 错 | 基线 0 |
| `npx jest --runInBand` | **81 套件 / 1140 用例全绿** | 阶段 2 后 1124（+16 只增不减；切片 25 收尾基线 79/1087） |
| `npx expo-doctor` | 2 项失败 = 预存基线（app config 非 CNG、RN Directory 元数据） | 无新增 |
| 真机 | 未执行（阶段 3 统一做；v12→v13 迁移与验收 7/8/9 已在环境攻坚中先行通过） | — |

## 范围落点表

| 文件 | 修补 | 解决的问题 |
| --- | --- | --- |
| `src/domain/ai/usage.ts` | +`AiDeepSeekTierPrices`、`isPeakBeijing`、`readAiUsageSnapshotTiered`；内部重构 `readUsageEnvelope`/`estimateFlatCost`/`roundCost` 共用校验 | DeepSeek 峰谷分层估算（缓存命中/未命中/输出三段逐段取价）成为域层单点；flat 路径签名不变 |
| `src/domain/ai/configStore.ts` | +`AiPlatform` 五值、`AiPlatformPreset`、`AI_PLATFORM_PRESETS`；`AiProviderConfig` +`platform?`+六价字段；守卫透传 | 平台预设数据源落域层；集合外/坏价丢弃为 undefined 不整包拒绝（旧配置兼容） |
| `src/domain/ai/openAiCompatible.ts` | config +platform/六价；构造器第三参 clock 注入 `nowImpl`；parse() usage 提取按 platform 分叉 | deepseek → tiered（实时判峰谷），其余 → v0.20 flat；测试可注入时钟 |
| `src/app/settings/ai.tsx` | 平台 chips + Model chips（随预设）+ deepseek 三组六输入单价区（官方价预填 flash 0.04/0.02/2/1/8/4、v4-pro 0.3/0.15/9/4.5/27/13.5）+ 非 deepseek 维持两价区 | 零新依赖完成平台化 UI；选 deepseek 模型 chip 自动预填官方价 |
| `docs/contracts/ai.md` | 头部 v0.20→v0.21 + 文末 v0.21 非破坏性条目（九条） | 契约随实现推进；传输边界冻结条款不变 |
| `AGENTS.md` | v0.28→v0.29；§7.38 末尾「平台预设与峰谷分层」注记段（含已知限制） | 契约索引同步 |
| `tasks/slice-26.md` | 追加阶段 2b 小节（文件表+测试）；验收 3/4 补分层语义；「明确不做」估算条款改写 | 任务卡与实现一致 |
| `tasks/backlog.md` | §6 追加已知限制：节假日不识别（高估方向） | 防止误判为遗漏；精确节假日历表为待定候选 |
| 测试 3 文件 | usage.test.ts（isPeakBeijing 边界 8 值/周末/国庆实证 + tiered 六态）、configStore.test.ts（platform 集合/六价透传）、openAiCompatible.test.ts（tiered 峰谷/全缺价/缺省 flat） | 新逻辑全覆盖 |

## 关键设计落点（阶段 3 / 后续消费面）

- **估算分叉单点**：`openAiCompatible.ts` parse() 内 `platform === 'deepseek' ? readAiUsageSnapshotTiered(envelope, {六价}, now) : readAiUsageSnapshot(envelope, {input, output})`——其余链路（lastUsage getter、FlashTurnResult.usage、hook 用量行）零改动。
- **逐段取价规则**：cachedAmount = `cached_tokens ?? 0`（缺省全按未命中价）；uncachedAmount = prompt − cached；**amount>0 的段才要求对应档位价**，缺价只出 token 段（estimatedCost=null），不炸主链。
- **`isPeakBeijing`**：UTC+8 固定偏移读 UTC getters；周一至周五 9:00–12:00 / 14:00–18:00 高峰；法定节假日不识别（2026-10-01 实证判高峰=已知限制，backlog §6）。
- **UI 单价区按平台切换**：deepseek 六价三组（缓存命中/未命中/输出，各高峰/空闲），其余平台 v0.20 两价；`DEEPSEEK_MODEL_TIER_PRICES` 官方价预填仅在选 deepseek 模型 chip 时触发。
- **clock 注入**：`OpenAICompatibleProvider` 构造器第三参 `now: () => number = Date.now`，默认行为不变。

## 教训索引（详见 closeout §四）

1. **Windows bash 下 `python - <<'PY'` heredoc 中文会被按 cp936 误解**——含中文的 python 脚本必须先写成 UTF-8 文件再执行；console stdout 打印中文会 GBK UnicodeEncodeError 炸掉，检查输出落盘文件后用 read 看。
2. **edit 工具锚点失配排查链**：grep 确认唯一 → cat -A 看字节 → 最后发现是行首空格数写错（验收矩阵行首 2 空格，误写 3）；read 工具的 `行号: ` 前缀含分隔空格，容易把缩进多看一格。
3. **Metro 会被编辑器临时文件崩掉**：edit 工具在受监视目录写 `.xxx.tmpdir` 瞬态文件，Windows FallbackWatcher 对其 ENOENT 带崩 node 24（exit 7）——长 Metro 会话期间大量 edit 后注意 watch 日志，崩了重启即可（`npx expo start --dev-client --port 8081`）。
4. `write` 瞬时 EIO (Win32 1175) 重试即过（阶段 2 已遇，本阶段复现 1 次）。

## 遗留与下一步

- 真机验收矩阵 10 项在阶段 3 统一执行：7/8/9 已先行通过（见 b17 环境攻坚记录），1–6 与 10 需设备配置 DeepSeek API Key（MuMu 重置后 secure-store 已空）。
- 阶段 3 收尾：closeout（§7.10）+ backlog §1 划项 + AGENTS §8 刷新 + push 分支 → main `--no-ff` → push main（§7.9）。

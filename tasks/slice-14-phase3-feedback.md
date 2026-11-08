# 切片 14 · 阶段 3 反馈总结（设置与配置页）

- 日期：2026-11-08
- 阶段：Phase 3 / 6（设置与配置页）
- 分支：`task/slice-14`
- 阶段提交：`bcb4ac6 feat(s14): 阶段3 设置与配置页`（16 文件，+1072/-11）＋ `124af7b fix(s14): 阶段3 验收修复（调色盘色块底色、标签页保存后即时刷新）`（5 文件，+21/-1）
- 状态：✅ 完成（tsc 0 error，jest 36 套件 / 444 用例全过；MuMu 模拟器真机验收 5/6/7 及扩展项全过）

## 一、成果定性：达标，含真机验收

| 维度 | 结果 |
| --- | --- |
| 类型安全 | `npx tsc --noEmit` 0 error（提交前 + 修复后各跑一次） |
| 测试 | `npx jest --runInBand` 36 套件 / 444 用例全过（较阶段 2 +1 套件 / +12 用例） |
| 依赖 | 零新增 |
| 契约 | 未触碰 recurrence/、notifications/ 实现、schema/migrations；Repository 仅契约外文档化扩展（`listTags`，先例同 `getCategories`） |
| 真机 | MuMu 模拟器（900×1600，dev build + Metro）逐项验收通过，见 §三 |

## 二、交付清单

**新增（8 文件）**
- `src/ui/visualOptions.ts`：`PALETTE_COLORS`（10 色，含黑/橙满足验收 5/6）+ `EMOJI_CHOICES`（28 个，前 5 与预置分类一致）。
- `src/ui/ColorPalette.tsx`：10 色圆块 + 末尾「无」格（`onSelect(null)` 清空自定义色走既有回退灰，不写死 hex）。
- `src/ui/EmojiPicker.tsx`：28 格网格 + 末尾「✕」清除格。
- `src/ui/VisualEditor.tsx`：分类/标签通用视觉编辑器（颜色+Emoji+实时预览 Chip；changed 才可保存；patch 形状兼容 `VisualPatch`）。
- `src/ui/useTagDisplayMode.ts`：`useFocusEffect` 内读 `getSettings()`，失败兜底 `'text'`。
- `src/app/settings/categories.tsx` / `src/app/settings/tags.tsx`：分类/标签管理页（页内展开编辑器；保存后收起；错误页内展示不静默）。
- `src/ui/__tests__/visualOptions.test.ts`（8 用例）。

**修改（8 文件）**
- `src/app/settings.tsx`：顶部新增「分类与标签」入口两行 + 「标签展示样式」radio 组（每行实时 TagChip 示例；乐观更新失败回滚并页内报错）。
- `src/app/_layout.tsx`：注册 `settings/categories`、`settings/tags` 路由。
- `src/domain/category.ts`：`itemPriorityLabel()`（0=无/1=低/2=中/3=高）。
- `src/app/item/[id]/edit.tsx`：分类横向 Chip 选择器（选中绿框高亮）+ 优先级 ★ 选择器（0-3）；保存并入 `updateItem` patch（categoryId/priority）；来源只读项不渲染两个选择器；TagChip 接 mode。
- `src/app/item/[id].tsx`：分类 Chip + 优先级文字展示；`sourceReadOnly` 项底部居中灰色「只读」；TagChip 接 mode。
- `src/app/index.tsx` / `src/app/archived.tsx`：TagChip 接 `useTagDisplayMode`（含 useCallback 依赖修正）。
- `src/data/ItemRepository.ts` / `WatermelonItemRepository.ts` / `notifications/__tests__/ReminderScheduler.test.ts`：`listTags()` 接口/实现/夹具 stub（验收修复，见 §四）。

## 三、真机验收记录（MuMu 模拟器，adb + 截图逐项）

| 验收项 | 步骤 | 结果 |
| --- | --- | --- |
| 验收 5 | 分类管理 →「工作」编辑 → 选黑 + 💼 → 保存 | ✅ 列表 Chip 黑底白字💼；DB 落库 `work=#000000,💼`；编辑页分类行同步渲染黑色 Chip |
| 验收 6 | 标签管理 →「周报」（现场建标签）→ 选橙 + 📝 → 保存 | ✅ 列表 Chip 橙底📝；DB 落库 `#FFB74D,📝`（见 §四问题 2：保存后列表即时刷新经修复后复验通过） |
| 验收 7 | 设置 → 标签展示样式 → 仅表情 | ✅ 首页列表标签变纯 emoji（橙底📝 圆块）；详情页/编辑页同步生效 |
| 扩展 A | 编辑页分类/优先级选择器 | ✅ 选「个人」+ ★★ 保存 → 详情页显示蓝 Chip `个人` + `优先级：中`（updateItem patch 全链路） |
| 扩展 B | 详情页只读项 | ✅ system-calendar 来源项底部居中灰色「只读」；local 项无该标注（对照正确） |
| 扩展 C | 设置页两节渲染 | ✅ 「分类与标签」导航两行 + 「标签展示样式」三选 radio + 每行实时示例 Chip |

## 四、过程问题与教训

1. **调色盘色块无底色（真机抓出，已修）**：`ColorPalette` 初版样式漏写 `backgroundColor: color`，10 个色块全部透明，只剩选中环可见——单测断言的是常量数组而非渲染结果，纯函数测试路线天然覆盖不到样式接线。教训：颜色/样式接线类改动必须真机过一眼；纯函数测试 + 真机验收是互补而非替代。
2. **标签页保存后列表不即时刷新（真机抓出，已修）**：`updateTagVisuals` 落库成功（直接拉 SQLite 验证 `tags` 行已更新）但已挂载页面的 `observeTags` 发射未推送新视觉（对比：分类管理页因保存后显式 `await load()` 无此问题）。修复：Repository 增加 `listTags()`（一次性查询，契约外文档化扩展），保存成功后显式 `setTags(fresh)`，与分类页同模式；复验 ✅（✅→📝 两轮保存均即时刷新）。教训：响应式发射在本机型（MuMu + dev build）上对「行内字段更新」偶发不触发，「保存后显式拉取」比依赖发射更稳。
3. **模拟器 dev client 落后于原生依赖**：模拟器上的 dev build 是 11-05 的（切片 10 时点），切片 11 引入的 `expo-localization` 原生模块缺失 → 启动即红屏 `Cannot find native module 'ExpoLocalization'`。未触发重建，直接安装 android/app/build/outputs 里 11-07 的 `app-debug.apk` 解决。教训：跨切片会话开工先核对「安装的 dev client 构建时间 vs package.json 原生依赖变更时间」。
4. **adb 中文输入落错焦点**：`input text '周报'` 两次落进非预期输入框（新建草稿标题/草稿标签），靠截图逐步纠偏，最终状态干净（草稿已清空，未产生垃圾数据）。教训：无障碍树不可用时，长命令链中间必须插截图核对焦点。
5. **MuMu 点击偶发吞 tap**：首页标题两次点击未导航（logcat 无 JS 错误），deep link `life://item/<id>` 与随后重试均正常——判定为模拟器输入注入抖动，非代码缺陷，未改代码。

## 五、遗留披露与给阶段 4 的建议

1. 展示样式当前停在「仅表情」（验收 7 的演示状态）；设置页两键即回「纯文字」，无持久化问题（`app_settings` 单行）。
2. `observeTags` 对行内字段更新的发射问题只在「已挂载页面」观察到；首页标签 Chip 的视觉更新同样依赖列表页重新聚焦/重新进入才可见（本阶段以显式刷新修复了设置页，首页未加——首页以增删标签为主，颜色变化场景低频，如阶段 4 议程视图在意可同模式处理）。
3. 分类/标签管理页均无删除入口（预置分类不可删是任务卡明文；标签删除留待后续切片）。
4. `visualOptions` 的 10 色/28 Emoji 上限由单测锁定（超上限会挂），调整预设色需同步改测试。
5. 本阶段无 schema 变更；`npx expo-doctor` 与切片收尾（closeout、合并 main）按任务卡节奏留待切片完成统一执行。

## 附：阶段 3 修改文件清单

- **新增实现**：`src/ui/visualOptions.ts`、`src/ui/ColorPalette.tsx`、`src/ui/EmojiPicker.tsx`、`src/ui/VisualEditor.tsx`、`src/ui/useTagDisplayMode.ts`、`src/app/settings/categories.tsx`、`src/app/settings/tags.tsx`
- **修改实现**：`src/app/settings.tsx`、`src/app/_layout.tsx`、`src/domain/category.ts`、`src/app/item/[id]/edit.tsx`、`src/app/item/[id].tsx`、`src/app/index.tsx`、`src/app/archived.tsx`、`src/data/ItemRepository.ts`、`src/data/WatermelonItemRepository.ts`
- **新增/扩展测试**：`src/ui/__tests__/visualOptions.test.ts`（8 例）、`src/data/__tests__/categorySettings.test.ts`（追加 4 例）、`src/notifications/__tests__/ReminderScheduler.test.ts`（FakeRepository 补 `listTags` stub）

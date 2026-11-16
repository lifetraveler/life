# 切片 24：夜间模式与视觉体验清理

## 目标
1. 引入全局颜色 Token，支持系统级深色/浅色模式无缝切换。
2. 覆盖核心页面（4 个 Tab、详情、新建、闪电录入、设置页）。
3. 修复切片 23 遗留的小 bug（卡片日期重复、AI 标签污染）。

## 强制实施阶段

### 阶段 1：Theme 基础设施与底层修复
- 新建 `src/ui/theme.ts`，定义基础 Token：
  ```typescript
  export const Colors = {
    light: { background: '#F5F0E6', card: '#FFFFFF', text: '#3D3A34', textMuted: '#8A8377', primary: '#4C7A5C', border: '#E0E0E0', danger: '#D32F2F' },
    dark: { background: '#201D18', card: '#2D2924', text: '#E8E2D6', textMuted: '#9C948A', primary: '#5D9471', border: '#423E38', danger: '#F87171' }
  };
  ```
- 封装一个 `useTheme()` hook（基于 `useColorScheme()`）。
- **逻辑 Bug 修复**：
  - 修复 `FlashPreviewCard.tsx` 时间行的日期重复问题。
  - 修复 AI `merge.ts` 或 `chat.ts`：如果是全新意图（非“改成”等编辑词），不应继承上一轮的 tags。

### 阶段 2：全局 UI 覆盖与 Token 替换
- 遍历 `src/app/` 和 `src/ui/` 下的所有文件（特别是 `_layout.tsx`、`(tabs)/` 结构、各个详情/编辑页、Chat 气泡）。
- 将写死的颜色替换为 `const { colors } = useTheme();` 并应用到样式。
- 修改 `StatusBar`，使其在深色模式下背景变暗、文字变白。

### 阶段 3：真机验证
- 使用 `adb shell cmd uimode night yes` 和 `no` 切换系统深色模式。
- 跑通 `tsc` 和 `jest`，确保未破坏现有 UI 逻辑。

## 验收标准
1. tsc 零错误；jest 全过。
2. 无硬编码的 CSS 颜色（除 Theme 定义外）。
3. 真机：系统切换到深色模式，App 内所有页面（Tab、列表、表单、闪电卡片、底部弹窗）自动变为深色，文字清晰可读。
4. 真机：系统切回浅色模式，App 恢复正常。
5. 真机：新建一条日程并触发闪电录入，确认卡片上的时间不再重复显示“2026-11-16 2026-11-16”，且未带入上一条的标签。

## 分支与提交
- 从最新 main 新建 `task/slice-24`，分阶段提交。


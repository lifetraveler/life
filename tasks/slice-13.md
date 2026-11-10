# 切片 13：鸿蒙可行性评估

## 目标
评估当前项目迁移/适配 HarmonyOS NEXT 的可行性、成本与风险，产出一份明确的决策报告。

## 允许修改的范围
- 新增 docs/proposals/harmony-assessment.md

## 禁止修改
- 所有源码（src/、android/、ios/）、package.json、app.json 均零改动。

## 评估要求
报告必须包含：
1. 当前依赖矩阵（Expo SDK 54、WatermelonDB、expo-notifications、expo-calendar、react-native-android-widget 等）与鸿蒙原生生态（ArkTS / React Native for OpenHarmony）的对应关系。
2. 社区工具链成熟度：@oh-expo/expo-harmony、expo-harmony-toolkit 等方案目前支持的 SDK 版本（多为 55+，我们是 54）。
3. 核心难点：WatermelonDB 的 SQLite 底层依赖在鸿蒙上的替代方案；react-native-android-widget 在鸿蒙的卡片替代方案。
4. 给建议：是等待社区工具链兼容 SDK 54，还是升级 SDK 再转，还是用 ArkTS 重写原生壳只保留数据同步。

## 验收标准
1. 报告存在且内容详实，引用社区工具链版本为证。
2. `git status` 只显示新增了该 md 文件。
# 切片 13 收尾移交（closeout）

- 切片：task/slice-13（鸿蒙可行性评估，纯文档）
- 完成日期：2026-11-07
- 产出：docs/proposals/harmony-assessment.md

## 环境事实

- 分支 task/slice-13（基于 main@107c1d0，切片 12 合并后）。
- 本切片零源码改动：未修改 src/、android/、ios/、package.json、app.json（验收标准 2）。
- 工作区预存在改动（非本切片产生，一并入提交）：AGENTS.md v0.13（§7.20 新增 + §8 指向 tasks/slice-13.md，上次会话预备）；tasks/slice-13.md（任务卡，未跟踪新文件）。
- 工作区无关杂物（未动、未入提交）：.tmp-session-log/、modules/widget-snapshot-store/android/.gradle/。
- Node/依赖环境未变更；未新增任何 npm 依赖。

## 数据库/构建事实

- 数据库零改动：schema 版本不变，无新表，无迁移。
- 构建配置零改动；未运行真机验收（本切片无功能面）。
- 验证命令（§6 例行）：`npx tsc --noEmit` 通过；`npx expo-doctor` 通过（结果见切片提交说明）。

## 代码地图（本切片涉及的文件）

| 文件 | 变更 | 说明 |
| --- | --- | --- |
| docs/proposals/harmony-assessment.md | 新增 | 评估报告：依赖矩阵×鸿蒙生态、工具链成熟度、WatermelonDB/widget 难点、三路线判定（A 不可行 / B 唯一渐进路径 6–10 周 / C 成本最高）、重评触发条件 |
| tasks/slice-13.md | 新增（预存在未跟踪） | 任务卡 |
| AGENTS.md | 预存在未提交改动（v0.13） | §7.20 + §8 |
| tasks/slice-13-closeout.md | 新增 | 本文件 |

## 踩坑教训

1. gitcode/atomgit 网页版是 SPA，直接 web_fetch 只能取到外壳；gitee.com/openharmony-sig/ohos_react_native 已 404（项目迁移）。有效的取证路径是 GitHub 镜像 raw（raw.githubusercontent.com/AuroraMaster/react-native-ohos-library/…），en/ 与 zh-cn/ 目录成对。
2. 鸿蒙适配包不走 npm autolink：WatermelonDB 鸿蒙适配经 HAR 包 + CMakeLists 接入，expo plugin / autolink 体系不适用——未来真做迁移时，lockfile 与依赖管理习惯要重新设计。
3. RNOH 版本线是 0.72/0.77/0.82/0.84，恰好没有 0.81：本项目的 RN 0.81.5 是「两头不靠」的版本，任何鸿蒙路线都必须先动 RN 版本，不存在原地接入的可能。

## 遗留披露

1. 纯桌面调研：未在鸿蒙真机运行 RNOH、未编译 harmony 工程、未实测任何适配包；报告中「可用/部分支持」判断均引用社区文档与验收环境描述（附录 A 有链接与观测日期 2026-11-07）。
2. WatermelonDB 鸿蒙适配的 issue#2（内部接口部分不支持）影响面未验证，已写入报告 §8 作为 PoC 阶段第一验证项。
3. 报告建议「现阶段不投入」，并给出三个重新评估触发条件（工具链矩阵覆盖三件套 / WatermelonDB 适配进 0.82+ 线 / 下载量级或第二维护方）；是否投入由用户决策，无后续切片自动生成。
4. SDK 55 升级（路线 B 第 1 步）对 Android 现有功能为中风险常规操作，与鸿蒙决策解耦，可作为独立候选切片，本报告未将其列为任务。

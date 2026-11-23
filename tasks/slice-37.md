# 切片 37：Spark 灵感火花（事项 Tab 改造：灵感 capture + 附件上云 + 灵感↔计划关联）

> 基点：main @ edc55fb（切片 36 合并 + 反馈登记 + backlog 立项登记后）
> 分支：`task/slice-37`（从 main @ edc55fb 切出，§7.8）
> 提案：`docs/proposals/slice-37-spark-inspiration.md`（用户 2026-11-23 五问定案：Tab 页内速记条+流式列表 / 仅存录音+回放 / 手动转化为主 / 允许 expo-audio + expo-image-picker / v1 附件上云）
> 交付纪律：本卡与提案、AGENTS v0.43 随本切片阶段 1 提交（§7.9；不单独提交）。

## 0. 明确不做（禁改清单）

- **冻结区实现文件为空**：`src/notifications/`、`src/domain/recurrence/`、`src/domain/export.ts` 零改动（测试夹具 stub 属编译必需不属实现改动，§7.13）。
- 不触碰 `AiParser.parse` 冻结签名 / `RemoteDraftWire` / `ChatMessage kind` / `AI_SYSTEM_PROMPT`；Spark 不进 AI 查询检索域（retrieval.ts 零改动）。
- Spark 不进双向同步 sync 快照（仅数据备份恢复）；不进 ICS 导出/小组件快照/切片 12 导出。
- 不做 AI 转写、AI 拆解草稿、灵感归档、计划侧反查展示、灵感搜索/FTS、照片编辑压缩、录音波形裁剪。
- 不加 WorkManager/AlarmManager/前台服务（变更 B 不并入）。
- app_settings 零迁移；无新设置开关。
- 新依赖仅两个：expo-audio + expo-image-picker（§7.3 用户 2026-11-23 明确允许）；不得删除既有受保护构建配置（§5）。

## 1. 设计决策摘要（D1–D8，细则见提案 §4）

- **D1** 路由改造：`items.tsx`（45 行占位，L1）删除→新建 `sparks.tsx`；`_layout.tsx` Tab name/title「事项」→「灵感」、图标 checkbox→bulb；详情页新建 `spark/[id].tsx`（根 Stack）。
- **D2** schema v19 三新表：`sparks`（title?/content? 双可空/created_at/updated_at）、`spark_attachments`（spark_id isIndexed/kind/uri/remote_path?/sha256?/file_size/duration_ms?/width?/height?/created_at）、`spark_items`（spark_id/item_id isIndexed/created_at）；migrations toVersion 19 三条 createTable。
- **D3** SparkRepository 端口+实现（新文件对）：CRUD/级联删除（记录+本地文件+远端）/listSparks 倒序/附件/link 接口；item_id 存在性校验；repository.md 注记节。
- **D4** 附件存储与上云：本地 `documentDirectory/sparks/<uuid>.<ext>`；远端 `<basePath>/life-attachments/<sha256前16>-<名>`；即时上传（录入后立即 PUT，60s 专用超时，失败「未备份」徽标+详情页重传）；删除联动远端 DELETE（失败仅披露）；上限每灵感 20 附件/单文件 25MB。
- **D5** 数据快照扩展：kind:'data' version 1 不变+可选三块（sparks/sparkAttachments/sparkItems，缺块跳过=双向兼容，旧 App 忽略未知键）；恢复同构（_raw.id 保真/悬挂 skipped）；附件文件下载在事务外逐个执行（失败披露可后补）。
- **D6** capture UI：速记条（TextInput 自增+录音/拍照/相册三按钮）+灵感流 FlatList 卡片（摘要/附件徽标/关联计划数/相对时间）；录音点按开始停止无预览确认；权限拒绝态引导。
- **D7** 详情页与转计划：标题内容失焦保存+附件列表（录音播放/图片预览/删除/重传）+关联计划列表（跳转/解除）+「转计划」→ `/item/new?fromSpark=&title=&content=` 预填（item/new 现无 query 处理，grep 证实）→保存后 linkSparkToItem（失败披露不回滚）。
- **D8** 边界披露：附件未备份态/远端孤儿文件/离线恢复仅元数据可后补/新依赖 dev client 重建。

## 2. 三阶段

### 阶段 1：域 + 数据层 + 契约文档
1. schema v19：三新表（tableSchema+注释）+ SparkModel/SparkAttachmentModel/SparkItemModel + migrations toVersion 19 + 单测 migrationsV19。
2. SparkRepository 端口 + WatermelonSparkRepository 实现 + 级联删除 + 单测（CRUD/级联/link 校验）。
3. WebdavClient 附件三方法（60s 超时参数化）+ 单测（内存 WebDAV 先例）。
4. dataSnapshot.ts 三可选块（守卫/组包/恢复）+ 单测（缺块跳过/旧 App 忽略未知键双向兼容/附件下载 skipped）。
5. `docs/contracts/repository.md` 注记节（SparkRepository 新端口）；AGENTS v0.43（§7.49 + §8）；**提案+本卡随阶段 1 提交**。

### 阶段 2：UI
1. `_layout.tsx` Tab 改造（D1）；`sparks.tsx` 灵感页（速记条+流列表+录音/拍照/相册流程，D6）；`spark/[id].tsx` 详情页（D7）。
2. `item/new.tsx` query 预填 + 保存链 link（D7）。
3. 组件测试 + useFlashChat 零改动确认。

### 阶段 3：真机验收 + 收尾
1. 真机矩阵（§3）+ closeout + backlog 划项（Spark 候选行/L1 行关闭注记）+ AGENTS §8 刷新。
2. APK 出包 bump 0.37.0/versionCode 37（§5 版本号策略）。

## 3. 真机验收矩阵（12 条）

1. 文字灵感速存：输入→发送→列表首行出现（相对时间正确）。
2. 录音灵感全链：录音→停止→列表附件徽标→详情页回放→「已备份」徽标（远端 PUT 成功）。
3. 拍照灵感：launchCameraAsync→图片附件→缩略图列表→上云。
4. 相册灵感：launchImageLibraryAsync 同链路。
5. 灵感编辑：详情页改 title/content→失焦保存→列表刷新。
6. 附件删除：删除后本地文件+记录+远端 DELETE 三清（远端核对文件消失或披露孤儿）。
7. 转计划全链：详情页「转计划」→item/new 预填 title/content→保存→返回灵感→关联计划列表出现新计划→点击跳 item/[id]。
8. 解除关联：关联计划行解除→列表消失。
9. 数据备份含 Spark：立即备份→服务器快照 JSON 含 sparks/sparkAttachments/sparkItems 三块。
10. 恢复含附件下载：卸载重装（0.37.0）→恢复数据快照→灵感记录恢复→附件文件自动下载→录音可回放图片可预览。
11. 旧格式快照回归：恢复切片 31 时代 v1 快照（无 Spark 块）→六块正常恢复+Spark 块跳过无异常。
12. Tab 改名与深浅色：「灵感」tab bulb 图标；灵感页/详情页深浅色两态；附件权限拒绝态引导。

## 4. 验收命令

- `npx tsc --noEmit`（0 错）
- `npx jest --runInBand`（基线 **110 套件/1619 用例** 只增不减）
- `npx expo-doctor`（2 项预存基线无新增）
- Android 真机：dev client 重建安装（新依赖 plugins）；MuMu/猴王按矩阵执行；APK 0.37.0/v37。

## 5. 风险与注意

- 新依赖 dev client 重建失败：按官方最小 plugins 配置（expo-audio 麦克风权限/expo-image-picker 相机相册权限）；构建失败输出日志+最小变更提案（§5）。
- 录音文件大：60s 专用超时+25MB 上限；MuMu 模拟器录音注意（麦克风宿主透传）。
- 恢复附件下载对大快照耗时：逐个下载+计数披露（不阻塞事务）。
- 路由改名回归：Tab 切换/桌面 deep link `life://` 回归项在矩阵 12。
- 真机操作沿用切片 36 教训（T4 每步 dump 验证/T5 焦点持有吞 tap/adb input text 空格截断）。

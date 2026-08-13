# Changelog

## v1.9.0 (2026-08-14) — Backup & Recovery

### P0：完整 Backup & Recovery

- SQLite Online Backup API（better-sqlite3 `db.backup`）生成一致 DB 快照，WAL 事务不丢失；
- 完整备份 = DB + config + pet-tasks + encryption.json + images（full/thumb/annotated）+ 隐私最小化 manifest；
- 快照枚举 + 全有或全无：引用文件缺失则整轮失败并自动重试一次，绝不静默跳过；
- staging + 原子 rename；成功 = DB 快照 + 资产复制 + manifest 生成 + 复验 + rename 全部通过；
- 保留策略：启动 DB-only 快照保持 5 份；完整备份默认 3 份（可配置 1–10），新备份成功后才清理旧备份；
- 恢复管线：验证 → 自动回滚点 → 关闭数据层 → staging → 再验证 → 原子替换 → 重启 → 启动完整性检查 → 失败自动回滚；
- 修复 Windows 恢复 P0：应用自身运行中无法重命名 userData（子进程占用）→ 恢复采用“辅助进程原子交换”，实机验证通过；
- 版本兼容：v1.5–v1.8 旧备份允许恢复，恢复后走现有幂等 migration；更高版本拒绝；
- 加密原样备份（含 encryption.json），manifest 不含正文/OCR/实体值。

### P1：Asset Integrity（只读巡检）

- 输出 MISSING_FILE / ORPHAN_FILE / MISSING_ANNOTATED / ORPHAN_ANNOTATED / HASH_MISMATCH；
- 只报告，不自动删除/修复/移动；设置面板可手动触发。

### P1：破坏性操作最小加固

- 所有图片 unlink 失败记录日志（路径/itemId/类型），不再静默；
- retention / 清理支持 dry-run（数量/图片/标注/释放空间，不执行）；
- 批量删除确认文案包含记录数与图片数。

### Sandbox

- `CLIPBOARD_SHELF_USER_DATA` 仅在测试模式生效，生产模式忽略并告警；
- 标准化 `scripts/acceptance-runner.cjs`（prepare / launch / clean + fingerprint）。

### 已知限制

- 图片删除仍为永久 unlink（回收站化待后续版本）；
- 完整备份为全量复制（增量/去重待 v1.9.x）；
- 备份目录本身不加密（与生产 userData 同权限假设）；
- 恢复必须关闭应用并自动重启。
- 500 张真实照片最大规模性能尚未单独实测（基准：100 张 ≈ 0.6–0.8s、500 张小文件 ≈ 2.1s；210 张真实混合图 ≈ 3.4s）；
- Restore 后备份列表按照恢复快照语义变化（恢复内容即所选快照），恢复前环境保存在回滚点中；
- 未实现增量备份、云备份、回收站。
- 其他既有 v1.8 限制不变（图片不进入内置备份、Entity Chip 非实时、型号精确匹配、轮询 ≤1s、孤立品牌裸词不识别等）。

---

## v1.8.0 (2026-08-14) — 图片维修标注（Image Annotation）

### 核心能力

- 维修现场图片标注：矩形 / 箭头 / 文字 / 涂鸦 / 马赛克。
- 原生 HTML Canvas 2D 编辑器（无第三方依赖），支持撤销 / 重做 / 缩放 / 平移。
- 标注数据模型：`annotations` 表（元素级，数据权威）+ `items.annotatedPath`（合成 PNG 展示缓存）。
- 坐标一律使用原图像素坐标，与显示缩放无关；导出与编辑所见一致。
- 修复 P1：pen 涂鸦保存后重新进入编辑器可重放可见（`applyElement` 补齐 pen/path 分支，坐标沿用保存的原图像素坐标，与 rect/arrow/text 一致）。
- 马赛克为特殊元素：添加后即烧录、不可删除、不可撤销到其之前；编辑过程中即遮挡原图；后续编辑以已烧录合成图为底，不重新暴露原图。
- 原图保护：full PNG 永远只读；图片预览不再引导外部编辑器修改原图（openInEditor 对图片禁用，改为「标注」入口）。
- 图片预览双视图：有标注默认显示标注图，可切换「查看原图」；明确区分“原图 = 现场原始证据 / 标注图 = 维修人员说明”。
- Worksite 自动继承：现场视图内图片标注照常显示/预览/再编辑/输出，不改变 Worksite 数据模型。
- 隐私硬门禁：`annotations:save` 在主进程 IPC 层拒绝 metadataOnly / sensitivity≠0 / 加密锁定态。
- `shelf-file://annotated/` 沿用子目录白名单 + 路径越界校验，仅放行合法标注文件。
- 删除 / 批量删除 / clearNonFavorites / cleanByPolicy / retention 全部联动清理 annotations 行与标注 PNG；Worksite 保护语义不变。
- 运行时验收沙箱隔离：`CLIPBOARD_SHELF_TEST_ROOT` 统一派生 DB/config/images/logs/backups/pet-tasks 全部资产路径 + 启动前硬校验（越界即 abort）+ fingerprint 快照；仅影响验收实例，生产逻辑不变。

### 技术说明

- migration v4：`items.annotatedPath`（可空）+ `annotations` 表 + 索引；纯增量、幂等、可回滚。
- 无新第三方依赖；不修改 clipboard-pipeline / capture-policy / encryption 核心 / ocr / collection-output / Worksite 数据模型。
- 备份边界保持现状：annotations 元数据随 shelf.db 备份；标注 PNG 暂不进入备份（已知限制）。

### 测试

- 新增 migration / geometry / undo-redo / mosaic / DB 联动 / 隐私门禁 / 协议解析测试。

### 已知限制

- 图片文件（full/thumb/annotated）目前不进入现有数据库 backup 机制。
- 图片文件本身不加密（现状一致）；标注元素 JSON 加密存储。
- 马赛克不可逆语义以烧录 + flatten 规则保证，不阻止系统级恢复工具（合理边界）。
- 新复制记录的 Entity Chip 可能需要下一次列表刷新/搜索后显示（不实时推送）。
- 型号暂仅精确匹配，不支持前缀匹配。
- 轮询架构仍存在约 ≤1s 的检测窗口。
- 孤立品牌裸词（如单独“大金”）默认不识别（保守规则）。

---

## v1.7.0 (2026-08-11) — Worksite（工作现场）

### 核心能力

- 现场（Worksite）：把一次维修任务的多段剪贴板记录归入一个命名集合。
- 过滤栏新增「现场」：现场列表（标题/备注/记录数/最后记录时间/归档标记）+ 新建/重命名/归档/删除。
- 多选批量栏新增「加入现场」：选择已有现场或创建后立即关联选中记录；现场视图内可「移出现场」。
- 现场视图完全复用现有 ItemList / 实体 Chip / 多选 / 搜索 / 复制全部 / Markdown / 导出 / 工单草稿，不重新实现。
- 现场内搜索/实体过滤/类型/收藏与 worksiteId 全部 AND 组合，不越出现场边界。
- 删除现场只解除记录关联，不删除剪贴板记录；归档不解除关联、不取消 retention 保护，归档现场仍可查看/搜索/输出。
- 任何加入/移出记录都会更新现场 updateTime。
- retention 保护：现场内记录等同收藏，`cleanByPolicy` / `clearNonFavorites` 不自动清理；移出现场后恢复正常清理。
- 数据库 migration v3：`worksites` 表 + `items.worksiteId`（可空）+ 索引；幂等、旧数据无损、空库直达 v3。
- 修复 P2：中文关键词搜索时实体 Chip 不显示（LIKE 路径补挂实体）。
- 隐私：现场标题/备注与便签同语义（启用加密时加密存储）；sensitivity=2 / metadataOnly 输出门禁不变。

### 技术说明

- 无新第三方依赖；IPC 新增 5 个（worksites:list/create/update/delete + items:setWorksite）。
- `getAll` 新增可选 `worksiteId`，默认行为完全不变。
- 测试：167/167 通过（新增 migration v3 / worksite CRUD / 批量分块 / retention 保护 / 隐私 / 加密测试）。

### 已知限制

- v1.7.0 为单归属：一条记录同一时间只属于一个现场（多归属留后续）。
- 现场不自动识别/拆分“哪个现场属于哪次任务”，由用户主动归并。

---

## v1.6.1 (2026-08-11) — Collection & Output

### 核心能力

- 多选记录一键输出：**复制全部 / Markdown / 导出 Markdown / 工单草稿**（复用现有多选与批量操作栏）。
- 输出顺序 = 用户点选顺序（`selectedIds` Set 插入顺序），不重新按时间排序。
- 纯文本：原始内容 + 空行分隔，不做 AI 改写。
- Markdown：`# 维修记录` + 原始内容，保持顺序。
- 工单草稿：**本地确定性整理（非 AI）**——设备信息来自已识别实体、故障现象/检测记录按内容关键词归类、处理过程留空、图片进备注；不编造诊断与结论。
- 图片输出：有 OCR 输出 OCR 文本，无 OCR 输出 `[图片: 文件名]`；**绝不输出本地路径**。
- 隐私沿用现有语义：sensitivity=0/1 可输出，sensitivity=2 / metadataOnly / 无内容不输出；缺失记录安全跳过并提示。
- 导出 Markdown：系统保存对话框 + 写入 + 自动打开所在文件夹。
- 性能：选择只存 ID，输出时按 ID 批量读取（分块 IN ≤500），无 N+1。

### 已知限制

- 工单草稿按关键词/实体归类，不做语义判断；处理过程栏目留空。
- 导出后自动打开所在文件夹（不额外弹窗）。

---

## v1.6.0 (2026-08-11) — Entity Visibility & Search

### 核心能力

- Entity Chip 可视化：列表行展示 品牌 / 型号 / 故障码 / 制冷剂（最多 4 个，URL 不显示，敏感/仅元数据记录不显示）。
- 实体过滤：`品牌:大金` / `型号:RXYQ16AYM` / `故障:U4` / `制冷剂:R410A`（支持中英文前缀）。
- 多条件 AND 过滤：`品牌:大金 故障:U4` 仅返回同时满足的记录。
- 点击 Chip 即过滤：点击实体徽标自动进入对应过滤条件。
- 型号历史：`型号:RXYQ16AYM` 返回该型号全部历史，按 `createTime DESC` 倒序。
- Entity 查询与识别共用同一套规则（品牌别名反解、型号/故障码/制冷剂归一化）。
- 修复增量列表 `slice(0,200)` 截断问题：新增记录不再把可见列表收敛到 200 条。
- 性能：`withEntities` 200/1000/5000 行 = 2/13/71ms；实体过滤走 `(type,value)` 索引。

### 已知限制（known limitations）

- 新复制记录的 Entity Chip 可能需要下一次列表刷新/搜索后显示（不实时推送）。
- 孤立品牌裸词（如单独“大金”）默认不识别（保守规则）。
- 型号暂仅精确匹配，不支持前缀匹配。
- URL 不显示 Chip。
- 轮询架构仍存在约 ≤1s 的检测窗口。

---

## v1.5.0 (2026-08-10) — Local Entity Recognition

### 新增

- 本地实体识别（零第三方依赖，纯规则引擎）：
  - 持久化实体：`brand` / `model` / `fault_code` / `refrigerant` / `url`；
  - 仅内存识别（不落库）：`phone` / `email`；
  - `work_order` / `equipment_code` 本版本不实现。
- HVAC 规则：7 大品牌词典（大金/格力/美的/日立/三菱/松下/富士通将军）+ 品牌锚定型号正则 + 故障码上下文约束（A1/B1/01/E 等短串不误报）+ 制冷剂关键词 + URL。
- 异步识别链路：`Clipboard → Pipeline → DB_INSERT → ENTITY_JOB → Entity Recognition → ENTITY_DONE`，不进入 clipboard pipeline worker，复制主链路零影响。
- 隐私门禁：`sensitivity=0 && metadataOnly=0 && content 非空` 才分析；加密锁定态不分析；phone/email 不持久化。
- 数据库 migration v2：新增 `entities` 表 + `items.entityState`；历史数据不自动补扫（只分析新复制内容）。
- 删除联动：`remove` / `clearNonFavorites` / `cleanByPolicy` 同步清理实体。
- 性能：实体识别 P95 = 1ms（10KB 长文本截断分析）。

### 变更

- retention 默认 `maxItems`：2000 → 5000（避免既有数据量接近 2000 时启动被自动清理；`enabled=true`、`maxDays=0` 不变）。

### 已知限制

- 实体识别为保守本地规则，不覆盖全部型号/品牌，宁可不识别也不误报；
- 轮询架构仍存在最多约 1s 的检测窗口（既有限制）；
- 本版本**不包含** Document Index / Context Matching / Toast 联想 / AI（分别属于 v1.5.1 / v1.5.2 及后续）。

---

## v1.4.1 (2026-08-10) — Source Accuracy Fix

### 变更

- 新增常驻 PowerShell source service（零第三方依赖）：
  - `Add-Type` / Win32 API 仅初始化一次，之后查询走 stdin/stdout 行协议；
  - 单飞 FIFO 队列 + 响应 id 匹配，杜绝并发捕获与请求/响应错配；
  - 每个剪贴板 item 拥有独立的检测时刻来源快照，禁止旧快照跨 item 复用。
- 来源快照在 poll 检测点采集并随 item 入队；worker 只消费快照，不再获取前台窗口。
- Clipboard Shelf 自身窗口前台时，`sourceApp/sourceProcess` 返回 null（不再记录为 electron）。
- service 故障处理：启动失败 / 异常退出 / stdout EOF / 请求超时 / 响应格式错误 / 子进程卡死
  → source = null，剪贴板记录流程继续；必要时自动重启，不阻塞主管线。
- 性能：cold start 约 1s；warm query P50 = 9ms，稳态 P95 = 9ms（首查约 110–120ms）。
- 测试：76/76 通过（含真实 PowerShell 进程启动测试）。

### 已知限制

> 轮询架构仍存在最多约 1s 的检测窗口，极短时间内切换应用可能导致 source 不准确。

---

## v1.4.0 (2026-08-09) — 来源 / 敏感 / 清理 / 粘贴

### 新增

- 来源应用：`sourceApp` / `sourceProcess` / `capturedAt`（前台窗口应用与进程；不记录窗口标题）。
- 捕获策略：忽略来源应用、仅元数据应用（capture policy 在落库前判断）。
- 敏感度三级：
  - 🟢 普通：正常保存；
  - 🟡 敏感：保存但列表预览默认打码；
  - 🔴 高敏感：只保留元数据，内容不落库。
- 自动清理（retention）：maxItems（默认 2000）、maxDays、图片独立上限；收藏永不自动删除；可关闭；启动 + 每日定时。
- 粘贴：数字键 1–9 选择；Enter 复制并下移（顺序粘贴，可在设置关闭）；Ctrl+Shift+V 纯文本（写入纯文本，用户自行 Ctrl+V）。
- 数据库 migration 框架（`PRAGMA user_version`，当前 v1）。
- 设置页：忽略应用 / 仅元数据应用列表、retention 配置、顺序粘贴开关、敏感徽标与来源显示。

### 测试

- v1.4.0 基线：58/58 通过。

### 已知限制

- 高敏感记录仅存元数据，不可复制/编辑（按设计）。
- 敏感度基于正则粗匹配，可能误报，可在设置中关闭敏感保护。
- SendInput 自动粘贴未启用；HTML 富文本未捕获（后续版本独立评估）。

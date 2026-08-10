# Changelog

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

# Changelog

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

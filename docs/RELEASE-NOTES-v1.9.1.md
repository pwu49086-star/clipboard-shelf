# Clipboard Shelf v1.9.1 — Known Missing Image Assets

## 概述

v1.9.1 引入了图片资产完整性管理功能，用于检测和管理剪贴板历史中缺失的图片文件。

## 新功能

### Asset State 管理

- 新增 `assetState` 字段：`ok` / `missing`
- 新增 `assetMissingAt`：记录确认永久缺失的时间
- 新增 `assetMissingNote`：记录缺失原因备注

### Asset Integrity 检测

- 自动检测 `assetState=ok` 但文件不存在的情况（UNEXPECTED_MISSING）
- 区分三种状态：
  - **UNEXPECTED_MISSING**: 文件缺失但未确认
  - **PERMANENT_MISSING**: 已确认永久缺失
  - **RECOVERED**: 已确认缺失但文件重新出现

### 确认/撤销机制

- **确认永久缺失**: 将 `assetState` 从 `ok` 改为 `missing`
- **撤销确认**: 将 `assetState` 从 `missing` 改回 `ok`
- 所有操作记录审计日志

### 备份语义增强

- **Complete 备份**: 所有图片文件存在
- **Incomplete 备份**: 存在已确认的缺失（consistent）
- **Failed 备份**: 存在未确认的缺失（unexpected）

### 审计日志

- 记录所有 confirm/revoke 操作
- 包含: itemId, oldState, newState, action, timestamp, note
- 不包含敏感数据（OCR、内容、实体）

## Migration v5

- 自动迁移，添加 `assetState`/`assetMissingAt`/`assetMissingNote` 列
- 添加 `entities`、`worksites`、`annotations` 表
- 现有数据默认 `assetState='ok'`

## 测试覆盖

- 252 项单元测试全部通过
- Asset Integrity 性能: 200 行 5ms, 1000 行 6ms, 5000 行 9ms
- Confirm/Revoke 事务: < 5ms

## 已知限制

- 不自动删除缺失图片的记录
- 不自动将缺失标记为 `missing`（需用户显式确认）
- RECOVERED 状态不自动恢复为 `ok`（需用户显式操作）

## 后续计划

- 用户可通过设置界面批量确认缺失图片
- 备份时自动区分 known/unknown missing
- 支持从备份恢复时保留 missing 状态

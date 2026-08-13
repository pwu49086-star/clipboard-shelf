/**
 * 图片标注隐私硬门禁（纯函数，主进程 IPC 与测试共用）。
 */
function canAnnotate(item, encryptionState) {
  if (!item || item.type !== 'image') return { ok: false, error: '不是图片记录' }
  if (item.metadataOnly === 1) return { ok: false, error: '仅元数据记录不可标注' }
  if (Number(item.sensitivity || 0) !== 0) return { ok: false, error: '敏感记录不可标注' }
  if (encryptionState && typeof encryptionState.isEnabled === 'function' &&
      encryptionState.isEnabled() && !encryptionState.isUnlocked()) {
    return { ok: false, error: '加密锁定态不可标注' }
  }
  return { ok: true }
}

module.exports = { canAnnotate }

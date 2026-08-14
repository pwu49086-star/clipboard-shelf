/**
 * Asset Integrity（v1.9.0）— 只读巡检
 *
 * 只报告，绝不自动删除/修复/移动。
 */
const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')
const manifest = require('../../shared/backup-manifest.cjs')

function scan({ userData, baseline = null }) {
  const imagesRoot = path.join(userData, 'images')
  const out = {
    dbUnreadable: false,
    summary: {
      imageRows: 0,
      fullExisting: 0,
      fullMissing: 0,
      thumbExisting: 0,
      thumbMissing: 0,
      annotatedExisting: 0,
      annotatedMissing: 0,
      unexpectedMissing: 0,
      permanentMissing: 0,
      recovered: 0,
      orphanFull: 0,
      orphanThumb: 0,
      orphanAnnotated: 0,
      hashMismatch: 0
    },
    lists: {
      missingFiles: [],
      permanentMissing: [],
      recovered: [],
      orphanFiles: [],
      missingAnnotated: [],
      orphanAnnotated: [],
      hashMismatch: []
    }
  }

  let db
  try {
    db = new Database(path.join(userData, 'shelf.db'), { readonly: true })
  } catch (e) {
    out.dbUnreadable = true
    return out
  }

  let rows = []
  try {
    rows = db.prepare(
      "SELECT id, type, filePath, thumbPath, annotatedPath, assetState FROM items WHERE filePath IS NOT NULL OR thumbPath IS NOT NULL OR annotatedPath IS NOT NULL"
    ).all()
  } catch (e) {
    out.dbUnreadable = true
    try { db.close() } catch {}
    return out
  }
  try { db.close() } catch {}

  out.summary.imageRows = rows.length
  const referenced = { full: new Set(), thumb: new Set(), annotated: new Set() }

  for (const r of rows) {
    const state = r.assetState === 'missing' ? 'missing' : 'ok'
    const targets = [
      ['full', r.filePath, 'missingFiles'],
      ['thumb', r.thumbPath, 'missingFiles'],
      ['annotated', r.annotatedPath, 'missingAnnotated']
    ]
    for (const [kind, p, listKey] of targets) {
      if (!p) continue
      const base = path.basename(p)
      referenced[kind].add(base)
      const exists = fs.existsSync(p)
      if (kind === 'full') { if (exists) out.summary.fullExisting++; else out.summary.fullMissing++ }
      if (kind === 'thumb') { if (exists) out.summary.thumbExisting++; else out.summary.thumbMissing++ }
      if (kind === 'annotated') { if (exists) out.summary.annotatedExisting++; else out.summary.annotatedMissing++ }
      if (exists && state === 'missing') {
        out.lists.recovered.push({ itemId: r.id, type: r.type, kind, path: p })
        out.summary.recovered++
      } else if (!exists && state === 'missing') {
        out.lists.permanentMissing.push({ itemId: r.id, type: r.type, kind, path: p, note: r.assetMissingNote || '' })
        out.summary.permanentMissing++
      } else if (!exists) {
        out.lists[listKey].push({ itemId: r.id, type: r.type, kind, path: p })
        out.summary.unexpectedMissing++
      }
    }
  }

  // 孤儿文件：磁盘存在但无引用
  for (const kind of ['full', 'thumb', 'annotated']) {
    const dir = path.join(imagesRoot, kind)
    let files = []
    try { files = fs.readdirSync(dir) } catch {}
    for (const f of files) {
      if (referenced[kind].has(f)) continue
      out.lists.orphanFiles.push({ kind, file: f, path: path.join(dir, f) })
      if (kind === 'annotated') out.lists.orphanAnnotated.push({ file: f })
      if (kind === 'full') out.summary.orphanFull++
      if (kind === 'thumb') out.summary.orphanThumb++
      if (kind === 'annotated') out.summary.orphanAnnotated++
    }
  }

  // hash 比对：仅当提供基线 manifest（备份目录）
  if (baseline) {
    const m = manifest.readManifest(baseline)
    if (m) {
      for (const im of m.images || []) {
        const p = path.join(userData, 'images', im.path)
        if (fs.existsSync(p) && manifest.sha256File(p) !== im.sha256) {
          out.lists.hashMismatch.push({ itemId: im.itemId, path: im.path })
          out.summary.hashMismatch++
        }
      }
    }
  }

  return out
}

module.exports = { scan }

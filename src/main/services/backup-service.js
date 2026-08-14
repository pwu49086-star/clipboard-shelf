/**
 * Backup & Recovery（v1.9.0）
 *
 * 完整备份 = DB 一致快照 + config/pet/encryption + 全部引用图片 + manifest。
 * 原则：staging → 校验 → 原子 rename；成功前绝不触碰旧备份。
 */
const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')
const dbService = require('./db-service')
const manifest = require('../../shared/backup-manifest.cjs')
const integrity = require('./asset-integrity')

const COMPLETE_PREFIX = 'complete-'
const SCHEMA_VERSION = 5

function tsName() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(src, dest)
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name)
    const d = path.join(dest, e.name)
    if (e.isDirectory()) copyDir(s, d)
    else fs.copyFileSync(s, d)
  }
}

function dirSize(dir) {
  let total = 0
  const walk = (p) => {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const s = path.join(p, e.name)
      if (e.isDirectory()) walk(s)
      else total += fs.statSync(s).size
    }
  }
  try { walk(dir) } catch {}
  return total
}

function writeLog(backupRoot, entry) {
  try {
    const logPath = path.join(backupRoot, 'backup-log.json')
    const list = []
    try { list.push(...JSON.parse(fs.readFileSync(logPath, 'utf8'))) } catch {}
    list.push({ ...entry, ts: Date.now() })
    fs.writeFileSync(logPath, JSON.stringify(list.slice(-50), null, 2))
  } catch {}
}

function readLog(backupRoot) {
  try {
    return JSON.parse(fs.readFileSync(path.join(backupRoot, 'backup-log.json'), 'utf8'))
  } catch {
    return []
  }
}

function appendAuditLog(backupRoot, entries) {
  try {
    const p = path.join(backupRoot, 'asset-audit-log.json')
    const list = []
    try { list.push(...JSON.parse(fs.readFileSync(p, 'utf8'))) } catch {}
    for (const e of entries || []) list.push({ ...e, ts: Date.now() })
    fs.writeFileSync(p, JSON.stringify(list.slice(-500), null, 2))
  } catch {}
}

function readAuditLog(backupRoot) {
  try {
    return JSON.parse(fs.readFileSync(path.join(backupRoot, 'asset-audit-log.json'), 'utf8'))
  } catch {
    return []
  }
}

function listCompleteBackups(backupRoot) {
  let entries = []
  try { entries = fs.readdirSync(backupRoot, { withFileTypes: true }) } catch { return [] }
  const out = []
  for (const e of entries) {
    if (!e.isDirectory() || !e.name.startsWith(COMPLETE_PREFIX) || e.name.endsWith('.tmp')) continue
    const dir = path.join(backupRoot, e.name)
    const m = manifest.readManifest(dir)
    if (!m) continue
    out.push({
      dir,
      name: e.name,
      createdAt: m.createdAt,
      appVersion: m.appVersion,
      schemaVersion: m.schemaVersion,
      size: dirSize(dir),
      imageCount: (m.images || []).length,
      counts: m.counts
    })
  }
  out.sort((a, b) => b.createdAt - a.createdAt)
  return out
}

function pruneCompleteBackups(backupRoot, maxKeep) {
  const list = listCompleteBackups(backupRoot)
  if (list.length <= maxKeep) return
  for (const b of list.slice(maxKeep)) {
    try { fs.rmSync(b.dir, { recursive: true, force: true }) } catch (e) {
      console.error('[Backup] prune failed:', b.dir, e.message)
    }
  }
}

function verifyDb(dbPath, schemaVersion, counts) {
  const errors = []
  let db
  try {
    db = new Database(dbPath, { readonly: true })
  } catch (e) {
    return { ok: false, errors: ['open failed: ' + e.message] }
  }
  const ic = db.pragma('integrity_check', { simple: true })
  if (ic !== 'ok') errors.push('integrity_check: ' + ic)
  const ver = db.pragma('user_version', { simple: true })
  if (ver > schemaVersion) errors.push('schema version newer: ' + ver)
  if (counts) {
    const q = (s) => db.prepare(s).get().c
    const actual = {
      items: q('SELECT COUNT(*) c FROM items'),
      images: q("SELECT COUNT(*) c FROM items WHERE filePath IS NOT NULL OR thumbPath IS NOT NULL OR annotatedPath IS NOT NULL"),
      entities: q('SELECT COUNT(*) c FROM entities'),
      annotations: q('SELECT COUNT(*) c FROM annotations'),
      worksites: q('SELECT COUNT(*) c FROM worksites'),
      notes: q('SELECT COUNT(*) c FROM notes')
    }
    for (const k of Object.keys(counts)) {
      if (actual[k] !== counts[k]) errors.push('count mismatch ' + k + ': manifest=' + counts[k] + ' actual=' + actual[k])
    }
  }
  db.close()
  return { ok: errors.length === 0, errors }
}

async function buildCompleteSnapshot({ tmpDir, userData, appVersion, schemaVersion }) {
  const dbRes = await dbService.backupTo(path.join(tmpDir, 'shelf.db'))
  if (!dbRes.ok) return { ok: false, retryable: false, error: 'db backup failed: ' + dbRes.error }

  const extras = []
  for (const file of ['config.json', 'pet-tasks.json', 'encryption.json']) {
    const src = path.join(userData, file)
    if (fs.existsSync(src)) {
      copyFile(src, path.join(tmpDir, file))
      extras.push({ file, abs: path.join(tmpDir, file) })
    }
  }

  let snap
  try {
    snap = new Database(path.join(tmpDir, 'shelf.db'), { readonly: true })
  } catch (e) {
    return { ok: false, retryable: false, error: 'snapshot open failed: ' + e.message }
  }
  const rows = snap.prepare(
    "SELECT id, type, filePath, thumbPath, annotatedPath, assetState, assetMissingAt FROM items WHERE filePath IS NOT NULL OR thumbPath IS NOT NULL OR annotatedPath IS NOT NULL"
  ).all()
  const counts = {
    items: snap.prepare('SELECT COUNT(*) c FROM items').get().c,
    images: rows.length,
    entities: snap.prepare('SELECT COUNT(*) c FROM entities').get().c,
    annotations: snap.prepare('SELECT COUNT(*) c FROM annotations').get().c,
    worksites: snap.prepare('SELECT COUNT(*) c FROM worksites').get().c,
    notes: snap.prepare('SELECT COUNT(*) c FROM notes').get().c
  }
  snap.close()

  const images = []
  const missing = []
  const knownMissing = []
  for (const r of rows) {
    for (const [kind, p] of [['full', r.filePath], ['thumb', r.thumbPath], ['annotated', r.annotatedPath]]) {
      if (!p) continue
      const base = path.basename(p)
      const src = path.join(userData, 'images', kind, base)
      if (!fs.existsSync(src)) {
        if (r.assetState === 'missing') {
          knownMissing.push({ itemId: r.id, kind, file: base, confirmedAt: r.assetMissingAt || null })
        } else {
          missing.push({ itemId: r.id, kind, file: base })
        }
        continue
      }
      const dest = path.join(tmpDir, 'images', kind, base)
      copyFile(src, dest)
      images.push({ path: kind + '/' + base, itemId: r.id, abs: dest })
    }
  }
  if (missing.length) {
    return { ok: false, retryable: true, error: 'missing referenced assets: ' + JSON.stringify(missing.slice(0, 5)) }
  }

  const m = manifest.buildManifest({
    appVersion,
    schemaVersion,
    dbAbs: path.join(tmpDir, 'shelf.db'),
    dbPageCount: dbRes.pageCount,
    extras,
    images,
    counts,
    knownMissing,
    unexpectedMissing: missing
  })
  manifest.writeManifest(tmpDir, m)
  const fileV = manifest.verifyManifest(tmpDir, m)
  if (!fileV.ok) return { ok: false, retryable: false, error: 'manifest verify failed: ' + fileV.errors.join('; ') }
  const dbv = verifyDb(path.join(tmpDir, 'shelf.db'), schemaVersion, counts)
  if (!dbv.ok) return { ok: false, retryable: false, error: 'snapshot db verify failed: ' + dbv.errors.join('; ') }
  return { ok: true }
}

async function createCompleteBackup({ backupRoot, userData, appVersion = '1.9.0', maxKeep = 3, schemaVersion = SCHEMA_VERSION }) {
  fs.mkdirSync(backupRoot, { recursive: true })
  const tmpDir = path.join(backupRoot, COMPLETE_PREFIX + tsName() + '.tmp')
  fs.mkdirSync(tmpDir, { recursive: true })
  try {
    const once = await buildCompleteSnapshot({ tmpDir, userData, appVersion, schemaVersion })
    if (!once.ok) {
      if (!once.retryable) return finishFail(backupRoot, tmpDir, once)
      fs.rmSync(tmpDir, { recursive: true, force: true })
      fs.mkdirSync(tmpDir, { recursive: true })
      const twice = await buildCompleteSnapshot({ tmpDir, userData, appVersion, schemaVersion })
      if (!twice.ok) return finishFail(backupRoot, tmpDir, twice)
    }
    const finalDir = path.join(backupRoot, COMPLETE_PREFIX + tsName())
    fs.renameSync(tmpDir, finalDir)
    pruneCompleteBackups(backupRoot, maxKeep)
    const m = manifest.readManifest(finalDir)
    writeLog(backupRoot, { type: 'complete', ok: true, name: path.basename(finalDir) })
    return { ok: true, backupDir: finalDir, manifest: m }
  } catch (e) {
    return finishFail(backupRoot, tmpDir, { ok: false, error: e.message })
  }
}

function finishFail(backupRoot, tmpDir, result) {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  writeLog(backupRoot, { type: 'complete', ok: false, error: result.error })
  return { ...result }
}

function verifyBackup(backupDir, opts = {}) {
  const schemaVersion = opts.schemaVersion || SCHEMA_VERSION
  const m = manifest.readManifest(backupDir)
  const fileV = manifest.verifyManifest(backupDir, m)
  if (!fileV.ok) return { ok: false, errors: fileV.errors }
  const dbv = verifyDb(path.join(backupDir, m.db.file), schemaVersion, m.counts)
  if (!dbv.ok) return { ok: false, errors: dbv.errors }
  const errors = []
  const known = new Map()
  for (const k of m.knownMissingAssets || []) known.set(k.itemId + ':' + k.kind + ':' + k.file, k)
  let knownMissing = 0
  let unexpectedMissing = 0
  let db
  try { db = new Database(path.join(backupDir, m.db.file), { readonly: true }) } catch {}
  if (db) {
    const rows = db.prepare("SELECT id, filePath, thumbPath, annotatedPath, assetState FROM items WHERE filePath IS NOT NULL OR thumbPath IS NOT NULL OR annotatedPath IS NOT NULL").all()
    db.close()
    for (const r of rows) {
      for (const [kind, p] of [['full', r.filePath], ['thumb', r.thumbPath], ['annotated', r.annotatedPath]]) {
        if (!p) continue
        const rel = kind + '/' + path.basename(p)
        if (!fs.existsSync(path.join(backupDir, 'images', rel))) {
          const key = r.id + ':' + kind + ':' + path.basename(p)
          if (known.has(key)) knownMissing++
          else {
            unexpectedMissing++
            errors.push('row ' + r.id + ' unexpected missing ' + rel)
          }
        }
      }
    }
  }
  // 备份内孤儿资产计数（不在 manifest 中但存在于备份目录）
  const manifestPaths = new Set((m.images || []).map(i => i.path))
  let orphan = 0
  for (const kind of ['full', 'thumb', 'annotated']) {
    const dir = path.join(backupDir, 'images', kind)
    let files = []
    try { files = fs.readdirSync(dir) } catch {}
    for (const f of files) {
      if (!manifestPaths.has(kind + '/' + f)) orphan++
    }
  }
  const status = (m.assetState === 'incomplete' || knownMissing > 0) ? 'consistent' : 'complete'
  return {
    ok: errors.length === 0,
    errors,
    status,
    knownMissing,
    unexpectedMissing,
    orphan,
    hashMismatch: fileV.errors.filter(e => e.includes('hash mismatch')).length,
    manifest: m
  }
}

async function createRollback({ rollbackDir, userData }) {
  try {
    fs.mkdirSync(rollbackDir, { recursive: true })
    const dbRes = await dbService.backupTo(path.join(rollbackDir, 'shelf.db'))
    if (!dbRes.ok) return { ok: false, error: 'rollback db failed: ' + dbRes.error }
    const extras = []
    for (const file of ['config.json', 'pet-tasks.json', 'encryption.json']) {
      const src = path.join(userData, file)
      if (fs.existsSync(src)) {
        copyFile(src, path.join(rollbackDir, file))
        extras.push({ file, abs: path.join(rollbackDir, file) })
      }
    }
    for (const kind of ['full', 'thumb', 'annotated']) {
      const srcDir = path.join(userData, 'images', kind)
      if (fs.existsSync(srcDir)) copyDir(srcDir, path.join(rollbackDir, 'images', kind))
    }
    let snap
    try { snap = new Database(path.join(rollbackDir, 'shelf.db'), { readonly: true }) } catch {}
    const images = []
    if (snap) {
      const rows = snap.prepare("SELECT id, filePath, thumbPath, annotatedPath FROM items WHERE filePath IS NOT NULL OR thumbPath IS NOT NULL OR annotatedPath IS NOT NULL").all()
      for (const r of rows) {
        for (const [kind, p] of [['full', r.filePath], ['thumb', r.thumbPath], ['annotated', r.annotatedPath]]) {
          if (!p) continue
          const rel = kind + '/' + path.basename(p)
          const abs = path.join(rollbackDir, 'images', rel)
          if (fs.existsSync(abs)) images.push({ path: rel, itemId: r.id, abs })
        }
      }
      snap.close()
    }
    const m = manifest.buildManifest({ appVersion: 'pre-restore', schemaVersion: SCHEMA_VERSION, dbAbs: path.join(rollbackDir, 'shelf.db'), extras, images, counts: {} })
    manifest.writeManifest(rollbackDir, m)
    return { ok: true, rollbackDir }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

async function prepareRestore({ backupDir, userData, backupRoot }) {
  const v = verifyBackup(backupDir)
  if (!v.ok) return { ok: false, error: 'backup verify failed: ' + v.errors.join('; ') }

  for (const dir of fs.existsSync(path.dirname(userData)) ? fs.readdirSync(path.dirname(userData)) : []) {
    const full = path.join(path.dirname(userData), dir)
    if (dir.startsWith(path.basename(userData) + '.rollback-') && fs.existsSync(full)) {
      try { fs.rmSync(full, { recursive: true, force: true }) } catch {}
    }
  }
  const rollbackDir = userData + '.rollback-' + tsName()
  const rb = await createRollback({ rollbackDir, userData })
  if (!rb.ok) return { ok: false, error: 'rollback creation failed: ' + rb.error }

  const stagingDir = userData + '.restore-staging'
  if (fs.existsSync(stagingDir)) fs.rmSync(stagingDir, { recursive: true, force: true })
  copyDir(backupDir, stagingDir)
  const sv = verifyBackup(stagingDir)
  if (!sv.ok) {
    try { fs.rmSync(stagingDir, { recursive: true, force: true }) } catch {}
    return { ok: false, error: 'staging verify failed: ' + sv.errors.join('; '), rollbackDir }
  }
  return { ok: true, rollbackDir, stagingDir }
}

function swapRestore({ userData, stagingDir, rollbackDir }) {
  try {
    fs.writeFileSync(path.join(stagingDir, 'restore-pending.json'), JSON.stringify({ createdAt: Date.now(), rollbackDir }))
    const oldDir = userData + '.old'
    if (fs.existsSync(oldDir)) fs.rmSync(oldDir, { recursive: true, force: true })
    fs.renameSync(userData, oldDir)
    fs.renameSync(stagingDir, userData)
    return { ok: true, oldDir }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

function applyRollbackIfNeeded({ userData }) {
  const markerPath = path.join(userData, 'restore-pending.json')
  if (!fs.existsSync(markerPath)) return { ok: true, rolledBack: false }
  let marker = null
  try { marker = JSON.parse(fs.readFileSync(markerPath, 'utf8')) } catch {}

  const scan = integrity.scan({ userData })
  // 只有“意外缺失”（assetState=ok 但文件缺失）才是 critical；已确认永久缺失不是
  const critical = scan.dbUnreadable || scan.summary.unexpectedMissing > 0
  if (!critical) {
    try { fs.unlinkSync(markerPath) } catch {}
    for (const suffix of ['.old', '.restore-failed']) {
      const p = userData + suffix
      if (fs.existsSync(p)) { try { fs.rmSync(p, { recursive: true, force: true }) } catch {} }
    }
    if (marker && marker.rollbackDir && fs.existsSync(marker.rollbackDir)) {
      try { fs.rmSync(marker.rollbackDir, { recursive: true, force: true }) } catch {}
    }
    return { ok: true, rolledBack: false }
  }
  if (!marker || !marker.rollbackDir || !fs.existsSync(marker.rollbackDir)) {
    return { ok: false, error: 'restore incomplete and rollback unavailable', rolledBack: false }
  }
  const failed = userData + '.restore-failed'
  if (fs.existsSync(failed)) fs.rmSync(failed, { recursive: true, force: true })
  fs.renameSync(userData, failed)
  fs.renameSync(marker.rollbackDir, userData)
  return {
    ok: true,
    rolledBack: true,
    reason: { dbUnreadable: scan.dbUnreadable, fullMissing: scan.summary.fullMissing, annotatedMissing: scan.summary.annotatedMissing }
  }
}

module.exports = {
  tsName,
  listCompleteBackups,
  createCompleteBackup,
  verifyBackup,
  prepareRestore,
  swapRestore,
  applyRollbackIfNeeded,
  pruneCompleteBackups,
  readLog,
  writeLog,
  appendAuditLog,
  readAuditLog,
  dirSize,
  SCHEMA_VERSION
}

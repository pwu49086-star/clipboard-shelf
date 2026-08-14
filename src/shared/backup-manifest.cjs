/**
 * 备份 Manifest（v1.9.0）
 *
 * 隐私最小化：只允许 文件名/哈希/尺寸/时间/itemId/计数，禁止任何内容字段。
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const FORMAT = 'clipboard-shelf-backup'
const MANIFEST_VERSION = 1
const FORBIDDEN_KEYS = ['content', 'ocrText', 'value', 'sourceApp', 'sourceProcess', 'text']

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')
}

function fileMeta(p) {
  const st = fs.statSync(p)
  return { size: st.size, mtime: Math.round(st.mtimeMs) }
}

/**
 * @param {{appVersion:string, schemaVersion:number, dbAbs:string, extras:Array<{file:string,abs:string}>, images:Array<{path:string,itemId:number,abs:string}>, counts:object}} opts
 */
function buildManifest(opts) {
  const db = {
    file: 'shelf.db',
    ...fileMeta(opts.dbAbs),
    sha256: sha256File(opts.dbAbs),
    integrityCheck: 'ok',
    ...(opts.dbPageCount != null ? { pageCount: opts.dbPageCount } : {})
  }
  const extra = (opts.extras || []).map(e => ({
    file: e.file,
    ...fileMeta(e.abs),
    sha256: sha256File(e.abs)
  }))
  const images = (opts.images || []).map(i => ({
    path: i.path,
    itemId: i.itemId,
    ...fileMeta(i.abs),
    sha256: sha256File(i.abs)
  }))
  const knownMissing = (opts.knownMissing || []).map(k => ({
    itemId: k.itemId,
    kind: k.kind,
    file: k.file,
    confirmedAt: k.confirmedAt || null
  }))
  const unexpectedMissing = (opts.unexpectedMissing || []).map(k => ({
    itemId: k.itemId,
    kind: k.kind,
    file: k.file
  }))
  return {
    format: FORMAT,
    version: MANIFEST_VERSION,
    createdAt: Date.now(),
    appVersion: opts.appVersion || '0.0.0',
    schemaVersion: opts.schemaVersion || 0,
    db,
    extra,
    images,
    counts: opts.counts || {},
    assetState: knownMissing.length > 0 ? 'incomplete' : 'complete',
    knownMissingAssets: knownMissing,
    unexpectedMissingAssets: unexpectedMissing,
    success: true
  }
}

function writeManifest(dir, manifest) {
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
}

function readManifest(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
  } catch {
    return null
  }
}

function assertPrivacySafe(manifest) {
  const found = []
  const walk = (o) => {
    if (!o || typeof o !== 'object') return
    for (const k of Object.keys(o)) {
      if (FORBIDDEN_KEYS.includes(k)) found.push(k)
      walk(o[k])
    }
  }
  walk(manifest)
  return { ok: found.length === 0, found }
}

/**
 * 文件级校验（不依赖 DB 打开）。
 */
function verifyManifest(dir, manifest = readManifest(dir)) {
  const errors = []
  if (!manifest) return { ok: false, errors: ['manifest missing or invalid'] }
  if (manifest.format !== FORMAT) errors.push('format mismatch')
  if (manifest.version !== MANIFEST_VERSION) errors.push('manifest version mismatch')
  if (!manifest.db || !manifest.db.file) errors.push('db metadata missing')
  if (manifest.db) {
    const dbPath = path.join(dir, manifest.db.file)
    if (!fs.existsSync(dbPath)) errors.push('db file missing')
    else if (sha256File(dbPath) !== manifest.db.sha256) errors.push('db hash mismatch')
  }
  for (const e of manifest.extra || []) {
    const p = path.join(dir, e.file)
    if (!fs.existsSync(p)) errors.push('extra missing: ' + e.file)
    else if (sha256File(p) !== e.sha256) errors.push('extra hash mismatch: ' + e.file)
  }
  for (const im of manifest.images || []) {
    const p = path.join(dir, 'images', im.path)
    if (!fs.existsSync(p)) errors.push('image missing: ' + im.path)
    else {
      if (sha256File(p) !== im.sha256) errors.push('image hash mismatch: ' + im.path)
      if (fs.statSync(p).size !== im.size) errors.push('image size mismatch: ' + im.path)
    }
  }
  const privacy = assertPrivacySafe(manifest)
  if (!privacy.ok) errors.push('manifest contains forbidden keys: ' + privacy.found.join(','))
  return { ok: errors.length === 0, errors }
}

module.exports = {
  FORMAT,
  MANIFEST_VERSION,
  sha256File,
  fileMeta,
  buildManifest,
  writeManifest,
  readManifest,
  verifyManifest,
  assertPrivacySafe
}

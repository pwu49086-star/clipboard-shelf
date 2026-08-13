const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const Database = require('../node_modules/better-sqlite3')

const {
  productionUserData,
  resolveRuntimePaths,
  assertIsolatedRuntime,
  buildFingerprint
} = require('../src/main/runtime-isolation.cjs')

function mkRoot() {
  const dir = path.join(os.tmpdir(), `clipboard-shelf-sandbox-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

const APP_DATA = path.join(os.tmpdir(), `clipboard-shelf-appdata-${Date.now()}`)
const TEST_ROOT = mkRoot()

test('1-7: 全部资产路径由 TEST_ROOT 派生且位于 TEST_ROOT 内', () => {
  const r = resolveRuntimePaths({ env: { CLIPBOARD_SHELF_TEST_ROOT: TEST_ROOT }, appData: APP_DATA })
  assert.strictEqual(r.mode, 'test')
  assert.strictEqual(r.userData, path.resolve(TEST_ROOT))
  assert.strictEqual(r.dbPath, path.join(path.resolve(TEST_ROOT), 'shelf.db'))
  assert.strictEqual(r.configPath, path.join(path.resolve(TEST_ROOT), 'config.json'))
  assert.strictEqual(r.imagesDir, path.join(path.resolve(TEST_ROOT), 'images'))
  assert.strictEqual(r.logsDir, path.join(path.resolve(TEST_ROOT), 'logs'))
  assert.strictEqual(r.backupsDir, path.join(path.resolve(TEST_ROOT), 'backups'))
  assert.strictEqual(r.petTasksPath, path.join(path.resolve(TEST_ROOT), 'pet-tasks.json'))
  const g = assertIsolatedRuntime(r, { appData: APP_DATA, env: {} })
  assert.strictEqual(g.ok, true, g.errors.join('; '))
})

test('8: 任一资产路径越界 → abort', () => {
  const r = resolveRuntimePaths({ env: { CLIPBOARD_SHELF_TEST_ROOT: TEST_ROOT }, appData: APP_DATA })
  r.configPath = path.join(APP_DATA, 'clipboard-shelf', 'config.json')
  const g = assertIsolatedRuntime(r, { appData: APP_DATA, env: {} })
  assert.strictEqual(g.ok, false)
  assert.ok(g.errors.some(e => e.includes('configPath')))
})

test('9: TEST_ROOT = 生产 userData → abort', () => {
  const prod = productionUserData(APP_DATA)
  const r = resolveRuntimePaths({ env: { CLIPBOARD_SHELF_TEST_ROOT: prod }, appData: APP_DATA })
  const g = assertIsolatedRuntime(r, { appData: APP_DATA, env: {} })
  assert.strictEqual(g.ok, false)
  assert.ok(g.errors.some(e => e.includes('生产 userData')))
})

test('TEST_ROOT 缺失（生产模式）→ 验收 guard abort；路径回退生产', () => {
  const r = resolveRuntimePaths({ env: {}, appData: APP_DATA })
  assert.strictEqual(r.mode, 'production')
  assert.strictEqual(r.userData, productionUserData(APP_DATA))
  const g = assertIsolatedRuntime(r, { appData: APP_DATA, env: {} })
  assert.strictEqual(g.ok, false)
})

test('TEST_ROOT 非绝对路径 / 不存在 → abort', () => {
  const r = resolveRuntimePaths({ env: { CLIPBOARD_SHELF_TEST_ROOT: 'relative/path' }, appData: APP_DATA })
  const g1 = assertIsolatedRuntime(r, { appData: APP_DATA, env: {} })
  assert.strictEqual(g1.ok, false)
  const r2 = resolveRuntimePaths({ env: { CLIPBOARD_SHELF_TEST_ROOT: path.join(os.tmpdir(), 'not-exists-xyz') }, appData: APP_DATA })
  const g2 = assertIsolatedRuntime(r2, { appData: APP_DATA, env: {} })
  assert.strictEqual(g2.ok, false)
})

test('legacy CLIPBOARD_SHELF_USER_DATA 与 TEST_ROOT 不一致 → abort', () => {
  const r = resolveRuntimePaths({ env: { CLIPBOARD_SHELF_TEST_ROOT: TEST_ROOT }, appData: APP_DATA })
  const g = assertIsolatedRuntime(r, {
    appData: APP_DATA,
    env: { CLIPBOARD_SHELF_USER_DATA: path.join(os.tmpdir(), 'other-root') }
  })
  assert.strictEqual(g.ok, false)
})

test('fingerprint 快照字段完整且只读', () => {
  const r = resolveRuntimePaths({ env: { CLIPBOARD_SHELF_TEST_ROOT: TEST_ROOT }, appData: APP_DATA })
  const snap = buildFingerprint(r)
  for (const key of ['testRoot', 'userData', 'dbPath', 'configPath', 'imagesPath', 'dbSha256', 'configSha256', 'fullCount', 'thumbCount', 'annotatedCount']) {
    assert.ok(key in snap, `missing ${key}`)
  }
  assert.strictEqual(snap.fullCount, -1)
})

// ====== 10-12：migration / retention / delete 仅作用于 TEST_ROOT ======
process.env.CLIPBOARD_SHELF_TEST_ROOT = TEST_ROOT
const db = require('../src/main/services/db-service.js')
const retention = require('../src/main/services/retention.js')

test.before(async () => {
  await db.init()
})

test.after(() => {
  db.close()
  try { fs.rmSync(TEST_ROOT, { recursive: true, force: true }) } catch {}
})

test('10: migration 仅作用于 TEST_ROOT', () => {
  const dbFile = path.join(TEST_ROOT, 'shelf.db')
  assert.ok(fs.existsSync(dbFile), 'DB 必须创建在 TEST_ROOT')
  const raw = new Database(dbFile, { readonly: true })
  assert.strictEqual(raw.pragma('user_version', { simple: true }), 4)
  raw.close()
  const prodFile = path.join(APP_DATA, 'clipboard-shelf', 'shelf.db')
  assert.ok(!fs.existsSync(prodFile), '生产路径不得被创建')
})

test('11: retention 仅作用于 TEST_ROOT（文件清理也在 TEST_ROOT 内）', () => {
  const now = Date.now()
  const fav = db.insert({ type: 'text', content: `fav-${now}`, createTime: now })
  db.toggleFavorite(fav.id)
  const drop1 = db.insert({ type: 'text', content: `drop-${now}-1`, createTime: now - 5000 })
  const drop2 = db.insert({ type: 'text', content: `drop-${now}-2`, createTime: now - 4000 })
  const imgPath = path.join(TEST_ROOT, 'images', 'full', `ret-${now}.png`)
  fs.mkdirSync(path.dirname(imgPath), { recursive: true })
  fs.writeFileSync(imgPath, 'x')
  const img = db.insert({ type: 'image', content: `ret-${now}.png`, filePath: imgPath, createTime: now - 3000 })
  retention.configure({ enabled: true, maxItems: 1, maxDays: 0, maxImageItems: 0 })
  retention.run()
  const all = db.getAll({ limit: 1000 })
  assert.ok(all.some(i => i.id === fav.id), '收藏必须保留')
  assert.ok(!all.some(i => i.id === drop1.id))
  assert.ok(!all.some(i => i.id === drop2.id))
  assert.ok(!all.some(i => i.id === img.id))
  assert.ok(!fs.existsSync(imgPath), 'retention 清理的图片文件必须位于 TEST_ROOT 内且已删除')
  assert.ok(!fs.existsSync(path.join(APP_DATA, 'clipboard-shelf', 'images')), '生产图片目录不得被创建')
})

test('12: delete 仅作用于 TEST_ROOT', () => {
  const item = db.insert({ type: 'text', content: `del-${Date.now()}`, createTime: Date.now() })
  const removed = db.remove(item.id)
  assert.ok(removed)
  assert.ok(!db.getAll({ limit: 1000 }).some(i => i.id === item.id))
})

/**
 * Runtime Isolation - 验收沙箱统一路径与启动前硬校验（纯逻辑，无 Electron 依赖）。
 *
 * 验收/冒烟实例必须设置 CLIPBOARD_SHELF_TEST_ROOT：
 *   TEST_ROOT/
 *   ├── shelf.db
 *   ├── config.json
 *   ├── images/{full,thumb,annotated}
 *   ├── logs/
 *   ├── backups/
 *   └── pet-tasks.json
 *
 * 未设置 TEST_ROOT 时保持生产模式（%APPDATA%\clipboard-shelf），逻辑完全不变。
 */

const path = require('node:path')
const fs = require('node:fs')
const crypto = require('node:crypto')

function productionUserData(appData) {
  return path.join(appData, 'clipboard-shelf')
}

/**
 * 统一派生全部资产路径。
 * @param {{env?: object, appData?: string}} opts
 */
function resolveRuntimePaths({ env = process.env, appData = process.env.APPDATA } = {}) {
  const testRoot = String(env.CLIPBOARD_SHELF_TEST_ROOT || '').trim()
  const prod = productionUserData(appData)
  if (!testRoot) {
    return {
      mode: 'production',
      testRoot: null,
      userData: prod,
      dbPath: path.join(prod, 'shelf.db'),
      configPath: path.join(prod, 'config.json'),
      imagesDir: path.join(prod, 'images'),
      logsDir: path.join(prod, 'logs'),
      backupsDir: path.join(prod, 'backups'),
      petTasksPath: path.join(prod, 'pet-tasks.json')
    }
  }
  const root = path.resolve(testRoot)
  return {
    mode: 'test',
    testRoot: root,
    userData: root,
    dbPath: path.join(root, 'shelf.db'),
    configPath: path.join(root, 'config.json'),
    imagesDir: path.join(root, 'images'),
    logsDir: path.join(root, 'logs'),
    backupsDir: path.join(root, 'backups'),
    petTasksPath: path.join(root, 'pet-tasks.json')
  }
}

/**
 * 启动前硬校验。任意一项失败返回 errors；调用方必须 abort。
 */
function assertIsolatedRuntime(runtime, { appData = process.env.APPDATA, env = process.env } = {}) {
  const errors = []
  if (!runtime || runtime.mode !== 'test') {
    errors.push('验收实例必须设置 CLIPBOARD_SHELF_TEST_ROOT')
    return { ok: false, errors }
  }
  const root = runtime.testRoot
  if (!root) {
    errors.push('TEST_ROOT 为空')
  } else {
    if (!path.isAbsolute(root)) errors.push(`TEST_ROOT 必须是绝对路径: ${root}`)
    if (!fs.existsSync(root)) errors.push(`TEST_ROOT 不存在: ${root}`)
    const prod = productionUserData(appData)
    if (path.resolve(root) === path.resolve(prod)) {
      errors.push('TEST_ROOT 不得等于生产 userData')
    }
    const assets = {
      dbPath: runtime.dbPath,
      configPath: runtime.configPath,
      imagesDir: runtime.imagesDir,
      logsDir: runtime.logsDir,
      backupsDir: runtime.backupsDir,
      petTasksPath: runtime.petTasksPath
    }
    const rootPrefix = path.resolve(root) + path.sep
    for (const [key, value] of Object.entries(assets)) {
      if (!value || !path.resolve(value).startsWith(rootPrefix)) {
        errors.push(`${key} 不在 TEST_ROOT 内: ${value}`)
      }
    }
    if (runtime.userData !== root) {
      errors.push('Electron userData 必须等于 TEST_ROOT')
    }
    const legacy = String(env.CLIPBOARD_SHELF_USER_DATA || '').trim()
    if (legacy && path.resolve(legacy) !== root) {
      errors.push('CLIPBOARD_SHELF_USER_DATA 与 TEST_ROOT 不一致')
    }
  }
  return { ok: errors.length === 0, errors }
}

function sha256File(p) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')
  } catch {
    return null
  }
}

function countFiles(dir) {
  try {
    return fs.readdirSync(dir).filter(f => fs.statSync(path.join(dir, f)).isFile()).length
  } catch {
    return -1
  }
}

/**
 * 验收前 fingerprint 快照（只读采集）。
 */
function buildFingerprint(runtime) {
  return {
    generatedAt: new Date().toISOString(),
    mode: runtime.mode,
    testRoot: runtime.testRoot,
    userData: runtime.userData,
    dbPath: runtime.dbPath,
    configPath: runtime.configPath,
    imagesPath: runtime.imagesDir,
    dbSha256: sha256File(runtime.dbPath),
    configSha256: sha256File(runtime.configPath),
    fullCount: countFiles(path.join(runtime.imagesDir, 'full')),
    thumbCount: countFiles(path.join(runtime.imagesDir, 'thumb')),
    annotatedCount: countFiles(path.join(runtime.imagesDir, 'annotated'))
  }
}

function saveFingerprint(runtime, outFile) {
  const snap = buildFingerprint(runtime)
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  fs.writeFileSync(outFile, JSON.stringify(snap, null, 2), 'utf8')
  return snap
}

module.exports = {
  productionUserData,
  resolveRuntimePaths,
  assertIsolatedRuntime,
  buildFingerprint,
  saveFingerprint,
  sha256File,
  countFiles
}

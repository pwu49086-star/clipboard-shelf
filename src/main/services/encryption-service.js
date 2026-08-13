/**
 * Encryption Service - 主密码加密（AES-256-GCM + scrypt）
 *
 * - 密码本身不落盘；只存盐和校验密文
 * - 加密格式：enc:v1:<iv b64>.<tag b64>.<data b64>
 * - 未启用时内容原样存储（兼容旧数据）
 */
const crypto = require('crypto')
const path = require('path')
const fs = require('fs')
const os = require('os')

let electronApp = null
try { electronApp = require('electron').app } catch {}

const CHECK_PLAIN = 'clipboard-shelf-unlock-check'
const PREFIX = 'enc:v1:'

let key = null
let state = { enabled: false, salt: null, check: null }

function stateFilePath() {
  if (process.env.CLIPBOARD_SHELF_TEST_ROOT) {
    return path.join(process.env.CLIPBOARD_SHELF_TEST_ROOT, 'encryption.json')
  }
  if (process.env.CLIPBOARD_SHELF_USER_DATA) {
    return path.join(process.env.CLIPBOARD_SHELF_USER_DATA, 'encryption.json')
  }
  try {
    if (electronApp) return path.join(electronApp.getPath('userData'), 'encryption.json')
  } catch {}
  return path.join(os.tmpdir(), 'clipboard-shelf-encryption.json')
}

function load() {
  try {
    state = JSON.parse(fs.readFileSync(stateFilePath(), 'utf-8'))
  } catch {
    state = { enabled: false, salt: null, check: null }
  }
}

function save() {
  try {
    fs.writeFileSync(stateFilePath(), JSON.stringify(state, null, 2))
  } catch {}
}

function deriveKey(password, saltB64) {
  return crypto.scryptSync(String(password), Buffer.from(saltB64, 'base64'), 32)
}

function encryptRaw(plain, k) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', k, iv)
  const data = Buffer.concat([cipher.update(String(plain), 'utf-8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return PREFIX + iv.toString('base64') + '.' + tag.toString('base64') + '.' + data.toString('base64')
}

function decryptRaw(payload, k) {
  if (typeof payload !== 'string' || !payload.startsWith(PREFIX)) return payload
  const body = payload.slice(PREFIX.length)
  const [ivB64, tagB64, dataB64] = body.split('.')
  if (!ivB64 || !tagB64 || !dataB64) return payload
  const decipher = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  const out = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()])
  return out.toString('utf-8')
}

function getStatus() {
  load()
  return { enabled: !!state.enabled, unlocked: !!key }
}

function enable(password) {
  if (!password || String(password).length < 4) return { error: '密码至少 4 位' }
  load()
  const salt = crypto.randomBytes(16).toString('base64')
  const k = deriveKey(password, salt)
  state = { enabled: true, salt, check: encryptRaw(CHECK_PLAIN, k) }
  save()
  key = k
  return { ok: true }
}

function unlock(password) {
  load()
  if (!state.enabled) return { error: '加密未启用' }
  const k = deriveKey(password, state.salt)
  try {
    const check = decryptRaw(state.check, k)
    if (check !== CHECK_PLAIN) return { error: '密码错误' }
  } catch {
    return { error: '密码错误' }
  }
  key = k
  return { ok: true }
}

function lock() {
  key = null
  return { ok: true }
}

function disable(password) {
  const r = unlock(password)
  if (!r.ok) return r
  state = { enabled: false, salt: null, check: null }
  save()
  // 保留 key 供调用方解密存量数据，解密完成后应调用 lock()
  return { ok: true }
}

function isEnabled() {
  return !!state.enabled
}

function isUnlocked() {
  return !!key
}

function encrypt(plain) {
  if (!state.enabled) return plain
  if (!key) throw new Error('Encryption locked')
  return encryptRaw(plain, key)
}

function decrypt(payload) {
  if (!key) {
    return typeof payload === 'string' && payload.startsWith(PREFIX) ? '' : payload
  }
  try {
    return decryptRaw(payload, key)
  } catch {
    return ''
  }
}

function init() {
  load()
}

module.exports = { init, getStatus, enable, unlock, lock, disable, isEnabled, isUnlocked, encrypt, decrypt }

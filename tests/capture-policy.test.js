const test = require('node:test')
const assert = require('node:assert')

const {
  classifySensitivity,
  shouldCapture,
  normalizeAppName
} = require('../src/main/services/capture-policy.js')

test('classifySensitivity returns 0 for normal or empty text', () => {
  assert.strictEqual(classifySensitivity(''), 0)
  assert.strictEqual(classifySensitivity(null), 0)
  assert.strictEqual(classifySensitivity('hello world 12345'), 0)
  assert.strictEqual(classifySensitivity('我的普通文本'), 0)
})

test('classifySensitivity detects highly sensitive secrets', () => {
  assert.strictEqual(classifySensitivity('-----BEGIN PRIVATE KEY-----\nabc'), 2)
  assert.strictEqual(classifySensitivity('sk-abcdefghijklmnopqrstuvwxyz123456'), 2)
  assert.strictEqual(classifySensitivity('github_pat_abcdefghijklmnopqrstuvwxyz123'), 2)
  assert.strictEqual(classifySensitivity('AKIAABCDEFGHIJKLMNOP'), 2)
  assert.strictEqual(classifySensitivity('xoxb-1234567890-abcdefghijklm'), 2)
  assert.strictEqual(classifySensitivity('mongodb://user:pass@127.0.0.1:27017/db'), 2)
  assert.strictEqual(classifySensitivity('4111 1111 1111 1111'), 2)
})

test('classifySensitivity detects sensitive personal info', () => {
  assert.strictEqual(classifySensitivity('联系电话 13812345678'), 1)
  assert.strictEqual(classifySensitivity('身份证 110101199001011234'), 1)
})

test('shouldCapture honors enabled=false', () => {
  const r = shouldCapture({ text: 'hello', sourceApp: 'chrome', options: { enabled: false } })
  assert.strictEqual(r.action, 'ignore')
})

test('shouldCapture ignores apps in ignoreApps', () => {
  const r = shouldCapture({
    text: 'hello',
    sourceApp: 'PasswordManager.EXE',
    options: { ignoreApps: ['passwordmanager'] }
  })
  assert.strictEqual(r.action, 'ignore')
})

test('shouldCapture metadata-only for listed apps', () => {
  const r = shouldCapture({
    text: 'hello',
    sourceApp: 'BankApp',
    options: { metadataOnlyApps: ['bankapp'] }
  })
  assert.strictEqual(r.action, 'metadata')
  assert.strictEqual(r.sensitivity, 0)
})

test('shouldCapture metadata for highly sensitive content', () => {
  const r = shouldCapture({
    text: 'sk-abcdefghijklmnopqrstuvwxyz123456',
    sourceApp: 'chrome',
    options: {}
  })
  assert.strictEqual(r.action, 'metadata')
  assert.strictEqual(r.sensitivity, 2)
})

test('shouldCapture captures sensitive content with sensitivity=1', () => {
  const r = shouldCapture({
    text: '13812345678',
    sourceApp: 'wechat',
    options: {}
  })
  assert.strictEqual(r.action, 'capture')
  assert.strictEqual(r.sensitivity, 1)
})

test('shouldCapture captures normal content', () => {
  const r = shouldCapture({
    text: 'hello',
    sourceApp: 'chrome',
    options: {}
  })
  assert.strictEqual(r.action, 'capture')
  assert.strictEqual(r.sensitivity, 0)
})

test('skipSensitive=false disables sensitivity classification', () => {
  const r = shouldCapture({
    text: 'sk-abcdefghijklmnopqrstuvwxyz123456',
    sourceApp: 'chrome',
    options: { skipSensitive: false }
  })
  assert.strictEqual(r.action, 'capture')
  assert.strictEqual(r.sensitivity, 0)
})

test('missing source app does not block capture', () => {
  const r = shouldCapture({ text: 'hello', sourceApp: null, options: {} })
  assert.strictEqual(r.action, 'capture')
})

test('normalizeAppName lowercases and strips .exe', () => {
  assert.strictEqual(normalizeAppName('Chrome.EXE'), 'chrome')
  assert.strictEqual(normalizeAppName('wechat'), 'wechat')
  assert.strictEqual(normalizeAppName(null), '')
})

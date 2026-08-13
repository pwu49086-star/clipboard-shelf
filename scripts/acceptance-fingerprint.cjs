#!/usr/bin/env node
/**
 * 验收前 fingerprint 快照（只读）。
 * 用法：
 *   $env:CLIPBOARD_SHELF_TEST_ROOT = '<TEST_ROOT>'
 *   node scripts/acceptance-fingerprint.cjs
 *   （可选 FINGERPRINT_FILE 指定输出文件，默认 TEST_ROOT/backups/acceptance-fingerprint.json）
 */

const path = require('node:path')
const {
  resolveRuntimePaths,
  assertIsolatedRuntime,
  saveFingerprint
} = require('../src/main/runtime-isolation.cjs')

const runtime = resolveRuntimePaths()
const guard = assertIsolatedRuntime(runtime)
if (!guard.ok) {
  console.error('[RuntimeIsolation] ABORT: ' + guard.errors.join('; '))
  process.exit(1)
}

const out = process.env.FINGERPRINT_FILE
  ? path.resolve(process.env.FINGERPRINT_FILE)
  : path.join(runtime.backupsDir, 'acceptance-fingerprint.json')

const snap = saveFingerprint(runtime, out)
console.log(JSON.stringify(snap, null, 2))

#!/usr/bin/env node
/**
 * Acceptance Runner（v1.9.0 最小版）
 *
 * 用法：
 *   node scripts/acceptance-runner.cjs prepare [--root <dir>]
 *   node scripts/acceptance-runner.cjs launch --root <dir> --exe <path> [--args ...]
 *   node scripts/acceptance-runner.cjs clean --root <dir>
 *
 * TEST_ROOT 必须位于默认验收基目录（E:\clipboard-shelf-acceptance）内。
 */
const fs = require('fs')
const path = require('path')
const cp = require('child_process')
const runtime = require('../src/main/runtime-isolation.cjs')

const BASE = 'E:\\clipboard-shelf-acceptance'

function argValue(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : null
}

function ensureRoot(root) {
  if (!root) throw new Error('--root is required')
  const abs = path.resolve(root)
  const base = path.resolve(BASE)
  if (!abs.startsWith(base + path.sep)) throw new Error('TEST_ROOT must be under ' + base)
  return abs
}

async function prepare(rootArg) {
  const abs = ensureRoot(rootArg || path.join(BASE, new Date().toISOString().slice(0, 10) + '-' + Math.random().toString(36).slice(2, 6)))
  for (const d of ['images/full', 'images/thumb', 'images/annotated', 'logs', 'backups']) {
    fs.mkdirSync(path.join(abs, d), { recursive: true })
  }
  const r = runtime.resolveRuntimePaths({ env: { CLIPBOARD_SHELF_TEST_ROOT: abs }, appData: process.env.APPDATA })
  const g = runtime.assertIsolatedRuntime(r, { appData: process.env.APPDATA })
  if (!g.ok) throw new Error('isolation failed: ' + g.errors.join('; '))
  runtime.saveFingerprint(r, path.join(abs, 'backups', 'acceptance-fingerprint.json'))
  console.log(JSON.stringify({
    testRoot: abs,
    env: { CLIPBOARD_SHELF_TEST_ROOT: abs },
    fingerprint: path.join(abs, 'backups', 'acceptance-fingerprint.json')
  }, null, 2))
}

function launch(rootArg, exe, args) {
  const abs = ensureRoot(rootArg)
  if (!exe) throw new Error('--exe is required')
  const child = cp.spawn(exe, args || [], {
    env: { ...process.env, CLIPBOARD_SHELF_TEST_ROOT: abs },
    stdio: 'ignore'
  })
  console.log(JSON.stringify({ pid: child.pid, exe, testRoot: abs }, null, 2))
}

function clean(rootArg) {
  const abs = ensureRoot(rootArg)
  fs.rmSync(abs, { recursive: true, force: true })
  console.log(JSON.stringify({ removed: abs }, null, 2))
}

async function main() {
  const cmd = process.argv[2]
  try {
    if (cmd === 'prepare') await prepare(argValue('--root'))
    else if (cmd === 'launch') {
      const ai = process.argv.indexOf('--args')
      launch(argValue('--root'), argValue('--exe'), ai >= 0 ? process.argv.slice(ai + 1) : [])
    } else if (cmd === 'clean') clean(argValue('--root'))
    else throw new Error('usage: prepare|launch|clean --root <dir> [--exe <path>] [--args ...]')
  } catch (e) {
    console.error('[acceptance-runner]', e.message)
    process.exit(1)
  }
}

main()
